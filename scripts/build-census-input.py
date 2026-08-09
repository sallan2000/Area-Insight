#!/usr/bin/env python3
"""
build-census-input.py
=====================
Joins the three raw ONS Census 2021 LSOA CSVs (which you download) into the
single joined file that `npm run sync:census-demographics` ingests.

You download (free, Open Government Licence) from ONS Census 2021, LSOA geography:
  1. Age by 5-year bands          (table TS001)
  2. Household tenure             (table TS004)
  3. Car or van availability      (table TS030)

Place them in:  server/data/import/raw/   (any filenames).
This script auto-detects which is which by their column headers, joins on the
LSOA21 code, computes the percentages, and writes:
  server/data/import/census-demographics-input.csv

Run:  python3 scripts/build-census-input.py

The expected output columns are:
  lsoa21, population, ageUnder18, age65Plus,
  ownerOccupied, privateRented, socialRented, noCar

Notes on detection (robust to minor header wording):
  - LSOA code column: header contains "LSOA21" or "geography code" (case-insensitive).
  - Age: numeric band columns; under-18 = sum of bands whose label parses < 18;
         65+ = sum of bands whose label parses >= 65. Total = the "All usual
         residents" / "Total" column.
  - Tenure: keyword match on category labels -> Owned outright, Owned with a
         mortgage/loan, Shared ownership (counted as owned), Social rented,
         Private rented. Percentages are of total households.
  - Car: the "No cars or vans in household" column as a % of total households.
"""

import csv
import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DIR = os.path.join(ROOT, "server", "data", "import", "raw")
OUT_CSV = os.path.join(ROOT, "server", "data", "import", "census-demographics-input.csv")

# ---------- helpers ----------


def norm(s: str) -> str:
    return s.strip().lower()


def find_lsoa_col(headers):
    for i, h in enumerate(headers):
        n = norm(h)
        if "lsoa21" in n or "lsoa21cd" in n:
            return i
    # fallback: a header that looks like a geography code column
    for i, h in enumerate(headers):
        n = norm(h)
        if "geography code" in n or n in ("geographycode", "code"):
            return i
    return None


def detect_kind(headers):
    joined = " ".join(norm(h) for h in headers)
    scores = {
        "age": len(re.findall(r"\b(age|usual residents|0 |1 |2 |90\+)\b", joined)),
        "tenure": len(re.findall(r"owned|mortgage|shared ownership|social rented|private rented|rented", joined)),
        "car": len(re.findall(r"car|van|vehicle", joined)),
    }
    best = None
    best_score = -1
    for k, v in scores.items():
        if v > best_score:
            best_score = v
            best = k
    return best if best_score > 0 else None


def col_index(headers, *keywords):
    """Return first column index whose normalised header contains all keywords (OR across args)."""
    out = []
    for kw in keywords:
        for i, h in enumerate(headers):
            if kw in norm(h):
                out.append(i)
                break
    return out


def num(v):
    if v is None:
        return 0.0
    v = str(v).replace(",", "").strip()
    m = re.search(r"-?\d+(\.\d+)?", v)
    return float(m.group()) if m else 0.0


