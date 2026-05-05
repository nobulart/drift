#!/usr/bin/env python3
"""
build_eop.py

Parse IERS EOP data from finals.all.json and finals.daily.json, then merge
both sources so the output eop_historic.json covers the full historic
timespan with the most-recent confirmed data from the daily feed.
"""

import json
import re
import sys
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from data_paths import DATA_DIR, write_json

DAILY_JSON_URL = "https://datacenter.iers.org/data/json/finals.daily.json"
DAILY_2000A_JSON_URL = "https://datacenter.iers.org/data/json/finals2000A.daily.json"
ALL_JSON_URL = "https://datacenter.iers.org/data/json/finals.all.json"
EOP_DATASETS = {
    "finals2000a": {
        "label": "finals.all (IAU2000)",
        "metadata_url": "https://datacenter.iers.org/versionMetadata.php?filename=latestVersionMeta/9_FINALS.ALL_IAU2000_V2013_019.txt",
        "json_url": "https://datacenter.iers.org/data/json/finals2000A.all.json",
        "output": "eop_finals2000a_historic.json",
        "parser": "finals_json",
        "daily_tail": "finals2000a",
    },
    "c04": {
        "label": "EOP 20u24 C04 (IAU2000A)",
        "metadata_url": "https://datacenter.iers.org/versionMetadata.php?filename=latestVersionMeta/254_EOP_C04_20u24.62-NOW254.txt",
        "download_url": "https://datacenter.iers.org/data/254/eopc04_20u24.1962-now.txt",
        "output": "eop_c04_historic.json",
        "parser": "c04",
        "daily_tail": "finals2000a",
    },
}

MJD_EPOCH = datetime(1858, 11, 17)


def extract_finals(data_object):
    """Extract confirmed (BulletinA final) records from a finals JSON object.

    Returns a list of dicts sorted ascending by date string::

        {"t": "YYYY-MM-DD", "xp": ..., "yp": ...[, "ut1_utc": ..., "lod": ...]}
    """
    eop_data = data_object.get("EOP", {}).get("data", {}).get("timeSeries", [])
    result = []

    for entry in eop_data:
        time_info = entry.get("time", {})
        data_eop = entry.get("dataEOP", {})

        date_year = time_info.get("dateYear")
        date_month = time_info.get("dateMonth")
        date_day = time_info.get("dateDay")

        if not date_year:
            continue

        date_str = f"{date_year}-{date_month}-{date_day}"

        # Extract pole data (use BulletinA final values only)
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

        if x is None or y is None:
            continue

        record = {"t": date_str, "xp": x, "yp": y}

        # Extract UT1-UTC data (use BulletinA final values)
        ut_data = data_eop.get("UT", [])
        for item in ut_data:
            if item.get("source") == "BulletinA" and item.get("type") == "final":
                try:
                    ut1_utc_str = item.get("UT1-UTC", "")
                    if ut1_utc_str and ut1_utc_str != "":
                        record["ut1_utc"] = float(ut1_utc_str)
                except (ValueError, TypeError):
                    pass

                try:
                    lod_str = item.get("LOD", "")
                    if lod_str and lod_str != "":
                        record["lod"] = float(lod_str)
                except (ValueError, TypeError):
                    pass
                break

        result.append(record)

    return result


def parse_finals_all_json(filepath):
    """Parse local finals.all.json for historic EOP data."""
    with open(filepath, "r") as f:
        data = json.load(f)
    return extract_finals(data)


def fetch_from_daily_json():
    """Fetch confirmed EOP data from the finals.daily.json endpoint."""
    print(f"  Fetching {DAILY_JSON_URL} ...")
    try:
        with urllib.request.urlopen(DAILY_JSON_URL) as response:
            daily_json = json.loads(response.read().decode("utf-8"))
            return extract_finals(daily_json)
    except Exception as e:
        print(f"  ERROR: Could not fetch from {DAILY_JSON_URL}: {e}")
        return []


def fetch_from_daily_2000a_json():
    """Fetch confirmed EOP data from the finals2000A.daily.json endpoint."""
    print(f"  Fetching {DAILY_2000A_JSON_URL} ...")
    try:
        with urllib.request.urlopen(DAILY_2000A_JSON_URL) as response:
            daily_json = json.loads(response.read().decode("utf-8"))
            return extract_finals(daily_json)
    except Exception as e:
        print(f"  ERROR: Could not fetch from {DAILY_2000A_JSON_URL}: {e}")
        return []


