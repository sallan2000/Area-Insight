#!/usr/bin/env python3
"""
sync-scotland-crime.py — Regenerate server/data/scotland-datazone-crime.json.

Source: Scottish Government SIMD 2020v2 open data (Open Government Licence).
  - Crime DOMAIN RANK per Data Zone:  ranks .xlsx  (sheet "SIMD 2020v2 ranks")
  - Crime COUNT + RATE per Data Zone: indicators .xlsx (sheet "Data")
Both are plain xlsx downloads (no auth/CSRF). We join on Data_Zone and emit a
single JSON keyed by Data Zone (S010xxxxx) -> { crimeRank, crimeRate }.

Requires openpyxl:  pip install openpyxl   (or run inside a venv)

Usage:  python3 scripts/sync-scotland-crime.py
"""
import json
import os
import sys
import urllib.request

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl is required: pip install openpyxl")

OUT = os.path.join(os.path.dirname(__file__), "..", "server", "data", "scotland-datazone-crime.json")
RANKS_URL = ("https://www.gov.scot/binaries/content/documents/govscot/publications/statistics/2020/01/"
             "scottish-index-of-multiple-deprivation-2020-ranks-and-domain-ranks/documents/"
             "scottish-index-of-multiple-deprivation-2020-ranks-and-domain-ranks/"
             "scottish-index-of-multiple-deprivation-2020-ranks-and-domain-ranks/govscot%3Adocument/"
             "SIMD%2B2020v2%2B-%2Branks.xlsx")
IND_URL = ("https://www.gov.scot/binaries/content/documents/govscot/publications/statistics/2020/01/"
           "scottish-index-of-multiple-deprivation-2020-indicator-data/documents/simd_2020_indicators/"
           "simd_2020_indicators/govscot%3Adocument/SIMD%2B2020v2%2B-%2Bindicators.xlsx")


def download(url, path):
    print(f"Downloading {url.split('/')[-1]} ...")
    urllib.request.urlretrieve(url, path)
    print(f"  saved {os.path.getsize(path)} bytes")


def main():
    ranks_xlsx = "/tmp/simd_ranks.xlsx"
    ind_xlsx = "/tmp/simd_ind.xlsx"
    download(RANKS_URL, ranks_xlsx)
    download(IND_URL, ind_xlsx)

    wb = openpyxl.load_workbook(ranks_xlsx, read_only=True)
    ws = wb["SIMD 2020v2 ranks"]
    ranks = {r[0]: r[11] for r in ws.iter_rows(values_only=True)
             if r[0] and r[0] != "Data_Zone"}

    wb2 = openpyxl.load_workbook(ind_xlsx, read_only=True)
    ws2 = wb2["Data"]
    # cols 31 (crime_count) and 32 (crime_rate)
    ind = {r[0]: (r[31], r[32]) for r in ws2.iter_rows(values_only=True)
           if r[0] and r[0] != "Data_Zone"}

    out = {}
    for dz, rank in ranks.items():
        cnt, rate = ind.get(dz, (None, None))
        try:
            rate = round(float(rate), 2) if rate not in (None, "*") else None
        except (TypeError, ValueError):
            rate = None
        out[dz] = {"crimeRank": int(rank), "crimeRate": rate}

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f)
    print(f"Wrote {len(out)} Data Zone crime entries -> {os.path.abspath(OUT)}")


if __name__ == "__main__":
    main()
