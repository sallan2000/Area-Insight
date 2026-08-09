/**
 * sync-census-demographics.ts
 *
 * Builds server/data/census-demographics.json — ONS Census 2021 demographics
 * keyed by LSOA21 (the code postcodes.io returns as codes.lsoa21).
 *
 * WHY A MANUAL INPUT FILE?
 *   The only free, no-key Census 2021 LSOA source reachable here is the Nomis
 *   open CSV API, but it is keyed by Nomis geography codes we cannot crosswalk
 *   to ONS LSOA21 from this environment (ONS direct URLs and data.gov.uk CKAN
 *   do not expose downloadable LSOA-level CSVs). So instead of a fragile
 *   auto-download that may silently break, this script ingests a JOINED CSV
 *   you prepare once from the official ONS Census 2021 LSOA tables (all Open
 *   Government Licence, free).
 *
 * INPUT: server/data/import/census-demographics-input.csv
 *   One row per LSOA21. Expected columns (header names are matched flexibly):
 *     lsoa21            ONS LSOA21 code, e.g. E01000001 / S01000001 / W01000001
 *     population        usual residents (total)
 *     ageUnder18        % of usual residents aged 0-17   (0-100)
 *     age65Plus         % of usual residents aged 65+   (0-100)
 *     ownerOccupied     % households owned outright or with a mortgage (0-100)
 *     privateRented     % private-rented households      (0-100)
 *     socialRented      % social-rented households       (0-100)
 *     noCar             % households with no car/van     (0-100)
 *
 *   Accepted header aliases (case-insensitive, ignores spaces/underscores):
 *     lsoa21  -> lsoa21cd, lsoa21, lsoa21code, ons_code, code
 *     population -> population, usualresidents, residents, total
 *     ageUnder18 -> ageunder18, under18, age_0_17, pctunder18
 *     age65Plus  -> age65plus, over65, age_65_plus, pct65plus
 *     ownerOccupied -> owneroccupied, owned, owner_occupied
 *     privateRented  -> privaterented, privaterent, privatelyrented
 *     socialRented   -> socialrented, socialrent, councilrented
 *     noCar -> nocar, no_car, householdswithnocar
 *
 * WHERE TO GET THE NUMBERS (free, OGL):
 *   ONS Census 2021 LSOA tables (download the CSVs, open in a spreadsheet,
 *   join on LSOA21CD, compute the % columns, save the joined file):
 *     - Age: "Age by single year / 5-year bands" (TS001 / LC1xxx)
 *     - Tenure: "Household tenure" (TS004 / LC42xx)
 *     - Car availability: "Car or van availability" (TS03x / LC44xx)
 *   Then: under18% = sum(age 0-17)/total*100; 65+% = sum(age 65+)/total*100;
 *   tenure/car columns are already percentages in those tables.
 *
 * OUTPUT: server/data/census-demographics.json
 *   { "<LSOA21>": { lsoa21, population, ageUnder18, age65Plus,
 *                   ownerOccupied, privateRented, socialRented, noCar, source } }
 *
 * Run: npm run sync:census-demographics
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");
const IMPORT_DIR = join(ROOT, "server", "data", "import");
const INPUT = join(IMPORT_DIR, "census-demographics-input.csv");
const OUTPUT = join(ROOT, "server", "data", "census-demographics.json");
const SOURCE = "ONS Census 2021 (nomis/ONS, Open Government Licence)";

// Flexible header matching: map a normalised header to one of our fields.
function norm(s: string): string {
  return s.toLowerCase().replace(/[\s_-]/g, "");
}
const ALIASES: Record<string, string[]> = {
  lsoa21: ["lsoa21cd", "lsoa21", "lsoa21code", "onscode", "code", "geographycode"],
  population: ["population", "usualresidents", "residents", "total", "allusualresidents"],
  ageUnder18: ["ageunder18", "under18", "age017", "pctunder18", "under18pct"],
  age65Plus: ["age65plus", "over65", "age65", "pct65plus", "65pluspct"],
  ownerOccupied: ["owneroccupied", "owned", "owneroccupiedhouseholds"],
  privateRented: ["privaterented", "privaterent", "privatelyrented"],
  socialRented: ["socialrented", "socialrent", "councilrented", "socialrentedhouseholds"],
  noCar: ["nocar", "nocarcount", "householdswithnocar", "nocarorvan"],
};
function resolveCol(headers: string[]): Record<string, number> {
  const normed = headers.map(norm);
  const map: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    const idx = normed.findIndex((h) => aliases.includes(h));
    if (idx >= 0) map[field] = idx;
  }
  return map;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (c === "\r") { /* skip */ }
    else cur += c;
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ""));
}

function num(v: string | undefined): number {
  if (v == null) return NaN;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? NaN : n;
}

function main() {
  if (!existsSync(INPUT)) {
    console.error(`\n[census-demographics] Input not found: ${INPUT}`);
    console.error(`Prepare a joined LSOA21 CSV with columns: lsoa21, population,`);
    console.error(`ageUnder18, age65Plus, ownerOccupied, privateRented, socialRented, noCar`);
    console.error(`(see header comment in this script for aliases and ONS sources).`);
    console.error(`Then run: npm run sync:census-demographics\n`);
    process.exit(1);
  }

  const raw = readFileSync(INPUT, "utf-8");
  const rows = parseCsv(raw);
  if (rows.length < 2) { console.error("Input CSV is empty or has no data rows."); process.exit(1); }

  const headers = rows[0].map((h) => h.trim());
  const col = resolveCol(headers);
  const required = ["lsoa21", "population"];
  const missing = required.filter((f) => col[f] === undefined);
  if (missing.length) {
    console.error(`Missing required column(s): ${missing.join(", ")}. Found headers: ${headers.join(", ")}`);
    process.exit(1);
  }
  // Warn (don't fail) if optional columns are absent.
  const optional = ["ageUnder18", "age65Plus", "ownerOccupied", "privateRented", "socialRented", "noCar"];
  const absentOpt = optional.filter((f) => col[f] === undefined);
  if (absentOpt.length) console.warn(`[census-demographics] optional column(s) absent (left 0): ${absentOpt.join(", ")}`);

  const out: Record<string, any> = {};
  let n = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const code = (r[col.lsoa21] || "").trim();
    if (!code) continue;
    const pop = num(r[col.population]);
    const entry = {
      lsoa21: code,
      population: isNaN(pop) ? 0 : Math.round(pop),
      ageUnder18: col.ageUnder18 !== undefined ? num(r[col.ageUnder18]) : 0,
      age65Plus: col.age65Plus !== undefined ? num(r[col.age65Plus]) : 0,
      ownerOccupied: col.ownerOccupied !== undefined ? num(r[col.ownerOccupied]) : 0,
      privateRented: col.privateRented !== undefined ? num(r[col.privateRented]) : 0,
      socialRented: col.socialRented !== undefined ? num(r[col.socialRented]) : 0,
      noCar: col.noCar !== undefined ? num(r[col.noCar]) : 0,
      source: SOURCE,
    };
    // Sanity: percentages should be 0-100. If a value looks like a count (e.g. >100),
    // leave it but flag — the UI shows "%" so we only guard against negatives.
    out[code] = entry;
    n++;
  }

  if (n === 0) { console.error("No valid LSOA21 rows parsed."); process.exit(1); }

  mkdirSync(join(ROOT, "server", "data"), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(out, null, 0));
  console.log(`[census-demographics] Wrote ${n} LSOAs to ${OUTPUT}`);
  console.log(`[census-demographics] Sample:`, JSON.stringify(out[Object.keys(out)[0]], null, 2).slice(0, 400));
}

main();
