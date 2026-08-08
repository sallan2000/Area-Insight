#!/usr/bin/env tsx
/**
 * validate-score.ts — Validity check for the ScoreMyStreet liveability score.
 *
 * Does our composite score actually track "is this a good place to live"?
 * The accepted official ground truth for area liveability in GB is the
 * Index/Simd of Multiple Deprivation (IMD / SIMD) rank: rank 1 = most deprived.
 * We invert it to 0–100 (most deprived -> 0) and correlate against our
 * `overallScore` (0–100) using Spearman's rank correlation (ρ, -1..+1).
 *
 * A positive ρ near +1 means high-liveability postcodes (per our score) really
 * are the less-deprived ones — i.e. the score is valid. Near 0 means it's noise.
 *
 * Usage:
 *   1. Start the app:  npm run dev   (serves on PORT, default 5000)
 *   2. tsx scripts/validate-score.ts [--server http://localhost:5000]
 *
 * Ground-truth reference data (bundled, git-ignored):
 *   server/data/imd-england.json     LSOA11 -> IMD 2019 rank  (MHCLG, OGL)
 *   server/data/scotland-simd-rank.json  DataZone -> SIMD 2020v2 overall rank (Scottish Gov, OGL)
 * Wales/NI lack a bundled reference here, so those postcodes are skipped (n reduced).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SERVER = process.argv.includes("--server")
  ? process.argv[process.argv.indexOf("--server") + 1]
  : process.env.SMS_SERVER || "http://localhost:5000";

// Curated spread of real GB postcodes across the deprivation spectrum.
const POSTCODES = [
  // Wealthy / low-deprivation
  "SW1A 1AA", "SW3 6RD", "W1K 1AA", "GU27 1AA", "KT11 1AA", "HP9 1AA",
  "EH3 9SH", "G12 8AA", "BS1 1UA", "OX1 2JD", "LS6 1AF", "M14 5SH",
  // Mid
  "B23 6AJ", "CF37 1PP", "EH11 2AA", "G31 1AA", "DE23 8AF", "PL1 1AA",
  "HU1 1AA", "DD1 1AA", "AB11 5AA", "NE1 5XF", "TS1 1AA", "BD3 8AA",
  // High-deprivation
  "B12 9QH", "M11 1AA", "L6 3AA", "G40 1AA", "G31 4AA", "L8 1AA",
];

function loadJSON(p: string) {
  return JSON.parse(readFileSync(join(process.cwd(), p), "utf-8"));
}
const imdEngland: Record<string, number> = loadJSON("server/data/imd-england.json");
const simdScotland: Record<string, { simdRank: number | null }> = loadJSON("server/data/scotland-simd-rank.json");

async function geocode(pc: string) {
  const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc.replace(/\s/g, ""))}`);
  if (!res.ok) return null;
  const j = await res.json();
  return j.result as any;
}

// Official "liveability" 0–100 (most deprived -> 0) from the IMD/SIMD rank.
// IMD/SIMD ranks: 1 = most deprived (worst), N = least deprived (best), so
// liveability = (rank - 1) / (N - 1) * 100  (rank 1 -> 0, rank N -> 100).
function officialScore(geo: any): number | null {
  const country = geo.country;
  const lsoa = geo.codes?.lsoa11;
  if (country === "England" && lsoa && imdEngland[lsoa] != null) {
    const N = 32844;
    return Math.round((imdEngland[lsoa] - 1) / (N - 1) * 100);
  }
  if (country === "Scotland" && lsoa && simdScotland[lsoa]?.simdRank != null) {
    const N = 6976;
    return Math.round((simdScotland[lsoa].simdRank! - 1) / (N - 1) * 100);
  }
  return null; // Wales/NI or unmatched — skip
}

async function ourScore(pc: string): Promise<number | null> {
  try {
    const res = await fetch(`${SERVER}/api/assess`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postcode: pc }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const s = j.scores;
    return s?.overall ?? null;
  } catch {
    return null;
  }
}

// Spearman ρ = Pearson correlation of the ranks of each series.
function spearman(a: number[], b: number[]): number {
  const rank = (xs: number[]) => {
    const sorted = [...xs].map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(xs.length).fill(0);
    sorted.forEach(([v, orig], i) => (r[orig] = i + 1));
    return r;
  };
  const ra = rank(a), rb = rank(b);
  const n = ra.length;
  const ma = ra.reduce((s, v) => s + v, 0) / n;
  const mb = rb.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

async function main() {
  console.log(`Validating against ${SERVER}\n`);
  const rows: Array<{ pc: string; country: string; official: number | null; ours: number | null }> = [];
  for (const pc of POSTCODES) {
    const geo = await geocode(pc);
    const official = geo ? officialScore(geo) : null;
    const ours = await ourScore(pc);
    const country = geo?.country ?? "?";
    rows.push({ pc, country, official, ours });
    console.log(
      `${pc.padEnd(9)} ${country.padEnd(9)} official=${official === null ? "  n/a" : String(official).padStart(4)}  ours=${ours === null ? "  n/a" : String(ours).padStart(4)}`
    );
    await new Promise((r) => setTimeout(r, 250)); // be gentle on the server
  }

  const valid = rows.filter((r) => r.official != null && r.ours != null);
  console.log(`\n${valid.length}/${rows.length} postcodes had both scores.`);
  if (valid.length < 5) {
    console.log("Too few valid pairs to correlate. Is the server running at " + SERVER + "?");
    process.exit(1);
  }
  const rho = spearman(valid.map((r) => r.ours!), valid.map((r) => r.official!));
  console.log(`\nSpearman ρ (our overall score vs official IMD/SIMD liveability): ${rho.toFixed(3)}`);
  console.log(rho > 0.6 ? "  → STRONG: our score tracks official liveability well." :
              rho > 0.3 ? "  → MODERATE: some signal, but weight calibration needed." :
              rho > 0   ? "  → WEAK: barely better than chance." :
                          "  → NEGATIVE: score is inverted vs reality — investigate.");
  console.log("\nUse this ρ to justify/retune the composite weights in calculateScores.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
