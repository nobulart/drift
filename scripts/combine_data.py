#!/usr/bin/env python3
"""
combine_data.py

Combine EOP, GRACE, and GFZ-KP data into a unified format.
Supports historical and near-real-time data.
"""

import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
import urllib.request
import numpy as np
from scipy.signal import savgol_filter

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

    # Combine data points
    eop_map = {d["t"]: {"xp": d["xp"], "yp": d["yp"]} for d in eop_data}

    # Start with EOP as base
    combined = []

    for eop_point in eop_data:
        date = eop_point["t"]
        record = {"t": date, "xp": eop_point["xp"], "yp": eop_point["yp"]}

        # Add GRACE data if available
        if grace_data:
            for grace_point in grace_data:
                if grace_point["t"] == date:
                    record["grace_lwe_mean"] = grace_point["lwe_mean"]
                    record["grace_lwe_std"] = grace_point["lwe_std"]
                    break

        combined.append(record)

    # Merge cached GFZ-KP data for overlapping period
    if combined:
        print("Merging cached GFZ-KP data from geomag_gfz_kp.json...")
        kp_map = {d["t"]: d for d in geomag_data}

        for record in combined:
            date = record["t"]
            if date in kp_map:
                if "kp" in kp_map[date]:
                    record["kp"] = kp_map[date]["kp"]
                if "ap" in kp_map[date]:
                    record["ap"] = kp_map[date]["ap"]
                if "ap_daily" in kp_map[date]:
                    record["ap_daily"] = kp_map[date]["ap_daily"]
            else:
                # Fill missing Kp with NaN for interpolation
                if "kp" not in record:
                    record["kp"] = np.nan
                if "ap" not in record:
                    record["ap"] = np.nan

        # Interpolate Kp and ap to fill gaps, then smooth
        kp_values = np.array([d.get("kp", np.nan) for d in combined])
        ap_values = np.array([d.get("ap", np.nan) for d in combined])

        # Get valid indices for interpolation
        valid_kp = ~np.isnan(kp_values)
        valid_ap = ~np.isnan(ap_values)

        if np.any(valid_kp):
            kp_interp = np.interp(
                np.arange(len(combined)), np.where(valid_kp)[0], kp_values[valid_kp]
            )
            kp_smooth = savgol_filter(kp_interp, 61, 3)
            for i, record in enumerate(combined):
                record["kp"] = float(kp_smooth[i])

        if np.any(valid_ap):
            ap_interp = np.interp(
                np.arange(len(combined)), np.where(valid_ap)[0], ap_values[valid_ap]
            )
            ap_smooth = savgol_filter(ap_interp, 61, 3)
            for i, record in enumerate(combined):
                record["ap"] = float(ap_smooth[i])

    # Save combined data
    output_file = write_json("combined_historic.json", combined)

    print(f"\nSaved {len(combined)} combined data points to {output_file}")
    print(f"Date range: {combined[0]['t']} to {combined[-1]['t']}")

    # Summary statistics
    print(f"Kp range: {combined[0]['t']} to {combined[-1]['t']}")

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
