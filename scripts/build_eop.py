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
import argparse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from data_paths import DATA_DIR, read_json, write_json

DAILY_JSON_URL = "https://datacenter.iers.org/data/json/finals.daily.json"
DAILY_2000A_JSON_URL = "https://datacenter.iers.org/data/json/finals2000A.daily.json"
ALL_JSON_URL = "https://datacenter.iers.org/data/json/finals.all.json"
JPL_EOP2_LONG_URL = "https://eop2-external.jpl.nasa.gov/eop2/latest_eop2.long"
JPL_EOP2_SHORT_URL = "https://eop2-external.jpl.nasa.gov/eop2/latest_eop2.short"
FULL_BACKFILL_REFRESH_WINDOW = timedelta(days=7)
JPL_FALLBACK_MIN_LAG_DAYS = 3
EOP_SOURCE_NOTICE_FILENAME = "eop_source_notice.json"
URL_TIMEOUT_SECONDS = 60
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
    "jpl": {
        "label": "JPL EOP2",
        "download_url": JPL_EOP2_LONG_URL,
        "tail_url": JPL_EOP2_SHORT_URL,
        "output": "eop_jpl_eop2_historic.json",
        "parser": "jpl_eop2",
        "daily_tail": "jpl_eop2",
    },
}

MJD_EPOCH = datetime(1858, 11, 17)

TAI_UTC_PRE_1972 = [
    # effective MJD, base offset seconds, reference MJD, rate seconds/day
    (37300.0, 1.4178180, 37300.0, 0.0012960),
    (37365.0, 1.4228180, 37300.0, 0.0012960),
    (37512.0, 1.3728180, 37300.0, 0.0012960),
    (37665.0, 1.8458580, 37665.0, 0.0011232),
    (38334.0, 1.9458580, 37665.0, 0.0011232),
    (38395.0, 3.2401300, 38761.0, 0.0012960),
    (38486.0, 3.3401300, 38761.0, 0.0012960),
    (38639.0, 3.4401300, 38761.0, 0.0012960),
    (38761.0, 3.5401300, 38761.0, 0.0012960),
    (38820.0, 3.6401300, 38761.0, 0.0012960),
    (38942.0, 3.7401300, 38761.0, 0.0012960),
    (39004.0, 3.8401300, 38761.0, 0.0012960),
    (39126.0, 4.3131700, 39126.0, 0.0025920),
    (39887.0, 4.2131700, 39126.0, 0.0025920),
]

TAI_UTC_STEPS = [
    (41317.0, 10.0),
    (41499.0, 11.0),
    (41683.0, 12.0),
    (42048.0, 13.0),
    (42413.0, 14.0),
    (42778.0, 15.0),
    (43144.0, 16.0),
    (43509.0, 17.0),
    (43874.0, 18.0),
    (44239.0, 19.0),
    (44786.0, 20.0),
    (45151.0, 21.0),
    (45516.0, 22.0),
    (46247.0, 23.0),
    (47161.0, 24.0),
    (47892.0, 25.0),
    (48257.0, 26.0),
    (48804.0, 27.0),
    (49169.0, 28.0),
    (49534.0, 29.0),
    (50083.0, 30.0),
    (50630.0, 31.0),
    (51179.0, 32.0),
    (53736.0, 33.0),
    (54832.0, 34.0),
    (56109.0, 35.0),
    (57204.0, 36.0),
    (57754.0, 37.0),
]


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
    data = read_json(Path(filepath).name)
    return extract_finals(data)


def file_age(path, now):
    if not path.exists():
        return None
    return now - datetime.fromtimestamp(path.stat().st_mtime)


def should_refresh_full_backfill(output_filename, now, force=False):
    if force:
        return True

    age = file_age(DATA_DIR / output_filename, now)
    if age is None:
        return True

    return age >= FULL_BACKFILL_REFRESH_WINDOW


def describe_age(path, now):
    age = file_age(path, now)
    if age is None:
        return "missing"

    seconds = max(0, int(age.total_seconds()))
    if seconds < 60:
        return f"age {seconds}s"
    if seconds < 3600:
        return f"age {seconds // 60}m"
    if seconds < 86400:
        return f"age {seconds // 3600}h"
    return f"age {seconds // 86400}d"


def load_cached_records(filename):
    try:
        records = read_json(filename)
    except FileNotFoundError:
        return []

    if not isinstance(records, list):
        return []

    return sorted(
        [record for record in records if isinstance(record, dict) and record.get("t")],
        key=lambda item: item["t"],
    )


