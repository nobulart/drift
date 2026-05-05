#!/usr/bin/env python3
"""
build_ephemeris.py

Download/cache the JPL DE442 kernel and derive daily geocentric observables
for major solar-system bodies tracked in the overlay plot.
"""

from __future__ import annotations

import math
import gzip
import sys
import urllib.request
from argparse import ArgumentParser
from datetime import date, timedelta
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from data_paths import DATA_DIR, read_json, ensure_data_dirs, write_json


KERNEL_DIR = DATA_DIR / "kernels"
DE442_URL = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de442.bsp"
LSK_URL = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls"

BODIES = [
    {
        "key": "sun",
        "label": "Sun",
        "target": "SUN",
        "mass_kg": 1.98847e30,
    },
    {
        "key": "moon",
        "label": "Moon",
        "target": "MOON",
        "mass_kg": 7.342e22,
    },
    {
        "key": "mercury",
        "label": "Mercury",
        "target": "MERCURY BARYCENTER",
        "mass_kg": 3.3011e23,
    },
    {
        "key": "venus",
        "label": "Venus",
        "target": "VENUS BARYCENTER",
        "mass_kg": 4.8675e24,
    },
    {
        "key": "mars",
        "label": "Mars",
        "target": "MARS BARYCENTER",
        "mass_kg": 6.4171e23,
    },
    {
        "key": "jupiter",
        "label": "Jupiter",
        "target": "JUPITER BARYCENTER",
        "mass_kg": 1.8982e27,
    },
    {
        "key": "saturn",
        "label": "Saturn",
        "target": "SATURN BARYCENTER",
        "mass_kg": 5.6834e26,
    },
    {
        "key": "uranus",
        "label": "Uranus",
        "target": "URANUS BARYCENTER",
        "mass_kg": 8.6810e25,
    },
    {
        "key": "neptune",
        "label": "Neptune",
        "target": "NEPTUNE BARYCENTER",
        "mass_kg": 1.02413e26,
    },
    {
        "key": "pluto",
        "label": "Pluto",
        "target": "PLUTO BARYCENTER",
        "mass_kg": 1.303e22,
    },
]

KM_PER_AU = 149_597_870.7
SECONDS_PER_DAY = 86_400.0
START_DATE = date(1962, 1, 1)
END_DATE = date(2050, 12, 31)
OUTPUT_METRICS = [
    "distance_au",
    "angular_velocity_deg_per_day",
    "radial_velocity_km_s",
    "ecliptic_longitude_deg",
    "torque_proxy",
]


