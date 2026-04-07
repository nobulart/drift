#!/usr/bin/env python3
"""
build_geomag_gfz.py

Fetch and process GFZ-KP geomagnetic index data.
Supports multiple indices: Kp, ap, Ap, Cp, C9, SN, F10.7
"""

import os
import sys
import json
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
import urllib.request

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from data_paths import write_json


def fetch_kp_index(start_date, end_date, index="Kp", status="all"):
    """
    Fetch Kp index data from GFZ web service.

    Args:
        start_date: str, 'YYYY-MM-DD'
        end_date: str, 'YYYY-MM-DD'
        index: str, one of 'Kp', 'ap', 'Ap', 'Cp', 'C9', 'Hp30', 'Hp60', 'ap30', 'ap60', 'SN', 'Fobs', 'Fadj'
        status: str, 'all' or 'def' (for definitive values only)

    Returns:
        tuple: (dates, values, status_list)
    """
    import urllib.parse

    # Build URL
    base_url = "https://kp.gfz-potsdam.de/app/json/"
    params = {
        "start": f"{start_date}T00:00:00Z",
        "end": f"{end_date}T23:59:00Z",
        "index": index,
    }

    if index not in ["Hp30", "Hp60", "ap30", "ap60", "Fobs", "Fadj"]:
        params["status"] = status

    url = base_url + "?" + urllib.parse.urlencode(params)

    try:
        with urllib.request.urlopen(url) as response:
            data = json.loads(response.read().decode("utf-8"))

        dates = data.get("datetime", [])
        values = data.get(index, [])

        status_list = data.get("status", [])

        return dates, values, status_list
    except Exception as e:
        print(f"Error fetching {index} data: {e}")
        return [], [], []


def fetch_all_geomag_indices(start_date, end_date):
    """
    Fetch all relevant geomagnetic indices from GFZ-KP.

    Returns one daily record per date with mean values across all 3-hour samples.
    """
    indices = ["Kp", "ap", "Ap", "Cp", "C9"]
    daily_buckets = defaultdict(lambda: defaultdict(list))
    status_buckets = defaultdict(lambda: defaultdict(list))

    for index in indices:
        print(f"Fetching {index}...")
        # Use all available values so the live dashboard stays current up to the
        # latest provisional records instead of stopping at the definitive lag.
        dates, values, status = fetch_kp_index(start_date, end_date, index, "all")

        if not dates:
            print(f"  WARNING: No {index} data received")
            continue

        for i, date in enumerate(dates):
            date_key = date.split("T")[0]
            if i < len(values) and values[i] is not None:
                daily_buckets[date_key][index.lower()].append(values[i])
            if status and i < len(status) and status[i]:
                status_buckets[date_key][index.lower()].append(status[i])

    result = []
    for date_key in sorted(daily_buckets.keys()):
        record = {"t": date_key}
        day_values = daily_buckets[date_key]

        for index_name, values in day_values.items():
            if not values:
                continue
            record[index_name] = sum(values) / len(values)
            if index_name in {"kp", "ap"}:
                record[f"{index_name}_count"] = len(values)

        for index_name, statuses in status_buckets[date_key].items():
            if statuses:
                record[f"{index_name}_status"] = statuses[-1]

        result.append(record)

    return result


def download_and_parse_file(url, output_path):
    """
    Download and parse a GFZ Kp data file.

    Supported formats:
    - Kp_ap_since_1932.txt (3-hourly Kp and ap)
    - Kp_ap_Ap_SN_F107_since_1932.txt (daily with solar indices)
    """
    try:
        print(f"Downloading from {url}...")
        with urllib.request.urlopen(url) as response:
            content = response.read().decode("utf-8")

        with open(output_path, "w") as f:
            f.write(content)

        print(f"Saved to {output_path}")
        return output_path
    except Exception as e:
        print(f"Error downloading {url}: {e}")
        return None