def load_rows(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        r = csv.reader(f)
        rows = list(r)
    if not rows:
        return [], []
    # skip leading blank/title rows until a header with a recognisable LSOA col
    start = 0
    for i, row in enumerate(rows):
        if any("lsoa21" in norm(c) or "geography code" in norm(c) for c in row):
            start = i
            break
    headers = rows[start]
    return headers, rows[start + 1:]


# ---------- per-table extraction ----------

def extract_age(headers, rows):
    """Return {lsoa: (total_residents, under18, over65)}"""
    li = find_lsoa_col(headers)
    # total column
    total_idx = None
    for i, h in enumerate(headers):
        n = norm(h)
        if "all usual residents" in n or n == "total" or "total usual residents" in n:
            total_idx = i
            break
    # numeric band columns: header should be a number-ish label
    band_cols = []
    for i, h in enumerate(headers):
        n = norm(h).strip()
        m = re.match(r"^(\d+)\s*(?:to\s*(\d+))?\s*(\+)?$", n)
        if m:
            lo = int(m.group(1))
            hi = int(m.group(2)) if m.group(2) else (200 if m.group(3) else lo)
            band_cols.append((i, lo, hi))
    out = {}
    for row in rows:
        if li is None or li >= len(row):
            continue
        code = row[li].strip()
        if not code:
            continue
        total = num(row[total_idx]) if (total_idx is not None and total_idx < len(row)) else 0.0
        under18 = sum(num(row[i]) for i, lo, hi in band_cols if hi < 18)
        over65 = sum(num(row[i]) for i, lo, hi in band_cols if lo >= 65)
        if total == 0 and (under18 or over65):
            total = sum(num(row[i]) for i, lo, hi in band_cols)
        out[code] = (total, under18, over65)
    return out


def extract_tenure(headers, rows):
    """Return {lsoa: (total_hh, owner, priv_rent, soc_rent)}"""
    li = find_lsoa_col(headers)
    # total households column
    total_idx = None
    for i, h in enumerate(headers):
        n = norm(h)
        if "total" in n and ("household" in n or "all" in n):
            total_idx = i
            break
    if total_idx is None:
        for i, h in enumerate(headers):
            if norm(h) == "total":
                total_idx = i
                break
    cats = {
        "owner_outright": col_index(headers, "owned outright"),
        "owner_mortgage": col_index(headers, "mortgage"),
        "shared": col_index(headers, "shared ownership"),
        "social": col_index(headers, "social rented"),
        "private": col_index(headers, "private rented"),
    }
    out = {}
    for row in rows:
        if li is None or li >= len(row):
            continue
        code = row[li].strip()
        if not code:
            continue
        total = num(row[total_idx]) if total_idx is not None else 0.0
        owner = sum(num(row[i]) for i in cats["owner_outright"] + cats["owner_mortgage"] + cats["shared"])
        priv = sum(num(row[i]) for i in cats["private"])
        soc = sum(num(row[i]) for i in cats["social"])
        out[code] = (total, owner, priv, soc)
    return out


def extract_car(headers, rows):
    """Return {lsoa: (total_hh, no_car)}"""
    li = find_lsoa_col(headers)
    total_idx = None
    for i, h in enumerate(headers):
        n = norm(h)
        if "total" in n and "household" in n:
            total_idx = i
            break
    if total_idx is None:
        for i, h in enumerate(headers):
            if norm(h) == "total":
                total_idx = i
                break
    no_car_idx = col_index(headers, "no cars or vans")
    out = {}
    for row in rows:
        if li is None or li >= len(row):
            continue
        code = row[li].strip()
        if not code:
            continue
        total = num(row[total_idx]) if total_idx is not None else 0.0
        no_car = sum(num(row[i]) for i in no_car_idx)
        out[code] = (total, no_car)
    return out


# ---------- main ----------

def main():
    if not os.path.isdir(RAW_DIR):
        print(f"[build-census-input] No raw dir: {RAW_DIR}")
        print("Download the three ONS Census 2021 LSOA CSVs (TS001 age, TS004 tenure,")
        print("TS030 car availability) into server/data/import/raw/ and re-run.")
        sys.exit(1)

    files = sorted(glob.glob(os.path.join(RAW_DIR, "*.csv")))
    if len(files) < 3:
        print(f"[build-census-input] Found {len(files)} CSV(s) in {RAW_DIR}; need 3 (age, tenure, car).")
        for f in files:
            print("   ", os.path.basename(f))
        sys.exit(1)

    age = tenure = car = None
    for f in files:
        headers, rows = load_rows(f)
        kind = detect_kind(headers)
        print(f"[build-census-input] {os.path.basename(f)} -> detected: {kind} ({len(rows)} rows)")
        if kind == "age" and age is None:
            age = extract_age(headers, rows)
        elif kind == "tenure" and tenure is None:
            tenure = extract_tenure(headers, rows)
        elif kind == "car" and car is None:
            car = extract_car(headers, rows)

    if age is None or tenure is None or car is None:
        print("[build-census-input] FAILED to detect all three tables (age/tenure/car).")
        print("Check the CSV headers match ONS Census 2021 LSOA layouts.")
        sys.exit(1)

    # join on LSOA21; union of codes
    codes = set(age) | set(tenure) | set(car)
    with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["lsoa21", "population", "ageUnder18", "age65Plus",
                    "ownerOccupied", "privateRented", "socialRented", "noCar"])
        n = 0
        for c in sorted(codes):
            a = age.get(c)
            t = tenure.get(c)
            ca = car.get(c)
            pop = a[0] if a else 0.0
            under18 = (a[1] / a[0] * 100) if a and a[0] else 0.0
            over65 = (a[2] / a[0] * 100) if a and a[0] else 0.0
            owner = (t[1] / t[0] * 100) if t and t[0] else 0.0
            priv = (t[2] / t[0] * 100) if t and t[0] else 0.0
            soc = (t[3] / t[0] * 100) if t and t[0] else 0.0
            noCar = (ca[1] / ca[0] * 100) if ca and ca[0] else 0.0
            w.writerow([c, round(pop), round(under18, 1), round(over65, 1),
                        round(owner, 1), round(priv, 1), round(soc, 1), round(noCar, 1)])
            n += 1
    print(f"[build-census-input] Wrote {n} LSOAs -> {OUT_CSV}")
    print("[build-census-input] Now run: npm run sync:census-demographics")


if __name__ == "__main__":
    main()