def fetch_from_daily_json():
    """Fetch confirmed EOP data from the finals.daily.json endpoint."""
    print(f"  Fetching {DAILY_JSON_URL} ...")
    try:
        with urllib.request.urlopen(DAILY_JSON_URL, timeout=URL_TIMEOUT_SECONDS) as response:
            daily_json = json.loads(response.read().decode("utf-8"))
            return extract_finals(daily_json)
    except Exception as e:
        print(f"  ERROR: Could not fetch from {DAILY_JSON_URL}: {e}")
        return []


def fetch_from_daily_2000a_json():
    """Fetch confirmed EOP data from the finals2000A.daily.json endpoint."""
    print(f"  Fetching {DAILY_2000A_JSON_URL} ...")
    try:
        with urllib.request.urlopen(DAILY_2000A_JSON_URL, timeout=URL_TIMEOUT_SECONDS) as response:
            daily_json = json.loads(response.read().decode("utf-8"))
            return extract_finals(daily_json)
    except Exception as e:
        print(f"  ERROR: Could not fetch from {DAILY_2000A_JSON_URL}: {e}")
        return []


def fetch_from_all_json():
    """Fetch the full cumulative finals.all.json from IERS."""
    print(f"  Fetching {ALL_JSON_URL} ...")
    try:
        with urllib.request.urlopen(ALL_JSON_URL, timeout=URL_TIMEOUT_SECONDS) as response:
            all_json = json.loads(response.read().decode("utf-8"))
            return extract_finals(all_json)
    except Exception as e:
        print(f"  ERROR: Could not fetch from {ALL_JSON_URL}: {e}")
        return []


def fetch_text(url):
    """Fetch a text payload from a URL."""
    with urllib.request.urlopen(url, timeout=URL_TIMEOUT_SECONDS) as response:
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


def tai_minus_utc_seconds(mjd):
    """Return the historical TAI-UTC offset in seconds for an MJD."""
    mjd = float(mjd)
    if mjd < TAI_UTC_STEPS[0][0]:
        applicable = TAI_UTC_PRE_1972[0]
        for entry in TAI_UTC_PRE_1972:
            if mjd >= entry[0]:
                applicable = entry
            else:
                break

        _, base_offset, reference_mjd, rate = applicable
        return base_offset + (mjd - reference_mjd) * rate

    offset = TAI_UTC_STEPS[0][1]
    for effective_mjd, step_offset in TAI_UTC_STEPS:
        if mjd >= effective_mjd:
            offset = step_offset
        else:
            break
    return offset


def add_lod_from_tai_ut1(records):
    """Derive a JPL LOD equivalent in milliseconds from continuous TAI-UT1."""
    records = sorted(records, key=lambda item: item["t"])

    for index, record in enumerate(records):
        if "tai_ut1_ms" not in record:
            continue

        previous_record = records[index - 1] if index > 0 else None
        next_record = records[index + 1] if index < len(records) - 1 else None

        if previous_record and next_record and "tai_ut1_ms" in previous_record and "tai_ut1_ms" in next_record:
            dt_days = float(next_record["mjd"]) - float(previous_record["mjd"])
            if dt_days:
                record["lod"] = (float(next_record["tai_ut1_ms"]) - float(previous_record["tai_ut1_ms"])) / dt_days
        elif next_record and "tai_ut1_ms" in next_record:
            dt_days = float(next_record["mjd"]) - float(record["mjd"])
            if dt_days:
                record["lod"] = (float(next_record["tai_ut1_ms"]) - float(record["tai_ut1_ms"])) / dt_days
        elif previous_record and "tai_ut1_ms" in previous_record:
            dt_days = float(record["mjd"]) - float(previous_record["mjd"])
            if dt_days:
                record["lod"] = (float(record["tai_ut1_ms"]) - float(previous_record["tai_ut1_ms"])) / dt_days

    return records


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


