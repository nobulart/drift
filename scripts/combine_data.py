#!/usr/bin/env python3
"""
combine_data.py

Combine EOP, GRACE, and GFZ-KP data into a unified format.
Supports historical and near-real-time data.
"""

import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from data_paths import read_json, write_json


def normalize_geomag_records(records):
    """Collapse multiple 3-hourly GFZ samples into one daily record."""
    buckets = {}

    for record in records:
        date_key = str(record.get("t", "")).split("T")[0]
        if not date_key:
            continue
        buckets.setdefault(date_key, []).append(record)

    normalized = []
    for date_key in sorted(buckets.keys()):
        bucket = buckets[date_key]
        merged = {"t": date_key}

        for field in ("kp", "ap", "cp", "c9"):
            values = [entry.get(field) for entry in bucket if entry.get(field) is not None]
            if values:
                merged[field] = float(sum(values) / len(values))
                if field in {"kp", "ap"}:
                    merged[f"{field}_count"] = len(values)

        for field in ("kp_status", "ap_status", "cp_status", "c9_status"):
            for entry in reversed(bucket):
                if entry.get(field):
                    merged[field] = entry[field]
                    break

        normalized.append(merged)

    return normalized


def main():
    print("Combining geodetic and geomagnetic data...")
    print("=" * 50)

    # Load existing data
    try:
        eop_data = read_json("eop_historic.json")
        grace_data = read_json("grace_historic.json")
        geomag_data = normalize_geomag_records(read_json("geomag_gfz_kp.json"))
    except FileNotFoundError as exc:
        print(f"ERROR: {exc}")
        sys.exit(1)

    if not eop_data:
        print("ERROR: eop_historic.json not found. Run scripts/build_eop.py first.")
        sys.exit(1)

    # Start with EOP as base
    combined = []
    grace_map = {d["t"]: d for d in grace_data if d.get("lwe_mean") is not None}
    kp_map = {d["t"]: d for d in geomag_data}

    for eop_point in eop_data:
        date = eop_point["t"]
        record = {"t": date, "xp": eop_point["xp"], "yp": eop_point["yp"]}

        # Add GRACE data if available
        grace_point = grace_map.get(date)
        if grace_point:
            record["grace_lwe_mean"] = grace_point["lwe_mean"]
            if grace_point.get("lwe_std") is not None:
                record["grace_lwe_std"] = grace_point["lwe_std"]

        geomag_point = kp_map.get(date)
        if geomag_point:
            for field in ("kp", "ap", "cp", "c9", "ap_daily", "kp_count", "ap_count"):
                if geomag_point.get(field) is not None:
                    record[field] = geomag_point[field]

        combined.append(record)

    # Save combined data
    output_file = write_json("combined_historic.json", combined)

    print(f"\nSaved {len(combined)} combined data points to {output_file}")
    print(f"Date range: {combined[0]['t']} to {combined[-1]['t']}")

    # Summary statistics
    kp_values = [d.get("kp") for d in combined if d.get("kp") is not None]
    if kp_values:
        print(f"\nSummary:")
        print(f"  Kp range: {min(kp_values):.2f} - {max(kp_values):.2f}")
        print(f"  Kp mean: {sum(kp_values) / len(kp_values):.2f}")
    else:
        print("\nSummary:")
        print("  No Kp data available")

    xp_values = [d["xp"] for d in combined]
    yp_values = [d["yp"] for d in combined]
    print(f"  XP range: {min(xp_values):.4f} - {max(xp_values):.4f} arcsec")
    print(f"  YP range: {min(yp_values):.4f} - {max(yp_values):.4f} arcsec")


if __name__ == "__main__":
    main()
