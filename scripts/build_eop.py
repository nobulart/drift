#!/usr/bin/env python3
"""
build_eop.py

Parse IERS EOP data from finals.all.json or fetch latest rapid data.
Supports multiple input formats and produces consistent output.
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

from data_paths import DATA_DIR, write_json


def parse_finals_all_json(filepath):
    """
    Parse IERS finals.all.json data file.
    Returns list of {t, xp, yp, ut1_utc, lod} dictionaries.
    """
    with open(filepath, "r") as f:
        data = json.load(f)

    eop_data = data.get("EOP", {}).get("data", {}).get("timeSeries", [])

    result = []
    for entry in eop_data:
        time_info = entry.get("time", {})
        data_eop = entry.get("dataEOP", {})

        # Extract date
        date_year = time_info.get("dateYear")
        date_month = time_info.get("dateMonth")
        date_day = time_info.get("dateDay")

        if not date_year:
            continue

        date_str = f"{date_year}-{date_month}-{date_day}"

        # Extract pole data (use BulletinA final values)
        pole_data = data_eop.get("pole", [])
        x, y = None, None
        for item in pole_data:
            if item.get("source") == "BulletinA" and item.get("type") == "final":
                try:
                    x = float(item.get("X", 0))
                    y = float(item.get("Y", 0))
                except (ValueError, TypeError):
                    continue
                break

        # Extract UT1-UTC data (use BulletinA final values)
        ut_data = data_eop.get("UT", [])
        ut1_utc, lod = None, None
        for item in ut_data:
            if item.get("source") == "BulletinA" and item.get("type") == "final":
                try:
                    ut1_utc_str = item.get("UT1-UTC", "")
                    if ut1_utc_str and ut1_utc_str != "":
                        ut1_utc = float(ut1_utc_str)
                except (ValueError, TypeError):
                    pass

                try:
                    lod_str = item.get("LOD", "")
                    if lod_str and lod_str != "":
                        lod = float(lod_str)
                except (ValueError, TypeError):
                    pass
                break

        # Only include if we have valid pole data
        if x is not None and y is not None:
            record = {"t": date_str, "xp": x, "yp": y}

            if ut1_utc is not None:
                record["ut1_utc"] = ut1_utc
            if lod is not None:
                record["lod"] = lod

            result.append(record)

    return result


def fetch_finals_daily():
    """
    Fetch latest IERS finals.daily data from URL.
    Returns list of {t, xp, yp} dictionaries with most recent data.
    """
    url = "https://datacenter.iers.org/data/latestVersion/finals.daily.iau1980.txt"

    try:
        with urllib.request.urlopen(url) as response:
            content = response.read().decode("utf-8")
            lines = content.split("\n")

        data = []
        for line in lines:
            if not line.strip() or len(line) < 30:
                continue

            parts = line.split()
            if len(parts) >= 7:
                try:
                    year = 2000 + int(parts[0])
                    month = int(parts[1])
                    day = int(parts[2])

                    # MJD is parts[3]
                    mjd = float(parts[3])

                    # xp and yp are at specific indices
                    # Format:YY MM DD MJD I  xp  xp_std  yp  yp_std ...
                    # The actual data starts at index 4
                    # After I: xp=parts[5], xp_std=parts[6], yp=parts[7], yp_std=parts[8]

                    # Find where the I marker is
                    try:
                        i_idx = parts.index("I")
                        xp = float(parts[i_idx + 1])
                        yp = float(parts[i_idx + 3])
                    except (ValueError, IndexError):
                        continue

                    date = datetime(year, month, day)

                    data.append({"t": date.strftime("%Y-%m-%d"), "xp": xp, "yp": yp})
                except (ValueError, IndexError, TypeError):
                    continue

        return data
    except Exception as e:
        print(f"Error fetching IERS daily data: {e}")
        return []


def parseiers_c01_c04(filepath):
    """
    Parse IERS C01 or C04 format EOP data file.
    Returns list of {t, xp, yp} dictionaries.
    """
    data = []

    with open(filepath, "r") as f:
        lines = f.readlines()

    for line in lines:
        if line.startswith("COR") or line.startswith("PRED"):
            parts = line.split()
            if len(parts) >= 7:
                mjd = float(parts[1])
                xp = float(parts[5])
                yp = float(parts[6])

                mjd_epoch = datetime(1858, 11, 17)
                date = mjd_epoch + timedelta(days=mjd)

                data.append({"t": date.strftime("%Y-%m-%d"), "xp": xp, "yp": yp})

    return data


def fetch_grace_ftp():
    """
    Fetch latest GRACE data from GFZ FTP server.
    Returns list of {t, kp, ap, ap} dictionaries.
    """
    import tempfile
    import shutil

    url = "ftp://ftp.gfz.de/pub/home/obs/Kp_ap_Ap_SN_F107/Kp_ap_since_1932.txt"

    try:
        with urllib.request.urlopen(url) as response:
            # Read and parse line by line
            lines = response.read().decode("utf-8").split("\n")

        data = []
        for line in lines:
            if not line.strip() or line.startswith("#"):
                continue

            parts = line.split()
            if len(parts) >= 13:
                try:
                    year = int(parts[0])
                    month = int(parts[1])
                    day = int(parts[2])

                    # Kp values are at indices 4-11 (8 values per day)
                    # We'll just use the first Kp value for now
                    kp = float(parts[4])

                    # ap values are at indices 12-19
                    ap = int(parts[12])

                    # Ap is at index 21
                    ap_daily = int(parts[21])

                    date = datetime(year, month, day)

                    data.append(
                        {
                            "t": date.strftime("%Y-%m-%d"),
                            "kp": kp,
                            "ap": ap,
                            "ap_daily": ap_daily,
                        }
                    )
                except (ValueError, IndexError):
                    continue

        return data
    except Exception as e:
        print(f"Error fetching GFZ geomag data: {e}")
        return []


def main():
    # Parse finals.all.json for historical data
    finals_path = DATA_DIR / "finals.all.json"
    historical_data = []

    if finals_path.exists():
        print(f"Parsing finals.all.json: {finals_path}")
        historical_data = parse_finals_all_json(finals_path)
        print(f"  Found {len(historical_data)} historical records")
    else:
        print("finals.all.json not found. Will use only daily data (limited history)")

    # Fetch latest daily EOP data
    print("\nFetching latest IERS daily EOP data...")
    daily_data = fetch_finals_daily()
    print(f"  Found {len(daily_data)} daily records")

    if not daily_data:
        print("ERROR: Could not fetch daily data")
        if not historical_data:
            print("No data available!")
            return
        daily_data = []

    # Merge historical and daily data
    # Daily data takes precedence for overlapping dates
    historical_map = {d["t"]: d for d in historical_data}
    daily_map = {d["t"]: d for d in daily_data}

    # Get all unique dates
    all_dates = sorted(set(list(historical_map.keys()) + list(daily_map.keys())))

    print(f"\nMerging data sources...")
    print(f"  Historical dates: {len(historical_map)}")
    print(f"  Daily dates: {len(daily_map)}")
    print(f"  Total unique dates: {len(all_dates)}")

    # For each date, prefer daily data if available, otherwise use historical
    merged_data = []
    for date in all_dates:
        if date in daily_map:
            merged_data.append(
                {"t": date, "xp": daily_map[date]["xp"], "yp": daily_map[date]["yp"]}
            )
        elif date in historical_map:
            record = historical_map[date].copy()
            # Keep only xp and yp for consistency
            record = {"t": record["t"], "xp": record["xp"], "yp": record["yp"]}
            merged_data.append(record)

    print(f"  Merged records: {len(merged_data)}")

    # Save historic EOP data
    output_file = write_json("eop_historic.json", merged_data)

    print(f"\nSaved {len(merged_data)} EOP data points to {output_file}")
    print(
        f"Date range: {merged_data[0]['t'] if merged_data else 'N/A'} to {merged_data[-1]['t'] if merged_data else 'N/A'}"
    )

    # Check for GFZ Kp data
    # (We'll fetch it separately to avoid downloading large files unnecessarily)
    print("\nNote: GFZ Kp data requires separate processing.")
    print("Run scripts/build_geomag_gfz.py to build geomag data from GFZ sources.")


if __name__ == "__main__":
    main()