def parse_jpl_eop2_text(content):
    """Parse JPL EOP2 text records.

    JPL EOP2 headers are MJD, PMx, PMy, and TAI-UT1. The dashboard EOP
    contract uses xp/yp in arcseconds, UT1-UTC in seconds, and LOD in
    milliseconds, so PMx/PMy are divided by 1000, TAI-UT1 is converted via
    the historical TAI-UTC offset, and LOD is derived from the daily TAI-UT1
    slope.
    """
    records = []
    last_observed_date = None
    last_observed_match = re.search(r"Last UTPM Data Point\s+(\d{4}-\d{2}-\d{2})T", content)
    if last_observed_match:
        last_observed_date = last_observed_match.group(1)

    for line in content.splitlines():
        if "$" not in line:
            continue

        data_part, comment = line.split("$", 1)
        if "," not in data_part:
            continue

        parts = [part.strip() for part in data_part.split(",")]
        if len(parts) < 4:
            continue

        date_match = re.search(r"\d{4}-\d{2}-\d{2}", comment)
        if not date_match:
            continue

        try:
            mjd = float(parts[0])
            pmx_mas = float(parts[1])
            pmy_mas = float(parts[2])
            tai_minus_ut1_ms = float(parts[3])
        except (TypeError, ValueError):
            continue

        date_str = date_match.group(0)
        if last_observed_date and date_str > last_observed_date:
            continue

        records.append(
            {
                "t": date_str,
                "mjd": mjd,
                "xp": pmx_mas / 1000.0,
                "yp": pmy_mas / 1000.0,
                "tai_ut1_ms": tai_minus_ut1_ms,
                "ut1_utc": tai_minus_utc_seconds(mjd) - (tai_minus_ut1_ms / 1000.0),
            }
        )

    return add_lod_from_tai_ut1(records)


def fetch_alternate_eop_dataset(config):
    """Fetch and parse one alternate IERS EOP backfill dataset."""
    if config["parser"] == "finals_json":
        print(f"  Fetching {config['json_url']} ...")
        try:
            with urllib.request.urlopen(config["json_url"], timeout=URL_TIMEOUT_SECONDS) as response:
                return extract_finals(json.loads(response.read().decode("utf-8")))
        except Exception as exc:
            print(f"  ERROR: Could not fetch {config['label']}: {exc}")
            return []

    if config["parser"] == "jpl_eop2":
        print(f"  Fetching {config['download_url']} ...")
        try:
            return parse_jpl_eop2_text(fetch_text(config["download_url"]))
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


def fetch_jpl_eop2_tail(config):
    print(f"  Fetching {config['tail_url']} ...")
    try:
        return parse_jpl_eop2_text(fetch_text(config["tail_url"]))
    except Exception as exc:
        print(f"  ERROR: Could not fetch {config['label']} short tail: {exc}")
        return []


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


def parse_date(value):
    return datetime.strptime(value[:10], "%Y-%m-%d").date()


def latest_record_date(records):
    if not records:
        return None
    return parse_date(records[-1]["t"])


def write_eop_notice(payload):
    output = {
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        **payload,
    }
    write_json(EOP_SOURCE_NOTICE_FILENAME, output)


def maybe_apply_jpl_fallback(default_records, jpl_records):
    """Use JPL EOP2 as the operational default when IERS is materially stale."""
    default_latest = latest_record_date(default_records)
    jpl_latest = latest_record_date(jpl_records)

    if default_latest is None or jpl_latest is None:
        write_eop_notice({
            "fallbackActive": False,
            "dataset": "finals",
            "message": "Default IERS EOP remains active; fallback could not be evaluated.",
            "defaultLatestDate": default_records[-1]["t"] if default_records else None,
            "fallbackLatestDate": jpl_records[-1]["t"] if jpl_records else None,
        })
        return default_records

    lag_days = (jpl_latest - default_latest).days
    if lag_days < JPL_FALLBACK_MIN_LAG_DAYS:
        write_eop_notice({
            "fallbackActive": False,
            "dataset": "finals",
            "message": "Default IERS EOP remains active.",
            "defaultLatestDate": default_latest.isoformat(),
            "fallbackLatestDate": jpl_latest.isoformat(),
            "lagDays": lag_days,
        })
        return default_records

    fallback_records = [
        {
            **record,
            "source_eop": "jpl_eop2_fallback",
        }
        for record in jpl_records
    ]
    output_file = write_json("eop_historic.json", fallback_records)
    message = (
        f"Default IERS EOP is {lag_days} days behind JPL EOP2; "
        f"using JPL EOP2 as the operational default through {jpl_latest.isoformat()}."
    )
    write_eop_notice({
        "fallbackActive": True,
        "dataset": "jpl",
        "fallbackDataset": "jpl",
        "replacedDataset": "finals",
        "message": message,
        "defaultLatestDate": default_latest.isoformat(),
        "fallbackLatestDate": jpl_latest.isoformat(),
        "lagDays": lag_days,
        "thresholdDays": JPL_FALLBACK_MIN_LAG_DAYS,
    })
    print()
    print("5. Operational EOP fallback")
    print(f"   {message}")
    print(f"   Rewrote default eop_historic.json with {len(fallback_records)} JPL EOP2 records: {output_file}")
    return fallback_records