def fetch_from_all_json():
    """Fetch the full cumulative finals.all.json from IERS."""
    print(f"  Fetching {ALL_JSON_URL} ...")
    try:
        with urllib.request.urlopen(ALL_JSON_URL) as response:
            all_json = json.loads(response.read().decode("utf-8"))
            return extract_finals(all_json)
    except Exception as e:
        print(f"  ERROR: Could not fetch from {ALL_JSON_URL}: {e}")
        return []


def fetch_text(url):
    """Fetch a text payload from a URL."""
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read().decode("utf-8", errors="replace")


def resolve_metadata_download_url(metadata_url, fallback_url):
    """Resolve the first IERS /data/... download URL from a version metadata page."""
    try:
        metadata = fetch_text(metadata_url)
    except Exception as exc:
        print(f"  WARN: Could not read metadata {metadata_url}: {exc}")
        return fallback_url

    match = re.search(r'https://datacenter\.iers\.org/data/[^\s"<>]+', metadata)
    if match:
        return match.group(0)

    match = re.search(r'href=["\'](?P<href>/data/[^"\']+)["\']', metadata)
    if match:
        return f"https://datacenter.iers.org{match.group('href')}"

    return fallback_url


def mjd_to_date_string(mjd):
    return (MJD_EPOCH + timedelta(days=round(float(mjd)))).strftime("%Y-%m-%d")


def parse_c04_text(content):
    """Parse the IERS C04 20u24 format: YR, MM, DD, HH, MJD, x, y, UT1-UTC, ..."""
    records = []

    for line in content.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        parts = stripped.split()
        if len(parts) < 8:
            continue

        try:
            year = int(parts[0])
            month = int(parts[1])
            day = int(parts[2])
            xp = float(parts[5])
            yp = float(parts[6])
        except (TypeError, ValueError):
            continue

        record = {"t": datetime(year, month, day).strftime("%Y-%m-%d"), "xp": xp, "yp": yp}
        try:
            record["ut1_utc"] = float(parts[7])
        except (TypeError, ValueError):
            pass
        if len(parts) > 12:
            try:
                record["lod"] = float(parts[12])
            except (TypeError, ValueError):
                pass
        records.append(record)

    return sorted(records, key=lambda item: item["t"])


def fetch_alternate_eop_dataset(config):
    """Fetch and parse one alternate IERS EOP backfill dataset."""
    if config["parser"] == "finals_json":
        print(f"  Fetching {config['json_url']} ...")
        try:
            with urllib.request.urlopen(config["json_url"], timeout=60) as response:
                return extract_finals(json.loads(response.read().decode("utf-8")))
        except Exception as exc:
            print(f"  ERROR: Could not fetch {config['label']}: {exc}")
            return []

    print(f"  Resolving metadata: {config['metadata_url']}")
    download_url = resolve_metadata_download_url(config["metadata_url"], config["download_url"])
    print(f"  Fetching {download_url} ...")
    try:
        content = fetch_text(download_url)
    except Exception as exc:
        print(f"  ERROR: Could not fetch {config['label']}: {exc}")
        return []

    if config["parser"] == "c04":
        return parse_c04_text(content)

    raise ValueError(f"Unknown EOP parser: {config['parser']}")


def merge_eop_records(historic_data, daily_data):
    """Merge historic/backfill EOP records with a rapid daily tail.

    Daily records take precedence on overlapping dates and extend the selected
    backfill to the newest confirmed rapid sample available for its convention.
    """
    historic_map = {d["t"]: d for d in historic_data}
    daily_map = {d["t"]: d for d in daily_data}
    all_dates = sorted(set(historic_map) | set(daily_map))

    return [
        daily_map[date] if date in daily_map else historic_map[date]
        for date in all_dates
    ]