def parse_kp_ap_file(filepath, daily_mean=True):
    """
    Parse Kp_ap_since_1932.txt file.

    Format: one line per 3-hour interval
    Columns: YYYY MM DD hh.h hh._m days days_m Kp ap D

    Args:
        filepath: path to Kp_ap_*.txt file
        daily_mean: if True, return daily averages; if False, return 3-hourly data

    Returns:
        list of dicts with t, kp, ap, ap_daily
    """
    data = []

    with open(filepath, "r") as f:
        lines = f.readlines()

    # Skip header lines
    for line in lines:
        if not line.strip() or line.startswith("#"):
            continue

        parts = line.split()
        if len(parts) < 10:
            continue

        try:
            year = int(parts[0])
            month = int(parts[1])
            day = int(parts[2])

            # Kp value (float, 3 decimal places)
            kp = float(parts[8])

            # ap value (integer)
            ap = int(parts[9])

            date_str = f"{year:04d}-{month:02d}-{day:02d}"

            if daily_mean:
                # We'll aggregate by date
                if not data or data[-1]["t"] != date_str:
                    data.append({"t": date_str, "kp_values": [kp], "ap_values": [ap]})
                else:
                    data[-1]["kp_values"].append(kp)
                    data[-1]["ap_values"].append(ap)
            else:
                # Return 3-hourly data
                data.append({"t": date_str, "kp": kp, "ap": ap})

        except (ValueError, IndexError) as e:
            continue

    # Calculate daily means if requested
    if daily_mean:
        result = []
        for record in data:
            if record["kp_values"]:
                result.append(
                    {
                        "t": record["t"],
                        "kp": sum(record["kp_values"]) / len(record["kp_values"]),
                        "ap": sum(record["ap_values"]) / len(record["ap_values"]),
                        "kp_count": len(record["kp_values"]),
                    }
                )
        return result

    return data


def parse_kp_ap_sn_f107_file(filepath):
    """
    Parse Kp_ap_Ap_SN_F107_since_1932.txt file.

    Format: one line per day
    Columns: YYYY MM DD days days_m BSR dB Kp*8 ap*8 Ap SN F10.7obs F10.7adj D

    Returns:
        list of dicts with t, kp (daily mean), ap (daily mean), ap_daily, sn, f107_obs, f107_adj
    """
    data = []

    with open(filepath, "r") as f:
        lines = f.readlines()

    for line in lines:
        if not line.strip() or line.startswith("#"):
            continue

        parts = line.split()
        if len(parts) < 23:
            continue

        try:
            year = int(parts[0])
            month = int(parts[1])
            day = int(parts[2])

            # Kp values (8 values, indices 8-15)
            kp_values = [float(parts[i]) for i in range(8, 16)]
            kp_mean = sum(kp_values) / len(kp_values)

            # ap values (8 values, indices 22-29)
            ap_values = [int(parts[i]) for i in range(16, 24)]
            ap_mean = sum(ap_values) / len(ap_values)

            # Ap (daily mean, index 32)
            ap_daily = int(parts[24])

            # SN (sunspot number, index 34)
            sn = int(parts[26]) if parts[26] != "-1" else None

            # F10.7obs (index 36)
            f107_obs = float(parts[30]) if parts[30] != "-1.0" else None

            # F10.7adj (index 38)
            f107_adj = float(parts[32]) if parts[32] != "-1.0" else None

            date_str = f"{year:04d}-{month:02d}-{day:02d}"

            record = {
                "t": date_str,
                "kp": kp_mean,
                "ap": ap_mean,
                "ap_daily": ap_daily,
                "kp_count": 8,
            }

            if sn is not None:
                record["sn"] = sn
            if f107_obs is not None:
                record["f107_obs"] = f107_obs
            if f107_adj is not None:
                record["f107_adj"] = f107_adj

            data.append(record)

        except (ValueError, IndexError) as e:
            continue

    return data


def main():
    # Determine date range
    start_date = "2003-01-01"
    end_date = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")

    print("GFZ-KP Geomagnetic Data Builder")
    print("=" * 40)

    # Option 1: Use web service (faster for recent data)
    print(f"\nFetching geomagnetic data via web service...")
    print(f"Date range: {start_date} to {end_date}")

    # Fetch all data
    data = fetch_all_geomag_indices(start_date, end_date)

    # Save to JSON
    output_file = write_json("geomag_gfz_kp.json", data)

    print(f"\nSaved {len(data)} data points to {output_file}")

    # Summary
    if data:
        kp_values = [d.get("kp") for d in data if d.get("kp") is not None]
        if kp_values:
            print(f"Kp range: {min(kp_values):.2f} - {max(kp_values):.2f}")
            print(f"Kp mean: {sum(kp_values) / len(kp_values):.2f}")

    print("\nTo combine with EOP data, use:")
    print("  python scripts/combine_data.py")


if __name__ == "__main__":
    main()