def fetch_finals_daily():
    """
    Legacy: fetch latest IERS daily data from the text-format daily file.
    Kept as a fallback if all other sources fail.
    """
    url = "https://datacenter.iers.org/data/latestVersion/finals.daily.iau1980.txt"

    try:
        with urllib.request.urlopen(url, timeout=URL_TIMEOUT_SECONDS) as response:
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
        with urllib.request.urlopen(url, timeout=URL_TIMEOUT_SECONDS) as response:
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
    parser = argparse.ArgumentParser(description="Build EOP datasets from cached backfills plus rapid daily tails.")
    parser.add_argument(
        "--force-full",
        action="store_true",
        help="Refresh full alternate EOP backfills even when cached outputs are still fresh.",
    )
    args = parser.parse_args()
    now = datetime.now()

    print("=" * 60)
    print("build_eop.py - EOP Data Pipeline")
    print("Merging finals.daily.json + finals.all.json")
    print(f"Full alternate backfill window: {FULL_BACKFILL_REFRESH_WINDOW.days}d")
    if args.force_full:
        print("Mode: force full alternate backfill refresh")
    else:
        print("Mode: daily-tail merge with cached alternate backfills")
    print("=" * 60)

    print()
    print("1. Fetch confirmed data from finals.daily.json ...")
    daily_data = fetch_from_daily_json()
    if not daily_data:
        daily_data = load_cached_records("eop_latest.json")
        if daily_data:
            print("   Using cached eop_latest.json daily tail")
    print(f"   Found {len(daily_data)} confirmed records")
    if daily_data:
        print(f"   Range: {daily_data[0]['t']} to {daily_data[-1]['t']}")

    print()
    print("2. Fetching / parsing historic data from finals.all.json ...")

    finals_path = DATA_DIR / "finals.all.json"
    finals_gz_path = DATA_DIR / "finals.all.json.gz"

    # Try local file first, then IERS remote
    all_data = []
    if finals_path.exists() or finals_gz_path.exists():
        print(f"   Using local: {finals_path if finals_path.exists() else finals_gz_path}")
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
    print("4. Updating alternate EOP datasets ...")
    daily_2000a_data = None
    jpl_eop2_tail = None
    alternate_records = {}
    for dataset_id, config in EOP_DATASETS.items():
        print()
        print(f"   {config['label']}")
        output_path = DATA_DIR / config["output"]
        refresh_full = should_refresh_full_backfill(config["output"], now, args.force_full)

        if refresh_full:
            print(f"   Refreshing full backfill ({describe_age(output_path, now)}) ...")
            records = fetch_alternate_eop_dataset(config)
        else:
            print(
                "   Using cached full backfill "
                f"({describe_age(output_path, now)}; refresh window {FULL_BACKFILL_REFRESH_WINDOW.days}d)"
            )
            records = load_cached_records(config["output"])

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

        if config.get("daily_tail") == "jpl_eop2":
            if jpl_eop2_tail is None:
                print("   Fetching JPL EOP2 short rapid tail ...")
                jpl_eop2_tail = fetch_jpl_eop2_tail(config)

            if jpl_eop2_tail:
                before_count = len(records)
                before_end = records[-1]["t"]
                records = merge_eop_records(records, jpl_eop2_tail)
                records = add_lod_from_tai_ut1(records)
                print(
                    f"   Merged {before_count} long-series records through {before_end} "
                    f"with {len(jpl_eop2_tail)} short-tail records"
                )
            else:
                print("   WARN: No JPL EOP2 short tail available; writing long series only.")

        output_file = write_json(config["output"], records)
        alternate_records[dataset_id] = records
        print(f"   Saved {len(records)} records to {output_file}")
        print(f"   Range: {records[0]['t']} to {records[-1]['t']}")

    maybe_apply_jpl_fallback(merged, alternate_records.get("jpl", []))

    print()
    print("Note: GFZ Kp data requires separate processing.")
    print("Run scripts/build_geomag_gfz.py to build geomagnetic data.")


if __name__ == "__main__":
    main()
