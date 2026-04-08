#!/usr/bin/env python3
"""
fetch_latest.py

Automated daily retrieval script for GRACE, IERS EOP, and GFZ-KP data.
Download latest data from all sources and update local files.
"""

import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta
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

        normalized.append(merged)

    return normalized


def fetch_latest_eop():
    """Fetch latest IERS EOP data from finals.all.json."""
    print("Fetching latest IERS EOP data...")

    url = "https://datacenter.iers.org/data/json/finals.all.json"

    try:
        with urllib.request.urlopen(url) as response:
            data = json.loads(response.read().decode("utf-8"))

        eop_data = data.get("EOP", {}).get("data", {}).get("timeSeries", [])

        result = []
        for entry in reversed(eop_data):  # Go backwards to find valid data
            time_info = entry.get("time", {})
            data_eop = entry.get("dataEOP", {})

            date_year = time_info.get("dateYear")
            date_month = time_info.get("dateMonth")
            date_day = time_info.get("dateDay")

            if not date_year:
                continue

            date_str = f"{date_year}-{date_month}-{date_day}"

            pole_data = data_eop.get("pole", [])
            x, y = None, None
            for item in pole_data:
                if item.get("source") == "BulletinA":
                    try:
                        x_str = item.get("X", "")
                        y_str = item.get("Y", "")
                        if x_str and x_str.strip() and y_str and y_str.strip():
                            x = float(x_str)
                            y = float(y_str)
                    except:
                        continue
                    break

            if x is not None and y is not None:
                result.append({"t": date_str, "xp": x, "yp": y})

                # Limit to last 30 days of valid data
                if len(result) >= 30:
                    break

        return list(reversed(result))  # Return in chronological order

    except Exception as e:
        print(f"  WARNING: Could not fetch EOP data: {e}")
        return None


def fetch_latest_grace():
    """Fetch latest GRACE manifest metadata only; do not emit placeholder values."""
    print("Fetching latest GRACE data...")

    manifest_url = "https://archive.podaac.earthdata.nasa.gov/podaac-ops-cumulus-public/virtual_collections/TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4/TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4_virtual_https.json"

    try:
        # Fetch manifest
        with urllib.request.urlopen(manifest_url) as response:
            manifest = json.loads(response.read().decode("utf-8"))

        # Decode time data
        time_ref = manifest.get("refs", {}).get("time/0")
        if isinstance(time_ref, str) and time_ref.startswith("base64:"):
            import base64
            import struct

            b64_data = time_ref[7:]
            padding = len(b64_data) % 4
            if padding:
                b64_data += "=" * (4 - padding)

            decoded = base64.b64decode(b64_data)

            try:
                import zlib

                decompressed = zlib.decompress(decoded, -zlib.MAX_WBITS)
            except:
                decompressed = decoded

            n_values = len(decompressed) // 8
            time_values = struct.unpack(f"{n_values}d", decompressed[: n_values * 8])

            from datetime import datetime as dt

            base_date = dt(2002, 1, 1)

            dates = [
                base_date + timedelta(days=float(days))
                for days in time_values
                if days >= 0
            ]

            print(f"  GRACE manifest covers {len(dates)} timestamps, but no real LWE values are retrieved by this script.")
            return []

        return []
    except Exception as e:
        print(f"  WARNING: Error fetching GRACE data: {e}")
        return []


def fetch_latest_kp(start_date, end_date):
    """Fetch latest GFZ-KP data."""
    print("Fetching latest GFZ-KP data...")

    indices = ["Kp", "ap", "Ap"]
    all_data = {}

    for index in indices:
        import urllib.parse

        base_url = "https://kp.gfz-potsdam.de/app/json/"
        params = {
            "start": f"{start_date}T00:00:00Z",
            "end": f"{end_date}T23:59:00Z",
            "index": index,
            "status": "def",
        }

        url = base_url + "?" + urllib.parse.urlencode(params)

        try:
            with urllib.request.urlopen(url) as response:
                data = json.loads(response.read().decode("utf-8"))

            dates = data.get("datetime", [])
            values = data.get(index, [])

            for i, date in enumerate(dates):
                date_key = date.split("T")[0]
                if date_key not in all_data:
                    all_data[date_key] = {"t": date_key}
                all_data[date_key][index.lower()] = (
                    values[i] if i < len(values) else None
                )

        except Exception as e:
            print(f"  WARNING: Error fetching {index}: {e}")
            continue

    # Sort by date
    sorted_dates = sorted(all_data.keys())
    return [all_data[d] for d in sorted_dates]


def save_json(filepath, data):
    """Save data to JSON file and mirror it for the UI."""
    output_path = write_json(os.path.basename(filepath), data)
    print(f"  Saved {len(data)} records to {output_path}")


def main():
    output_dir = os.path.join(os.path.dirname(__file__), "..", "data")

    print("=" * 60)
    print("Automated Data Retrieval")
    print(f"Timestamp: {datetime.now().isoformat()}")
    print("=" * 60)

    # Fetch EOP
    print("\n1. EOP Data (IERS)")
    eop_data = fetch_latest_eop()
    if eop_data is not None:
        save_json(os.path.join(output_dir, "eop_latest.json"), eop_data)

    # Fetch GRACE
    print("\n2. GRACE Data")
    grace_data = fetch_latest_grace()
    if grace_data is not None:
        save_json(os.path.join(output_dir, "grace_latest.json"), grace_data)

    # Fetch GFZ-KP
    print("\n3. GFZ-KP Data")
    # Use historical date range (latest full month - 1 day ago to avoid pending data)
    end_date = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=60)).strftime("%Y-%m-%d")

    kp_data = fetch_latest_kp(start_date, end_date)
    if kp_data is not None:
        save_json(os.path.join(output_dir, "geomag_gfz_latest.json"), kp_data)

    # Combine data
    print("\n4. Combined Data")
    try:
        eop_full = read_json("eop_historic.json")
        grace_full = read_json("grace_historic.json")
        geomag_full = normalize_geomag_records(read_json("geomag_gfz_kp.json"))

        eop_map = {d["t"]: {"xp": d["xp"], "yp": d["yp"]} for d in eop_full}
        grace_map = {
            d["t"]: {"lwe_mean": d["lwe_mean"]}
            for d in grace_full
            if d.get("lwe_mean") is not None
        }
        geomag_map = {d["t"]: d for d in geomag_full}

        combined = []
        for d in eop_full:
            record = {"t": d["t"], "xp": d["xp"], "yp": d["yp"]}

            if d["t"] in grace_map:
                record["grace_lwe_mean"] = grace_map[d["t"]]["lwe_mean"]
            if d["t"] in geomag_map:
                record["kp"] = geomag_map[d["t"]].get("kp")
                record["ap"] = geomag_map[d["t"]].get("ap")

            combined.append(record)

        save_json(os.path.join(output_dir, "combined_latest.json"), combined)
    except Exception as e:
        print(f"  WARNING: Could not create combined data: {e}")

    print("\n" + "=" * 60)
    print("Data retrieval complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()
