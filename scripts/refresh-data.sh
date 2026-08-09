#!/bin/bash
# refresh-data.sh — regenerate the git-ignored reference data used by the server.
# Intended to be run by a Replit Scheduled Deployment (weekly cron) AND is also
# invoked from scripts/post-merge.sh after every code pull.
#
# Files produced (all git-ignored, consumed from the local filesystem by the server):
#   server/data/schools.json              — England schools + Ofsted ratings (Ofsted latest-inspections CSV)
#   server/data/scotland-datazone-crime.json — Scottish SIMD 2020v2 crime proxy
#
# Freshness guard: each sync is skipped if its output already exists and is newer than
# MAX_AGE_DAYS (default 6). This avoids hammering the upstream (Ofsted/SIMD) on every
# scheduled run while still guaranteeing the data is never more than ~a week stale.
# Force a refresh regardless of age with FORCE=1 (e.g. `FORCE=1 bash scripts/refresh-data.sh`).
#
# Each step is non-fatal: a transient upstream blip must not break the run, and the
# server degrades gracefully (neutral-80 schools / N/A Scottish safety).
set -u

MAX_AGE_DAYS="${MAX_AGE_DAYS:-6}"
FORCE_REFRESH="${FORCE:-0}"

# Print seconds-since-epoch of a file's mtime, or 0 if missing.
file_age_seconds() {
  local f="$1"
  if [ ! -f "$f" ]; then echo 0; return; fi
  # GNU/Linux stat; falls back to 0 if unavailable.
  stat -c '%Y' "$f" 2>/dev/null || echo 0
}

# Decide whether to run a sync for a given output file.
should_sync() {
  local out="$1"
  if [ "${FORCE_REFRESH}" = "1" ]; then return 0; fi
  if [ ! -f "$out" ]; then return 0; fi
  local mtime
  mtime="$(file_age_seconds "$out")"
  local now
  now="$(date +%s)"
  local max_age_sec=$(( MAX_AGE_DAYS * 86400 ))
  if [ "$mtime" -eq 0 ]; then return 0; fi
  if [ $(( now - mtime )) -gt "$max_age_sec" ]; then return 0; fi
  return 1
}

echo "[refresh-data] $(date -u +%Y-%m-%dT%H:%M:%SZ) refreshing reference data (max age ${MAX_AGE_DAYS}d)..."

# --- England schools + Ofsted ratings ---
SCHOOLS_OUT="server/data/schools.json"
if should_sync "$SCHOOLS_OUT"; then
  echo "[refresh-data] schools.json stale/missing — running sync:schools"
  npm run sync:schools || echo "[refresh-data] WARNING: sync:schools failed"
else
  echo "[refresh-data] schools.json fresh (<${MAX_AGE_DAYS}d) — skipped"
fi

# --- Scottish SIMD crime proxy ---
SCOT_OUT="server/data/scotland-datazone-crime.json"
if should_sync "$SCOT_OUT"; then
  echo "[refresh-data] scotland-datazone-crime.json stale/missing — running sync:scotland-crime"
  npm run sync:scotland-crime || echo "[refresh-data] WARNING: sync:scotland-crime failed"
else
  echo "[refresh-data] scotland-datazone-crime.json fresh (<${MAX_AGE_DAYS}d) — skipped"
fi

# --- Property sales (last 12 months), HM Land Registry PPD, England & Wales ---
PROP_OUT="server/data/property-sales.json"
if should_sync "$PROP_OUT"; then
  echo "[refresh-data] property-sales.json stale/missing — running sync:property-sales"
  npm run sync:property-sales || echo "[refresh-data] WARNING: sync:property-sales failed"
else
  echo "[refresh-data] property-sales.json fresh (<${MAX_AGE_DAYS}d) — skipped"
fi

# --- UK HPI average prices (all nations; council-area avg for Scotland/NI) ---
UKHPI_OUT="server/data/property-prices-ukhpi.json"
if should_sync "$UKHPI_OUT"; then
  echo "[refresh-data] property-prices-ukhpi.json stale/missing — running sync:property-prices-ukhpi"
  npm run sync:property-prices-ukhpi || echo "[refresh-data] WARNING: sync:property-prices-ukhpi failed"
else
  echo "[refresh-data] property-prices-ukhpi.json fresh (<${MAX_AGE_DAYS}d) — skipped"
fi

echo "[refresh-data] done."
