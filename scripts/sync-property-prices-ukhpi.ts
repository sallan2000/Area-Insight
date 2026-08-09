/**
 * sync-property-prices-ukhpi.ts — Build server/data/property-prices-ukhpi.json
 *
 * SOURCE (official, Open Government Licence v3.0):
 *   UK House Price Index (UKHPI) — "Average price" CSV, published monthly by HM Land
 *   Registry / ONS, covering England, Scotland, Wales AND Northern Ireland.
 *   https://www.gov.uk/government/collections/uk-house-price-index-reports
 *   File: https://publicdata.landregistry.gov.uk/market-trend-data/house-price-index-data/Average-prices-YYYY-MM.csv
 *
 * WHY THIS SOURCE (option B for Scotland/NI)
 *   HM Land Registry PPD (used by sync-property-sales.ts) is transaction-level but
 *   England & Wales ONLY — Scotland (Registers of Scotland) and NI (Land Registry NI)
 *   charge for per-postcode sales. UKHPI is the FREE, official, all-nations index and
 *   publishes an AVERAGE PRICE per geography down to council-area level for Scotland and
 *   Northern Ireland (ONS Area_Code S12xxxx / N09xxxx). So for S/NI postcodes we show the
 *   council-area average (clearly labelled "by council area") instead of a dead-end.
 *
 * OUTPUT
 *   For every geography in the latest month: { name, nation, avgPrice, date, annualChange }.
 *   Keyed by ONS Area_Code (matches postcodes.io codes.council_area / codes.laua). Small file.
 *
 * Run:  npm run sync:property-prices-ukhpi
 * Env:  UKHPI_OUT (default server/data/property-prices-ukhpi.json)
 *       UKHPI_YEARMONTH (override, e.g. 2026-05; defaults to current month, walks back on 404)
 */

import { writeFileSync, mkdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import https from "https";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DEFAULT = join(__dirname, "..", "server", "data", "property-prices-ukhpi.json");

const now = new Date();
let ym = process.env.UKHPI_YEARMONTH || `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

function nationFromCode(code: string): string {
  if (code.startsWith("S92") || code.startsWith("S12") || code.startsWith("S11")) return "Scotland";
  if (code.startsWith("N92") || code.startsWith("N09") || code.startsWith("N08")) return "Northern Ireland";
  if (code.startsWith("W92") || code.startsWith("W06") || code.startsWith("W")) return "Wales";
  if (code.startsWith("E92") || code.startsWith("E")) return "England";
  if (code.startsWith("K")) return "United Kingdom";
  return "Other";
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
      res.on("data", (c) => { buf += c; });
      res.on("end", () => resolve(buf));
      res.on("error", reject);
    }).on("error", reject);
  });
}

// Minimal RFC-4180-ish CSV parser (header row -> array of record objects).
function parseCsvRows(text: string): Record<string, string>[] {
  const lines: string[][] = [];
  let field = ""; let row: string[] = []; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") lines.push(row);
        row = [];
      } else field += c;
    }
  }
  if (row.length > 0 || field !== "") lines.push(row);
  if (lines.length === 0) return [];
  const header = lines[0];
  return lines.slice(1).map((cols) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => { o[h] = cols[i] ?? ""; });
    return o;
  });
}

async function main() {
  // Walk back up to 3 months to find a published file.
  let text: string | null = null;
  let usedYm = "";
  for (let back = 0; back <= 3; back++) {
    const tryYm = back === 0 ? ym : shiftMonth(ym, -back);
    const url = `https://publicdata.landregistry.gov.uk/market-trend-data/house-price-index-data/Average-prices-${tryYm}.csv`;
    try {
      console.log(`[ukhpi] downloading ${url} ...`);
      text = await fetchCsv(url);
      usedYm = tryYm;
      break;
    } catch (e) {
      console.warn(`[ukhpi] ${tryYm} not available (${(e as Error).message})`);
    }
  }
  if (!text) {
    console.error("[ukhpi] ERROR: could not fetch any UKHPI average-price file.");
    process.exit(1);
  }

  const rows = parseCsvRows(text);
  // Keep, per Area_Code, the row with the latest Date.
  const latest: Record<string, Record<string, string>> = {};
  for (const r of rows) {
    const code = r["Area_Code"];
    if (!code) continue;
    const cur = latest[code];
    if (!cur || r["Date"] > cur["Date"]) latest[code] = r;
  }

  const byCode: Record<string, { name: string; nation: string; avgPrice: number; date: string; annualChange: number | null }> = {};
  for (const [code, r] of Object.entries(latest)) {
    const price = Number(r["Average_Price"]);
    if (!Number.isFinite(price) || price <= 0) continue;
    const ac = r["Annual_Change"];
    byCode[code] = {
      name: r["Region_Name"],
      nation: nationFromCode(code),
      avgPrice: price,
      date: r["Date"],
      annualChange: ac === "" || ac == null ? null : Number(ac),
    };
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: "UK House Price Index (HM Land Registry / ONS), Open Government Licence v3.0",
    fileMonth: usedYm,
    note: "UKHPI average price per geography. For Scotland & Northern Ireland this is the council-area average — the average at council/area level, shown when postcode-specific sales information is not available.",
    byCode,
  };

  const outPath = process.env.UKHPI_OUT || OUT_DEFAULT;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out));
  const bytes = statSync(outPath).size;
  console.log(`[ukhpi] wrote ${Object.keys(byCode).length} geographies (file ${usedYm}) -> ${outPath} (${(bytes / 1024).toFixed(1)} KB)`);
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

main().catch((e) => { console.error(e); process.exit(1); });
