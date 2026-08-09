/**
 * sync-schools.ts — Build server/data/schools.json for ENGLAND only (v2).
 *
 * SOURCE (official, Open Government Licence):
 *   Ofsted "Management information — state-funded schools — latest inspections"
 *   Published monthly on GOV.UK:
 *   https://www.gov.uk/government/statistical-data-sets/monthly-management-information-ofsteds-school-inspections-outcomes
 *
 *   Each month DfE/Ofsted publish a dated CSV at assets.publishing.service.gov.uk.
 *   The URL is date-stamped, so set OFSTED_CSV_URL to the current month's file
 *   (see the GOV.UK page) when the default below goes stale.
 *
 * WHY THIS SOURCE (v2 change):
 *   The previous version pulled the DfE GIAS "State-funded schools" CSV, which DfE
 *   retired in 2026 (the static endpoint now 404s). The Ofsted management-information
 *   CSV is the maintained replacement and — crucially — already carries URN, school
 *   name, Ofsted phase, postcode, local authority AND the latest overall-effectiveness
 *   rating, so it replaces both the old GIAS (directory) and Ofsted (ratings) feeds
 *   in one file. We geocode the postcode via postcodes.io to recover lat/lng for the
 *   server's name+proximity Ofsted match.
 *
 * Scotland / Wales / NI are intentionally out of scope here — see RESUME.md and the
 * dev-nations investigation. The schema is designed so they drop in later.
 *
 * Run:  npm run sync:schools
 *
 * Environment:
 *   OFSTED_CSV_URL  (optional) direct URL to the latest-inspections CSV
 *   SCHOOLS_OUT     (optional) output path, default server/data/schools.json
 *   GEOCODE         (optional) "0" to skip postcode geocoding (faster; lat/lng null)
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DEFAULT = join(__dirname, "..", "server", "data", "schools.json");

// Current file (as at 30 June 2026). Update this when GOV.UK publishes a newer month,
// or override with OFSTED_CSV_URL. The filename embeds the "as at" date.
const OFSTED_CSV_DEFAULT =
  "https://assets.publishing.service.gov.uk/media/6a54efeba6586e258d371d9c/Management_information_-_state-funded_schools_-_latest_inspections_as_at_30_June_2026.csv";

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

// Ofsted phase -> primary | secondary | other (we only score primary/secondary).
function toPhase(phase: string): "primary" | "secondary" | "other" {
  const p = phase.toLowerCase();
  if (p.includes("primary")) return "primary";
  if (p.includes("secondary")) return "secondary";
  if (p.includes("all-through") || p.includes("through") || p.includes("middle")) return "secondary";
  return "other";
}

// Rating: prefer numeric "Latest OEIF overall effectiveness" (1..4). Fall back to the
// text "Ungraded inspection overall outcome" (e.g. "School remains Outstanding").
// Returns 1..4 or null.
function toRating(rec: Record<string, string>): number | null {
  const numeric = (rec["Latest OEIF overall effectiveness"] || "").trim();
  if (numeric === "1" || numeric === "2" || numeric === "3" || numeric === "4") {
    return parseInt(numeric, 10);
  }
  const text = (rec["Ungraded inspection overall outcome"] || "").toLowerCase();
  if (text.includes("outstanding")) return 1;
  if (text.includes("good")) return 2;
  if (text.includes("requires improvement")) return 3;
  if (text.includes("inadequate")) return 4;
  return null;
}

// Map a 1..4 Ofsted rating to a 0..100 quality score used by the liveability model.
export function ratingToScore(rating: number | null): number | null {
  if (rating === null) return null;
  return { 1: 100, 2: 80, 3: 50, 4: 20 }[rating] ?? null;
}

async function fetchCsv(url: string, label: string): Promise<string> {
  console.log(`Fetching ${label}: ${url}`);
  const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error(`${label} HTTP ${res.status} from ${url}`);
  return res.text();
}

// postcodes.io geocode (same public API the server already uses). Rate-limited to
// ~10/sec; one call per unique postcode (most rows share postcodes across a school's
// sites, so the dedup keeps this to a few thousand calls).
const geoCache = new Map<string, { lat: number; lng: number } | null>();
async function geocode(postcode: string): Promise<{ lat: number; lng: number } | null> {
  const pc = postcode.replace(/\s+/g, " ").trim().toUpperCase();
  if (!pc) return null;
  if (geoCache.has(pc)) return geoCache.get(pc)!;
  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) { geoCache.set(pc, null); return null; }
    const j = await res.json();
    const r = j?.result;
    if (r?.latitude != null && r?.longitude != null) {
      const v = { lat: Number(r.latitude), lng: Number(r.longitude) };
      geoCache.set(pc, v);
      return v;
    }
  } catch {
    /* leave uncached so a later retry can succeed */
  }
  geoCache.set(pc, null);
  return null;
}

async function main() {
  const csvUrl = process.env.OFSTED_CSV_URL || OFSTED_CSV_DEFAULT;
  const outPath = process.env.SCHOOLS_OUT || OUT_DEFAULT;
  const doGeocode = (process.env.GEOCODE ?? "1") !== "0";

  const csv = await fetchCsv(csvUrl, "Ofsted latest-inspections CSV");
  const { rows } = parseCsv(csv);
  console.log(`  parsed ${rows.length} Ofsted rows`);

  const out: any[] = [];
  let skippedNoCoord = 0;
  let skippedOther = 0;
  let rated = 0;

  // Collect unique postcodes for batched geocoding.
  const uniquePostcodes = Array.from(new Set(rows.map((r) => (r["Postcode"] || "").trim().toUpperCase()).filter(Boolean)));
  console.log(`  ${uniquePostcodes.length} unique postcodes to geocode`);

  if (doGeocode) {
    let done = 0;
    for (const pc of uniquePostcodes) {
      await geocode(pc);
      done++;
      if (done % 250 === 0) {
        console.log(`  geocoded ${done}/${uniquePostcodes.length} postcodes`);
        await new Promise((res) => setTimeout(res, 100)); // gentle backoff
      }
    }
  }

  for (const s of rows) {
    const urn = (s["URN"] || "").trim();
    const postcode = (s["Postcode"] || "").trim().toUpperCase();
    const phase = toPhase(s["Ofsted phase"] || "");
    if (phase === "other") { skippedOther++; continue; }

    const geo = doGeocode ? geoCache.get(postcode) ?? null : null;
    if (!geo) { skippedNoCoord++; continue; }

    const rating = toRating(s);
    if (rating != null) rated++;
    out.push({
      urn,
      name: s["School name"] || "Unnamed",
      phase,
      lat: geo.lat,
      lng: geo.lng,
      postcode,
      rating, // 1..4 or null
      ratingScore: ratingToScore(rating), // 100/80/50/20 or null
      type: s["Type of education"] || "",
      nation: "england",
    });
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out));
  console.log(
    `Wrote ${out.length} schools (${rated} with ratings; skipped ${skippedOther} non-primary/secondary, ` +
    `${skippedNoCoord} without geocodable postcode) to ${outPath}`
  );
}

main().catch((e) => {
  console.error("sync-schools failed:", e);
  process.exit(1);
});