def ensure_file(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and destination.stat().st_size > 0:
        print(f"Using cached {destination.name}")
        return

    print(f"Downloading {destination.name}...")
    urllib.request.urlretrieve(url, destination)


def angle_wrap_degrees(value: float) -> float:
    return (value + 360.0) % 360.0


def build_body_record(spice: Any, body: dict[str, Any], et: float) -> dict[str, float]:
    state, light_time = spice.spkezr(body["target"], et, "ECLIPJ2000", "LT+S", "EARTH")
    rx, ry, rz, vx, vy, vz = state

    radius_km = math.sqrt(rx * rx + ry * ry + rz * rz)
    speed_km_s = math.sqrt(vx * vx + vy * vy + vz * vz)
    cross_x = ry * vz - rz * vy
    cross_y = rz * vx - rx * vz
    cross_z = rx * vy - ry * vx
    cross_mag = math.sqrt(cross_x * cross_x + cross_y * cross_y + cross_z * cross_z)
    angular_velocity_rad_s = cross_mag / max(radius_km * radius_km, 1e-12)
    radial_velocity_km_s = (rx * vx + ry * vy + rz * vz) / max(radius_km, 1e-12)

    longitude_deg = angle_wrap_degrees(math.degrees(math.atan2(ry, rx)))
    distance_au = radius_km / KM_PER_AU
    tidal_force_proxy = body["mass_kg"] / max(radius_km ** 3, 1e-12)
    torque_proxy = tidal_force_proxy * angular_velocity_rad_s

    return {
        "distance_au": distance_au,
        "angular_velocity_deg_per_day": math.degrees(angular_velocity_rad_s) * SECONDS_PER_DAY,
        "radial_velocity_km_s": radial_velocity_km_s,
        "ecliptic_longitude_deg": longitude_deg,
        "torque_proxy": torque_proxy,
    }


def iter_dates(start: date, end: date) -> list[date]:
    total_days = (end - start).days + 1
    return [start + timedelta(days=offset) for offset in range(total_days)]


def parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise SystemExit(f"Invalid date {value!r}; expected YYYY-MM-DD") from exc


def parse_args() -> Any:
    parser = ArgumentParser(description="Build or extend the DRIFT DE442 ephemeris cache.")
    parser.add_argument("--start", default=START_DATE.isoformat(), help="Inclusive start date, YYYY-MM-DD.")
    parser.add_argument("--end", default=END_DATE.isoformat(), help="Inclusive end date, YYYY-MM-DD.")
    parser.add_argument("--merge", action="store_true", help="Merge generated samples into existing ephemeris_historic.json instead of replacing it.")
    return parser.parse_args()


def build_source_metadata(start_date: date, end_date: date) -> dict[str, Any]:
    return {
        "kernel": "de442.bsp",
        "kernel_url": DE442_URL,
        "leapseconds": "naif0012.tls",
        "observer": "EARTH",
        "frame": "ECLIPJ2000",
        "aberration_correction": "LT+S",
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "cadence": "daily",
        "bodies": [
            {"key": body["key"], "label": body["label"], "target": body["target"]}
            for body in BODIES
        ],
        "metrics": OUTPUT_METRICS,
    }


def load_existing_records() -> list[dict[str, Any]]:
    try:
        payload = read_json("ephemeris_historic.json")
    except FileNotFoundError:
        compressed_path = DATA_DIR / "ephemeris_historic.json.gz"
        if not compressed_path.exists():
            return []
        with gzip.open(compressed_path, "rt", encoding="utf-8") as handle:
            payload = json.load(handle)

    records = payload.get("records", [])
    if not isinstance(records, list):
        return []

    return [record for record in records if isinstance(record, dict) and isinstance(record.get("t"), str)]


def main() -> None:
    args = parse_args()
    start_date = parse_date(args.start)
    end_date = parse_date(args.end)
    if start_date > end_date:
        raise SystemExit("--start must be on or before --end")

    ensure_data_dirs()
    KERNEL_DIR.mkdir(parents=True, exist_ok=True)

    try:
        import spiceypy as spice
    except ImportError as exc:
        print("ERROR: spiceypy is required. Install with `pip install spiceypy`.")
        raise SystemExit(1) from exc

    de442_path = KERNEL_DIR / "de442.bsp"
    lsk_path = KERNEL_DIR / "naif0012.tls"
    ensure_file(DE442_URL, de442_path)
    ensure_file(LSK_URL, lsk_path)

    print("Loading SPICE kernels...")
    spice.kclear()
    spice.furnsh(str(lsk_path))
    spice.furnsh(str(de442_path))

    existing_records = load_existing_records() if args.merge else []
    existing_by_date = {record["t"]: record for record in existing_records}
    requested_dates = iter_dates(start_date, end_date)
    dates_to_generate = [
        current_date for current_date in requested_dates
        if current_date.isoformat() not in existing_by_date
    ]

    if args.merge:
        print(f"Existing cache records: {len(existing_by_date)}")
        print(f"Requested date range: {start_date.isoformat()} to {end_date.isoformat()}")
        print(f"Missing dates to generate: {len(dates_to_generate)}")

    generated = []
    for index, current_date in enumerate(dates_to_generate):
        date_str = current_date.isoformat()
        et = spice.utc2et(f"{date_str}T00:00:00")
        bodies = {
            body["key"]: build_body_record(spice, body, et)
            for body in BODIES
        }
        generated.append({"t": date_str, "bodies": bodies})

        if index and index % 1000 == 0:
            print(f"Processed {index}/{len(dates_to_generate)} dates...")

    spice.kclear()

    if args.merge:
        merged_by_date = {**existing_by_date, **{record["t"]: record for record in generated}}
        output = [merged_by_date[key] for key in sorted(merged_by_date)]
    else:
        output = generated

    if not output:
        raise SystemExit("No ephemeris records were generated or found.")

    output_start = date.fromisoformat(output[0]["t"])
    output_end = date.fromisoformat(output[-1]["t"])
    payload = {
        "source": build_source_metadata(output_start, output_end),
        "records": output,
    }

    output_path = write_json("ephemeris_historic.json", payload)
    print(f"Saved {len(output)} ephemeris samples to {output_path}")
    print(f"Date range: {output[0]['t']} to {output[-1]['t']}")


if __name__ == "__main__":
    main()
