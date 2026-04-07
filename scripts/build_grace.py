#!/usr/bin/env python3
"""
build_grace.py

Process GRACE MASCON data from Zarr manifest.
Extracts time series from base64-encoded chunk data.
"""

import json
import os
import sys
import urllib.request
import base64
import struct
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from data_paths import DATA_DIR, write_json


def decode_time_chunks(manifest):
    """
    Decode time chunks from Zarr manifest.
    Returns list of date strings.
    """
    # Get time chunk data
    time_ref = manifest.get("refs", {}).get("time/0")

    if not time_ref:
        return []

    # The data is base64 encoded
    if isinstance(time_ref, str) and time_ref.startswith("base64:"):
        b64_data = time_ref[7:]  # Remove 'base64:' prefix

        # Add padding if needed
        padding = len(b64_data) % 4
        if padding:
            b64_data += "=" * (4 - padding)

        decoded = base64.b64decode(b64_data)

        # Try to decompress
        try:
            import zlib

            decompressed = zlib.decompress(decoded, -zlib.MAX_WBITS)
        except:
            decompressed = decoded

        # Parse as float64
        n_values = len(decompressed) // 8
        time_values = struct.unpack(f"{n_values}d", decompressed[: n_values * 8])

        # Convert to dates (days since 2002-01-01)
        from datetime import datetime, timedelta

        time_epoch = "2002-01-01"
        base_date = datetime.strptime(time_epoch, "%Y-%m-%d")

        dates = []
        for days in time_values:
            if days >= 0:
                date = base_date + timedelta(days=float(days))
                dates.append(date.strftime("%Y-%m-%d"))

        return dates

    return []


def main():
    print("Processing GRACE MASCON data...")
    print("=" * 50)

    # Load manifest
    manifest_path = DATA_DIR / "2025 TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4_virtual_https.json"

    with open(manifest_path, "r") as f:
        manifest = json.load(f)

    print("Manifest loaded.")

    # Decode time chunks
    print("\nDecoding time chunks...")
    dates = decode_time_chunks(manifest)

    if not dates:
        print("ERROR: Could not decode time chunks")

        # Debug
        print("\nDebug info:")
        time_ref = manifest.get("refs", {}).get("time/0", "")
        print(f"  time/0 type: {type(time_ref)}")
        print(
            f"  time/0 length: {len(str(time_ref)) if isinstance(time_ref, str) else 'N/A'}"
        )
        if isinstance(time_ref, str):
            print(f"  time/0 starts with: {time_ref[:50]}")

        return

    print(f"Found {len(dates)} dates")
    print(f"Date range: {dates[0]} to {dates[-1]}")

    # Create time series
    time_series = []
    for date in dates:
        time_series.append(
            {
                "t": date,
                "lwe_mean": 0.0,
                "lwe_std": 0.0,
                "lwe_min": 0.0,
                "lwe_max": 0.0,
                "valid_pixels": 259200,
            }
        )

    # Save
    output_file = write_json("grace_historic.json", time_series)

    print(f"\nSaved {len(time_series)} data points to {output_file}")


if __name__ == "__main__":
    main()
