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
import argparse
from datetime import datetime, timedelta
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from data_paths import DATA_DIR, read_json, write_json


FRESHNESS_WINDOWS = {
    "eop": timedelta(hours=12),
    "grace": timedelta(days=7),
    "gfz_kp": timedelta(hours=6),
}


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


def local_file(filename):
    return DATA_DIR / filename


def file_age(filename, now):
    path = local_file(filename)
    if not path.exists():
        return None
    modified = datetime.fromtimestamp(path.stat().st_mtime)
    return now - modified


def is_stale(filename, max_age, now, force=False):
    if force:
        return True

    age = file_age(filename, now)
    if age is None:
        return True

    return age >= max_age


def describe_freshness(filename, max_age, now):
    age = file_age(filename, now)
    if age is None:
        return "missing"

    age_seconds = max(0, int(age.total_seconds()))
    if age_seconds < 60:
        age_label = f"{age_seconds}s"
    elif age_seconds < 3600:
        age_label = f"{age_seconds // 60}m"
    elif age_seconds < 86400:
        age_label = f"{age_seconds // 3600}h"
    else:
        age_label = f"{age_seconds // 86400}d"

    window_hours = max_age.total_seconds() / 3600
    window_label = f"{window_hours:.0f}h" if window_hours < 48 else f"{window_hours / 24:.0f}d"
    return f"age {age_label}, freshness window {window_label}"


def newest_mtime(filenames):
    mtimes = []
    for filename in filenames:
        path = local_file(filename)
        if path.exists():
            mtimes.append(path.stat().st_mtime)
    return max(mtimes) if mtimes else None


def should_rebuild_combined(output_filename, dependency_filenames):
    output_path = local_file(output_filename)
    if not output_path.exists():
        return True

    newest_dependency = newest_mtime(dependency_filenames)
    if newest_dependency is None:
        return True

    return output_path.stat().st_mtime < newest_dependency


def fetch_latest_eop():
    """Fetch latest IERS EOP data from finals.daily.json (true daily Bulletin A)."""
    print("Fetching latest IERS EOP data (daily)...")

     # finals.daily.json is updated with each Bulletin A cycle and contains
     # both confirmed (type=final) and predicted entries - we only want confirmed.
     # We also fetch the full cumulative file and persist it for compatibility with
     # build_eop.py which reads from it.
    daily_url = "https://datacenter.iers.org/data/json/finals.daily.json"
    all_url = "https://datacenter.iers.org/data/json/finals.all.json"
    all_data = None

    try:
        with urllib.request.urlopen(daily_url) as response:
            daily_json = json.loads(response.read().decode("utf-8"))

        # Also fetch the full cumulative file for historical continuity
        try:
            with urllib.request.urlopen(all_url) as response:
                all_data = json.loads(response.read().decode("utf-8"))
        except Exception as e:
            print(f"  WARN: Could not fetch cumulative file ({e})")

        daily_data = daily_json.get("EOP", {}).get("data", {}).get("timeSeries", [])

        result = []
        for entry in reversed(daily_data):   # Go backwards to find confirmed data
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
                 # Only accept confirmed (type=final) data from BulletinA,
                 # NOT predictions or provisional entries.
                 if item.get("source") == "BulletinA" and item.get("type") == "final":
                     try:
                         x_str = item.get("X", "")
                         y_str = item.get("Y", "")
                         if x_str and x_str.strip() and y_str and y_str.strip():
                             x = float(x_str)
                             y = float(y_str)
                     except:
                         continue
                     break

            # Only include confirmed entries
            if x is not None and y is not None:
                result.append({"t": date_str, "xp": x, "yp": y})

         # If we got no confirmed data from daily (unusual), fall back to cumulative
        if not result and all_data is not None:
            print("  No confirmed daily data; falling back to cumulative (all) data...")
            all_ts = all_data.get("EOP", {}).get("data", {}).get("timeSeries", [])
            result = []
            for entry in reversed(all_ts):
                time_info = entry.get("time", {})
                data_eop = entry.get("dataEOP", {})

                date_year = time_info.get("dateYear")
                date_month = time_info.get("dateMonth")
                date_day = time_info.get("dateDay")

                if not date_year:
                    continue

                date_str = f"{date_year}-{date_month}-{date_day}"

                pole_data = data_eop.get("pole", [])
                xp_val, yp_val = None, None
                for item in pole_data:
                    if item.get("source") == "BulletinA":
                        try:
                            x_str = item.get("X", "")
                            y_str = item.get("Y", "")
                            if x_str and x_str.strip() and y_str and y_str.strip():
                                xp_val = float(x_str)
                                yp_val = float(y_str)
                        except:
                            continue
                        break

                if xp_val is not None and yp_val is not None:
                    result.append({"t": date_str, "xp": xp_val, "yp": yp_val})

            result = list(reversed(result))

        final_list = list(reversed(result))

        # Persist the full cumulative file for build_eop.py compatibility
        if all_data is not None:
            write_json("finals.all.json", all_data)
            print("  Updated data/finals.all.json")

        print(f"  Retrieved {len(final_list)} confirmed entries from finals.daily.json")
        if final_list:
            print(f"  Date range: {final_list[0]['t']} to {final_list[-1]['t']}")

        return final_list

    except Exception as e:
        print(f"  WARNING: Could not fetch EOP data: {e}")

         # Attempt cumulative fallback
        try:
            with urllib.request.urlopen(all_url) as response:
                all_data = json.loads(response.read().decode("utf-8"))
            write_json("finals.all.json", all_data)
            print("  Fallback: saved finals.all.json")
            return fetch_latest_eop_fallback(all_data)
        except Exception as e2:
            print(f"  Fallback also failed: {e2}")
            return None


