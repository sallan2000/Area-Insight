/**
 * sync-property-sales.ts — Build server/data/property-sales.json
 *
 * SOURCE (official, Open Government Licence v3.0):
 *   HM Land Registry Price Paid Data (PPD) — England & Wales.
 *   https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads
 *   Yearly CSV: https://price-paid-data.publicdata.landregistry.gov.uk/pp-YYYY.csv
 *
 * WHAT IT PRODUCES
 *   For the trailing 12 months, aggregated PER FULL POSTCODE (e.g. "SW1A 1AA"):
 *     { avgPrice, salesCount, minPrice, maxPrice, latestDate, latestPrice,
 *       sales: [{date, price, type}]  // up to MAX_SALES_PER_POSTCODE most-recent }
 *   plus a compact per-OUTCODE summary (district level) for the headline average:
 *     { avgPrice, salesCount, latestDate }
 *   This powers the "Property Sales (last 12 months)" section: a list of individual
 *   sales (by date + price + type) AND the district average.
 *
 * SIZE / RAM NOTE
 *   ~1.2M rows/yr -> the 12-month window spans two yearly files. Per-postcode output
 *   is large (hundreds of MB). On Replit the refresh runs in its own scheduled job;
 *   the SERVER lazy-loads this file only when a property-sales lookup is requested, so
 *   it is NOT held in memory at boot. If the generated file is too large to serve, set
 *   PER_POSTCODE=0 to emit outcode-only aggregates (default behaviour is per-postcode).
 *
 * COVERAGE / HONESTY
 *   - England & Wales: REAL transaction-level data (HM Land Registry PPD).
 *   - Scotland (Registers of Scotland) and Northern Ireland (Land Registry NI):
 *     transaction-level data is PAID ONLY (RoS "All sales data" ~£1,465+VAT/month;
 *     LRNI bespoke). No free per-postcode/open registry exists. We do NOT fabricate
 *     figures. The report shows a clear note for Scottish/NI postcodes.
 *
 * Run:  npm run sync:property-sales
 * Env:  PROPERTY_SALES_OUT (default server/data/property-sales.json)
 *       YEAR_CURRENT / YEAR_PREV (override yearly CSV years; default current year + prev)
 *       PER_POSTCODE (1 = per-postcode list [default], 0 = outcode-only summary)
 *       MAX_SALES_PER_POSTCODE (default 25; most-recent sales kept per postcode)
 *       MIN_SALES_FOR_LIST (default 1; postcodes with fewer sales than this are omitted
 *                           from byPostcode to save space; outcode summary still covers them)
 */

import { writeFileSync, mkdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import https from "https";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DEFAULT = join(__dirname, "..", "server", "data", "property-sales.json");

const now = new Date();
const YEAR_CURRENT = Number(process.env.YEAR_CURRENT || now.getUTCFullYear());
const YEAR_PREV = Number(process.env.YEAR_PREV || YEAR_CURRENT - 1);

const PER_POSTCODE = process.env.PER_POSTCODE !== "0"; // default on
const MAX_SALES_PER_POSTCODE = Number(process.env.MAX_SALES_PER_POSTCODE || 25);
const MIN_SALES_FOR_LIST = Number(process.env.MIN_SALES_FOR_LIST || 1);

const SOURCE_YEARS = [YEAR_PREV, YEAR_CURRENT];
const PPD_BASE = "https://price-paid-data.publicdata.landregistry.gov.uk/pp-";

// Trailing 12 months cutoff (inclusive). Anything older is ignored.
const cutoff = new Date();
cutoff.setUTCMonth(cutoff.getUTCMonth() - 12);
const cutoffStr = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD

const TYPE_LABELS: Record<string, string> = { D: "Detached", S: "Semi-detached", T: "Terraced", F: "Flat/maisonette", O: "Other" };

interface PostcodeAgg {
  sumPrice: number;
  count: number;
  minPrice: number;
  maxPrice: number;
  latestDate: string | null;
  latestPrice: number | null;
  sales: { date: string; price: number; type: string }[];
}
const byPostcode = new Map<string, PostcodeAgg>();
const outcodeSum: Map<string, { sum: number; count: number; latestDate: string | null }> = new Map();

function outcodeOf(postcode: string): string | null {
  const p = postcode.trim().toUpperCase();
  const sp = p.indexOf(" ");
  return sp > 0 ? p.slice(0, sp) : (p.length >= 2 ? p : null);
}
function fullPostcode(postcode: string): string {
  return postcode.trim().toUpperCase().replace(/\s+/, " ");
}

// Streaming CSV row parser that handles quoted fields spanning newlines.
function parseCsvStream(text: string, onRow: (cols: string[]) => void): void {
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        field = "";
        if (row.length > 1 || row[0] !== "") onRow(row);
        row = [];
      } else field += c;
    }
  }
  if (row.length > 0 || field !== "") { row.push(field); onRow(row); }
}

