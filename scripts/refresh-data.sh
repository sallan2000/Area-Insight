#!/bin/bash
# refresh-data.sh — regenerate the git-ignored reference data used by the server.
# Intended to be run by a Replit Scheduled Deployment (weekly cron) AND is also
# invoked from scripts/post-merge.sh after every code pull.
#
# Files produced (all git-ignored, consumed from the local filesystem by the server):
#   server/data/schools.json              — England schools + Ofsted ratings (Ofsted latest-inspections CSV)
#   server/data/scotland-datazone-crime.json — Scottish SIMD 2020v2 crime proxy
#
# Each step is non-fatal: a transient upstream (Ofsted / SIMD) blip must not break the
# run, and the server degrades gracefully (neutral-80 schools / N/A Scottish safety).
set -u

echo "[refresh-data] $(date -u +%Y-%m-%dT%H:%M:%SZ) refreshing reference data..."
npm run sync:schools || echo "[refresh-data] WARNING: sync:schools failed"
npm run sync:scotland-crime || echo "[refresh-data] WARNING: sync:scotland-crime failed"
echo "[refresh-data] done."
