/**
 * sync-property-sales.ts — Build server/data/property-sales.json
 *
 * SOURCE (official, Open Government Licence v3.0):
 *   HM Land Registry Price Paid Data (PPD) — England & Wales.
 *   https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads
 *   Yearly CSV: https://price-paid-data.publicdata.landregistry.gov.uk/pp-YYYY.csv
 *
 * WHAT IT PRODUCES
 *   Per-OUTCODE aggregates (outcode = postcode district, e.g. "SW1A") for the
 *   trailing 12 months:
 *     { avgPrice, salesCount, latestDate, latestPrice }
 *   This powers the "Property Sales (last 12 months)" section: average price +
 *   number of sales + most recent sale, by postcode district.
 *
 * COVERAGE / HONESTY
 *   - England & Wales: REAL transaction-level data (HM Land Registry PPD).
 *   - Scotland (Registers of Scotland) and Northern Ireland (Land Registry NI):
 *     transaction-level data is PAID ONLY (RoS "All sales data" ~£1,465+VAT/month;
 *     LRNI bespoke). No free per-postcode/open registry exists. We do NOT fabricate
 *     figures. The output carries coverage: "England & Wales" and the report shows a
 *     clear note for Scottish/NI postcodes instead of invented numbers.
 *   (Full per-postcode transaction LIST and S/NI coverage are deferred — see plan.)
 *
 * Run:  npm run sync:property-sales
 * Env:  PROPERTY_SALES_OUT (default server/data/property-sales.json)
 *       YEAR_CURRENT / YEAR_PREV (override yearly CSV years; default current year + prev)
 */

import { writeFileSync, mkdirSync, createWriteStream } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import https from "https";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DEFAULT = join(__dirname, "..", "server", "data", "property-sales.json");

const now = new Date();
const YEAR_CURRENT = Number(process.env.YEAR_CURRENT || now.getUTCFullYear());
const YEAR_PREV = Number(process.env.YEAR_PREV || YEAR_CURRENT - 1);

const SOURCE_YEARS = [YEAR_PREV, YEAR_CURRENT];
const PPD_BASE = "https://price-paid-data.publicdata.landregistry.gov.uk/pp-";

// Trailing 12 months cutoff (inclusive). Anything older is ignored.
const cutoff = new Date();
cutoff.setUTCMonth(cutoff.getUTCMonth() - 12);
const cutoffStr = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD

interface OutcodeAgg {
  sumPrice: number;
  count: number;
  latestDate: string | null;
  latestPrice: number | null;
}
const byOutcode = new Map<string, OutcodeAgg>();

function outcodeOf(postcode: string): string | null {
  const p = postcode.trim().toUpperCase();
  const sp = p.indexOf(" ");
  return sp > 0 ? p.slice(0, sp) : (p.length >= 2 ? p : null);
}

// Streaming CSV row parser that handles quoted fields spanning newlines.
function parseCsvStream(text: string, onRow: (cols: string[]) => void, headerRow: string[]): void {
  const rows: string[][] = [];
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

// Simpler, memory-safe approach: collect full text then stream-parse once.
async function downloadAndAggregate(url: string): Promise<number> {
  console.log(`[property-sales] downloading ${url} ...`);
  const text = await fetchCsv(url);
  let header: string[] | null = null;
  let processed = 0;
  parseCsvStream(text, (cols) => {
    if (!header) { header = cols; return; }
    // PPD columns: TransactionID,Price,Date,Postcode,PropertyType,Old/New,Duration,
    // PAON,SAON,Street,Locality,Town,City,District,County,PPDcategory,RecordStatus
    const date = cols[2];
    const postcode = cols[3];
    const priceStr = cols[1];
    if (!date || !postcode || !priceStr) return;
    const dateOnly = date.slice(0, 10); // "2026-02-05 00:00" -> "2026-02-05"
    if (dateOnly < cutoffStr) return; // older than 12 months
    const price = Number(priceStr);
    if (!Number.isFinite(price) || price <= 0) return;
    const oc = outcodeOf(postcode);
    if (!oc) return;
    let agg = byOutcode.get(oc);
    if (!agg) { agg = { sumPrice: 0, count: 0, latestDate: null, latestPrice: null }; byOutcode.set(oc, agg); }
    agg.sumPrice += price;
    agg.count += 1;
    if (!agg.latestDate || dateOnly > agg.latestDate) { agg.latestDate = dateOnly; agg.latestPrice = price; }
    processed++;
  }, header || []);
  console.log(`[property-sales] processed ${processed} sales (last 12mo) from ${url}`);
  return processed;
}

async function main() {
  for (const y of SOURCE_YEARS) {
    const url = `${PPD_BASE}${y}.csv`;
    try {
      await downloadAndAggregate(url);
    } catch (e) {
      console.warn(`[property-sales] WARNING: failed to fetch ${url}: ${(e as Error).message}`);
    }
  }

  const byOutcodeOut: Record<string, { avgPrice: number; salesCount: number; latestDate: string | null; latestPrice: number | null }> = {};
  for (const [oc, agg] of byOutcode.entries()) {
    byOutcodeOut[oc] = {
      avgPrice: Math.round(agg.sumPrice / agg.count),
      salesCount: agg.count,
      latestDate: agg.latestDate,
      latestPrice: agg.latestPrice,
    };
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: "HM Land Registry Price Paid Data (Open Government Licence v3.0)",
    coverage: "England & Wales",
    note: "Scotland (Registers of Scotland) and Northern Ireland (Land Registry NI) publish transaction-level sales data on a paid basis only; no free open registry exists, so they are not included. Per-postcode transaction LIST is deferred.",
    windowMonths: 12,
    cutoff: cutoffStr,
    byOutcode: byOutcodeOut,
  };

  const outPath = process.env.PROPERTY_SALES_OUT || OUT_DEFAULT;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out));
  console.log(`[property-sales] wrote ${Object.keys(byOutcodeOut).length} outcodes -> ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