def fetch_latest_eop_fallback(all_data):
    """Fetch from cumulative finals.all.json as a fallback for when daily JSON is unavailable."""
    print("  Attempting cumulative data source fallback...")
    eop_data = all_data.get("EOP", {}).get("data", {}).get("timeSeries", [])

    result = []
    for entry in reversed(eop_data):
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

    return list(reversed(result))


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
    parser = argparse.ArgumentParser(description="Fetch latest DRIFT pipeline source data.")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Fetch all upstream sources even when local pipeline files are still fresh.",
    )
    args = parser.parse_args()

    output_dir = os.path.join(os.path.dirname(__file__), "..", "data")
    now = datetime.now()

    print("=" * 60)
    print("Automated Data Retrieval")
    print(f"Timestamp: {now.isoformat()}")
    if args.force:
        print("Mode: force refresh")
    else:
        print("Mode: timestamp-aware refresh")
    print("=" * 60)

     # Fetch EOP
     # 1. eop_historic.json (rebuild from daily + all merged data)
    print("\n1. EOP Data (IERS)")

          # Fetch latest confirmed data from daily JSON
    eop_stale = is_stale("eop_latest.json", FRESHNESS_WINDOWS["eop"], now, args.force)
    if eop_stale:
        eop_data = fetch_latest_eop()
        if eop_data is not None:
            save_json(os.path.join(output_dir, "eop_latest.json"), eop_data)

              # Rebuild eop_historic.json by merging daily + full all data
              # fetch_latest_eop() already updates finals.all.json on disk
            print("  Rebuilding eop_historic.json from merged daily + all data ...")
            try:
                import subprocess
                build_result = subprocess.run(
                   [sys.executable, str(SCRIPT_DIR / "build_eop.py")],
                  capture_output=True, text=True, timeout=120
               )
                if build_result.stdout:
                    for line in build_result.stdout.strip().split("\n"):
                        print(f"   {line}")
                if build_result.returncode != 0:
                    print(f"  WARN: build_eop.py failed: {build_result.stderr}")
                else:
                    print("  eop_historic.json rebuilt successfully.")
            except Exception as e:
                print(f"  ERROR: Failed to rebuild eop_historic.json: {e}")
    else:
        print(f"  Skipping EOP fetch; local eop_latest.json is fresh ({describe_freshness('eop_latest.json', FRESHNESS_WINDOWS['eop'], now)}).")

     # Fetch GRACE
    print("\n2. GRACE Data")
    grace_stale = is_stale("grace_latest.json", FRESHNESS_WINDOWS["grace"], now, args.force)
    if grace_stale:
        grace_data = fetch_latest_grace()
        if grace_data is not None:
            save_json(os.path.join(output_dir, "grace_latest.json"), grace_data)
    else:
        print(f"  Skipping GRACE fetch; local grace_latest.json is fresh ({describe_freshness('grace_latest.json', FRESHNESS_WINDOWS['grace'], now)}).")

    # Fetch GFZ-KP
    print("\n3. GFZ-KP Data")
    # Use historical date range (latest full month - 1 day ago to avoid pending data)
    end_date = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    start_date = (now - timedelta(days=60)).strftime("%Y-%m-%d")

    kp_stale = is_stale("geomag_gfz_latest.json", FRESHNESS_WINDOWS["gfz_kp"], now, args.force)
    if kp_stale:
        kp_data = fetch_latest_kp(start_date, end_date)
        if kp_data is not None:
            save_json(os.path.join(output_dir, "geomag_gfz_latest.json"), kp_data)
    else:
        print(f"  Skipping GFZ-KP fetch; local geomag_gfz_latest.json is fresh ({describe_freshness('geomag_gfz_latest.json', FRESHNESS_WINDOWS['gfz_kp'], now)}).")

    # Combine data
    print("\n4. Combined Data")
    combined_dependencies = ["eop_historic.json", "grace_historic.json", "geomag_gfz_kp.json"]
    if args.force or should_rebuild_combined("combined_latest.json", combined_dependencies):
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
    else:
        print("  Skipping combined rebuild; combined_latest.json is newer than source data files.")

    print("\n" + "=" * 60)
    print("Data retrieval complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()