def fetch_finals_daily():
    """
    Legacy: fetch latest IERS daily data from the text-format daily file.
    Kept as a fallback if all other sources fail.
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

                    x = None
                    y = None
                    i_idx = parts.index("I")
                    x = float(parts[i_idx + 1])
                    y = float(parts[i_idx + 3])

                    from datetime import datetime

                    date = datetime(year, month, day)

                    data.append(
                        {"t": date.strftime("%Y-%m-%d"), "xp": x, "yp": y}
                    )
                except (ValueError, IndexError, TypeError):
                    continue

        return data
    except Exception as e:
        print(f"Error fetching IERS daily text data: {e}")
        return []


def fetch_from_grace_ftp():
    """
    Legacy: fetch latest GRACE data from GFZ FTP server.
    Kept only for compatibility.
    """
    import shutil

    url = "ftp://ftp.gfz.de/pub/home/obs/Kp_ap_Ap_SN_F107/Kp_ap_since_1932.txt"

    try:
        with urllib.request.urlopen(url) as response:
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

                    kp = float(parts[4])
                    ap = int(parts[12])
                    ap_daily = int(parts[21])

                    from datetime import datetime

                    data.append(
                        {
                            "t": datetime(year, month, day).strftime("%Y-%m-%d"),
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

                date = MJD_EPOCH + timedelta(days=mjd)

                data.append({"t": date.strftime("%Y-%m-%d"), "xp": xp, "yp": yp})

    return data


def main():
    print("=" * 60)
    print("build_eop.py - EOP Data Pipeline")
    print("Merging finals.daily.json + finals.all.json")
    print("=" * 60)

    print()
    print("1. Fetch confirmed data from finals.daily.json ...")
    daily_data = fetch_from_daily_json()
    print(f"   Found {len(daily_data)} confirmed records")
    if daily_data:
        print(f"   Range: {daily_data[0]['t']} to {daily_data[-1]['t']}")

    print()
    print("2. Fetching / parsing historic data from finals.all.json ...")

    finals_path = DATA_DIR / "finals.all.json"

    # Try local file first, then IERS remote
    all_data = []
    if finals_path.exists():
        print(f"   Using local: {finals_path}")
        all_data = parse_finals_all_json(finals_path)
    else:
        print(f"   Local file not found, fetching from IERS ...")
        all_data = fetch_from_all_json()

    if not all_data:
        print("   ERROR: No historic data available")
        return

    print(f"   Found {len(all_data)} historical records")
    print(f"   Range: {all_data[0]['t']} to {all_data[-1]['t']}")

    print()
    print("3. Merging daily (recent) + all (historic) ...")

    print(f"   Historic dates: {len(all_data)}")
    print(f"   Daily dates: {len(daily_data)}")

    merged = merge_eop_records(all_data, daily_data)

    print(f"   Merged records: {len(merged)}")
    if merged:
        print(f"   Final date range: {merged[0]['t']} to {merged[-1]['t']}")

    # Save to eop_historic.json
    output_file = write_json("eop_historic.json", merged)
    print()
    print(f"Saved {len(merged)} EOP data points to {output_file}")
    if merged:
        print(f"Date range: {merged[0]['t']} to {merged[-1]['t']}")

    print()
    print("4. Fetching alternate EOP backfill datasets ...")
    daily_2000a_data = None
    for dataset_id, config in EOP_DATASETS.items():
        print()
        print(f"   {config['label']}")
        records = fetch_alternate_eop_dataset(config)
        if not records:
            print(f"   WARN: No records parsed for {dataset_id}; leaving any existing file unchanged.")
            continue

        if config.get("daily_tail") == "finals2000a":
            if daily_2000a_data is None:
                print("   Fetching IAU2000A rapid daily tail ...")
                daily_2000a_data = fetch_from_daily_2000a_json()

            if daily_2000a_data:
                before_count = len(records)
                before_end = records[-1]["t"]
                records = merge_eop_records(records, daily_2000a_data)
                print(
                    f"   Merged {before_count} backfill records through {before_end} "
                    f"with {len(daily_2000a_data)} daily-tail records"
                )
            else:
                print("   WARN: No IAU2000A daily tail available; writing backfill only.")

        output_file = write_json(config["output"], records)
        print(f"   Saved {len(records)} records to {output_file}")
        print(f"   Range: {records[0]['t']} to {records[-1]['t']}")

    print()
    print("Note: GFZ Kp data requires separate processing.")
    print("Run scripts/build_geomag_gfz.py to build geomagnetic data.")


if __name__ == "__main__":
    main()