function fetchCsv(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchCsv(new URL(res.headers.location, url).toString()).then(resolve, reject);
        return;
      }
      if (!res.statusCode || res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        res.resume();
        return;
      }
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { buf += chunk; });
      res.on("end", () => resolve(buf));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function ingest(text: string): number {
  let header: string[] | null = null;
  let processed = 0;
  parseCsvStream(text, (cols) => {
    if (!header) { header = cols; return; }
    // PPD columns: TransactionID,Price,Date,Postcode,PropertyType,Old/New,Duration,
    // PAON,SAON,Street,Locality,Town,City,District,County,PPDcategory,RecordStatus
    const date = cols[2];
    const postcode = cols[3];
    const priceStr = cols[1];
    const typeCode = cols[4];
    if (!date || !postcode || !priceStr) return;
    const dateOnly = date.slice(0, 10); // "2026-02-05 00:00" -> "2026-02-05"
    if (dateOnly < cutoffStr) return; // older than 12 months
    const price = Number(priceStr);
    if (!Number.isFinite(price) || price <= 0) return;
    const oc = outcodeOf(postcode);
    if (!oc) return;

    // Outcode (district) summary — always kept (small).
    let os = outcodeSum.get(oc);
    if (!os) { os = { sum: 0, count: 0, latestDate: null }; outcodeSum.set(oc, os); }
    os.sum += price; os.count += 1;
    if (!os.latestDate || dateOnly > os.latestDate) os.latestDate = dateOnly;

    if (!PER_POSTCODE) return;

    const pc = fullPostcode(postcode);
    let agg = byPostcode.get(pc);
    if (!agg) { agg = { sumPrice: 0, count: 0, minPrice: price, maxPrice: price, latestDate: null, latestPrice: null, sales: [] }; byPostcode.set(pc, agg); }
    agg.sumPrice += price;
    agg.count += 1;
    if (price < agg.minPrice) agg.minPrice = price;
    if (price > agg.maxPrice) agg.maxPrice = price;
    if (!agg.latestDate || dateOnly > agg.latestDate) { agg.latestDate = dateOnly; agg.latestPrice = price; }
    // Keep the most-recent MAX_SALES_PER_POSTCODE sales (insert then trim by date).
    agg.sales.push({ date: dateOnly, price, type: TYPE_LABELS[typeCode] || typeCode || "—" });
    if (agg.sales.length > MAX_SALES_PER_POSTCODE) {
      agg.sales.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      agg.sales.length = MAX_SALES_PER_POSTCODE;
    }
    processed++;
  });
  return processed;
}

async function main() {
  for (const y of SOURCE_YEARS) {
    const url = `${PPD_BASE}${y}.csv`;
    try {
      console.log(`[property-sales] downloading ${url} ...`);
      const text = await fetchCsv(url);
      const n = ingest(text);
      console.log(`[property-sales] ingested ${n} sales (last 12mo) from ${url}`);
    } catch (e) {
      console.warn(`[property-sales] WARNING: failed to fetch ${url}: ${(e as Error).message}`);
    }
  }

  // Per-postcode output (capped list).
  const byPostcodeOut: Record<string, any> = {};
  if (PER_POSTCODE) {
    for (const [pc, agg] of byPostcode.entries()) {
      if (agg.count < MIN_SALES_FOR_LIST) continue;
      agg.sales.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      byPostcodeOut[pc] = {
        avgPrice: Math.round(agg.sumPrice / agg.count),
        salesCount: agg.count,
        minPrice: agg.minPrice,
        maxPrice: agg.maxPrice,
        latestDate: agg.latestDate,
        latestPrice: agg.latestPrice,
        sales: agg.sales,
      };
    }
  }

  // Compact outcode summary for the headline average.
  const byOutcodeOut: Record<string, { avgPrice: number; salesCount: number; latestDate: string | null }> = {};
  for (const [oc, os] of outcodeSum.entries()) {
    byOutcodeOut[oc] = { avgPrice: Math.round(os.sum / os.count), salesCount: os.count, latestDate: os.latestDate };
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: "HM Land Registry Price Paid Data (Open Government Licence v3.0)",
    coverage: "England & Wales",
    note: "Scotland (Registers of Scotland) and Northern Ireland (Land Registry NI) publish transaction-level sales data on a paid basis only; no free open registry exists, so they are not included.",
    windowMonths: 12,
    cutoff: cutoffStr,
    perPostcode: PER_POSTCODE,
    byPostcode: byPostcodeOut,
    byOutcode: byOutcodeOut,
  };

  const outPath = process.env.PROPERTY_SALES_OUT || OUT_DEFAULT;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out));
  const bytes = statSync(outPath).size;
  console.log(`[property-sales] wrote ${Object.keys(byPostcodeOut).length} postcodes / ${Object.keys(byOutcodeOut).length} outcodes -> ${outPath} (${(bytes / 1048576).toFixed(1)} MB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
