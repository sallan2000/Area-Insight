/**
 * sync-schools.ts — Build server/data/schools.json for ENGLAND only (v1).
 *
 * Sources (official, Open Government Licence):
 *   - DfE GIAS "State-funded school fields CSV"  -> directory (URN, name, phase, lat/lng, postcode)
 *   - DfE "School inspections and outcomes" (Ofsted management info CSV) -> URN -> rating
 *
 * Both are downloaded, joined on URN, normalised, and written as JSON that the
 * server loads at startup (mirrors server/data/lsoa-council-tax-bands.json).
 *
 * Scotland / Wales / NI are intentionally out of scope here — see RESUME.md and
 * the dev-nations investigation. The schema is designed so they drop in later.
 *
 * Run:  npm run sync:schools
 *
 * Environment:
 *   GIAS_CSV_URL      (optional) direct URL to the state-funded-schools fields CSV
 *   OFSTED_CSV_URL    (optional) direct URL to the Ofsted outcomes CSV
 *   SCHOOLS_OUT       (optional) output path, default server/data/schools.json
 *
 * If the optional URLs are not provided, the script tries the known DfE GIAS
 * download endpoint pattern. The GIAS Downloads page generates dated file URLs,
 * so if the default fails, set GIAS_CSV_URL / OFSTED_CSV_URL explicitly.
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DEFAULT = join(__dirname, "..", "server", "data", "schools.json");

// England phase mapping from GIAS "PhaseOfEducation (code)" / "TypeOfEstablishment".
// We only care about splitting primary vs secondary for the liveability score.
function toPhase(rec: Record<string, string>): "primary" | "secondary" | "other" {
  const phase = (rec["PhaseOfEducation (code)"] || rec["PhaseOfEducation"] || "").toLowerCase();
  const type = (rec["TypeOfEstablishment"] || rec["TypeOfEstablishment (code)"] || "").toLowerCase();
  if (phase.includes("primary") || type.includes("primary")) return "primary";
  if (phase.includes("secondary") || type.includes("secondary")) return "secondary";
  if (type.includes("all-through") || type.includes("through")) return "secondary"; // treat as secondary feeder
  return "other";
}

// Ofsted overall effectiveness -> 1..4 (1 Outstanding .. 4 Inadequate), null if absent.
function toRating(rec: Record<string, string>): number | null {
  // Column name varies across releases; try the common ones.
  const raw =
    rec["OverallEffectiveness"] ??
    rec["OfstedRating"] ??
    rec["LatestOfstedRating"] ??
    rec["Rating"] ??
    "";
  const r = raw.trim().toLowerCase();
  if (!r) return null;
  if (r.startsWith("1") || r.includes("outstanding")) return 1;
  if (r.startsWith("2") || r.includes("good")) return 2;
  if (r.startsWith("3") || r.includes("requires improvement") || r.includes("satisfactory")) return 3;
  if (r.startsWith("4") || r.includes("inadequate")) return 4;
  return null;
}

// Map a 1..4 Ofsted rating to a 0..100 quality score used by the liveability model.
export function ratingToScore(rating: number | null): number | null {
  if (rating === null) return null;
  return { 1: 100, 2: 80, 3: 50, 4: 20 }[rating] ?? null;
}

// --- Minimal RFC-4180-ish CSV parser (handles quoted fields, embedded commas/newlines) ---
function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
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
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => h.trim());
  const out = rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, idx) => (o[h] = (r[idx] ?? "").trim()));
    return o;
  });
  return { headers, rows: out };
}

async function fetchCsv(url: string, label: string): Promise<string> {
  console.log(`Fetching ${label}: ${url}`);
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`${label} HTTP ${res.status} from ${url}`);
  return res.text();
}

async function main() {
  const giasUrl =
    process.env.GIAS_CSV_URL ||
    "https://get-information-schools.service.gov.uk/Downloads/StateFundedSchools/StateFundedSchools_CSV.csv";
  const ofstedUrl =
    process.env.OFSTED_CSV_URL ||
    "https://assets.publishing.service.gov.uk/media/ofsted-school-inspections-and-outcomes.csv";
  const outPath = process.env.SCHOOLS_OUT || OUT_DEFAULT;

  const giacCsv = await fetchCsv(giasUrl, "GIAS state-funded schools");
  const { rows: schools } = parseCsv(giacCsv);
  console.log(`  parsed ${schools.length} GIAS rows`);

  // Index Ofsted ratings by URN.
  let ratingsByUrn = new Map<string, number | null>();
  try {
    const ofstedCsv = await fetchCsv(ofstedUrl, "Ofsted outcomes");
    const { rows: ofsted } = parseCsv(ofstedCsv);
    console.log(`  parsed ${ofsted.length} Ofsted rows`);
    for (const r of ofsted) {
      const urn = (r["URN"] || "").trim();
      if (urn) ratingsByUrn.set(urn, toRating(r));
    }
  } catch (e: any) {
    console.warn(`  Ofsted fetch failed (${e.message}); ratings will be null. Re-run after setting OFSTED_CSV_URL.`);
  }

  const out: any[] = [];
  let skippedNoCoord = 0;
  for (const s of schools) {
    const urn = (s["URN"] || "").trim();
    const lat = parseFloat(s["Latitude"]);
    const lng = parseFloat(s["Longitude"]);
    if (!urn || isNaN(lat) || isNaN(lng)) { skippedNoCoord++; continue; }
    const phase = toPhase(s);
    if (phase === "other") continue; // only score primary/secondary for now
    const rating = ratingsByUrn.get(urn) ?? null;
    out.push({
      urn,
      name: s["EstablishmentName"] || s["SchoolName"] || "Unnamed",
      phase,
      lat,
      lng,
      postcode: s["Postcode"] || "",
      rating, // 1..4 or null
      ratingScore: ratingToScore(rating), // 100/80/50/20 or null
      type: s["TypeOfEstablishment"] || "",
      nation: "england",
    });
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out));
  console.log(
    `Wrote ${out.length} schools (${out.filter((x) => x.rating).length} with ratings) to ${outPath} ` +
    `(skipped ${skippedNoCoord} without coordinates).`
  );
}

main().catch((e) => {
  console.error("sync-schools failed:", e);
  process.exit(1);
});
