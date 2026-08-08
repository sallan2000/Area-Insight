# Score validity & confidence

ScoreMyStreet produces a single 0–100 **Liveability Score**. This document explains
how honestly to read it, and how the score is validated against official data.

## What the score is — and isn't

The composite is a **weighted heuristic**, not a measured quantity:

```
overall = 0.25·transport + 0.35·√safety·10 + 0.20·schools + 0.20·amenities
```

The weights and the `√safety·10` transform are tuning constants chosen for sensible
behaviour, **not** derived from a ground-truth regression. The score measures
"how this postcode performs on the four inputs we can collect," which is a
reasonable proxy for liveability but is **not** validated against resident
experience or house prices unless `npm run validate:score` is run.

## Confidence bands

Every report carries a `confidence` object (also shown in the UI and email) that
qualifies how much of the score rests on real measurements vs estimates:

- **transport / schools / amenities** — `measured` when Overpass/OSM returns live
  data; `estimated` when Overpass was unreachable (the report then falls back to
  degraded OSM heuristics).
- **safety** — `measured` (England/Wales police.uk, or Scotland SIMD 2020v2 proxy),
  or `unavailable` if no source resolved.
- **environment (air)** — `measured` when a real DEFRA station is nearby; `estimated`
  when the location-based heuristic is used.

Overall band:
- **high** — all four core components measured.
- **medium** — 1–2 components estimated (e.g. air-quality heuristic only).
- **low** — Overpass failed (most of transport/schools/amenities estimated) **or**
  safety unavailable.

The band is computed purely from signals already collected during scoring — no extra
fetches. It is a **data-quality** statement, not a claim that a "high" score is
accurate, only that it is built from real inputs.

## Validation against official deprivation indices

The accepted official measure of area liveability in Great Britain is the
The Index/SimD of Multiple Deprivation (IMD for England, SIMD for Scotland) — a
rank per small area (LSOA / Data Zone) where rank 1 = most deprived. We invert it
to 0–100 (most deprived → 0, least deprived → 100) and treat it as ground truth
for "is this a good place to live."

`scripts/validate-score.ts` scores a curated spread of real postcodes through the
**live server pipeline** (`POST /api/assess`), joins each to its official IMD/SIMD
rank, and reports **Spearman's ρ** between our `overallScore` and the official
inverted rank:

```bash
npm run dev                      # start the app (PORT, default 5000)
npm run validate:score           # against http://localhost:5000
# or: npm run validate:score -- --server https://your-host
```

Reference data (bundled, git-ignored, Open Government Licence):
- `server/data/imd-england.json` — LSOA11 → IMD 2019 rank (MHCLG).
- `server/data/scotland-simd-rank.json` — Data Zone → SIMD 2020v2 overall rank
  (Scottish Government).

Interpreting ρ:
- **> 0.6** strong — the score tracks official liveability well.
- **0.3–0.6** moderate — real signal, but the composite weights should be retuned.
- **≤ 0** weak/inverted — the score is not measuring what we think; investigate.

## Suggested calibration loop

1. Run `validate:score` to get a baseline ρ.
2. Adjust the weights / transforms in `calculateScores` (server/routes.ts).
3. Re-run `validate:score` and confirm ρ improves.
4. Record the chosen weights + ρ in this file so the decision is reproducible.

> Wales and Northern Ireland are not yet covered by the bundled reference data, so
> they are skipped by the harness (n is reduced). Add `wimd-wales.json` /
> `nimdm-ni.json` to extend coverage.
>
> The reference indices are 2019 (England) / 2020 (Scotland) vintage and are
> decadal — they age slowly and are appropriate as a stable validation baseline.
