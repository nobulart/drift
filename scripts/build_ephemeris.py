#!/usr/bin/env python3
"""
build_ephemeris.py

Download/cache the JPL DE442 kernel and derive daily geocentric observables
for major solar-system bodies tracked in the overlay plot.
"""

from __future__ import annotations

import math
import gzip
import json
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
PARTITION_DIR = "ephemeris_by_year"
NORMALIZED_TORQUE_BODY_KEYS = [
    body["key"] for body in BODIES
    if body["key"] not in ("sun", "moon")
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


def build_body_record(
    spice: Any,
    body: dict[str, Any],
    et: float,
    all_bodies_data: list[dict[str, Any]],
) -> dict[str, float]:
    state, _light_time = spice.spkezr(body["target"], et, "ECLIPJ2000", "LT+S", "EARTH")
    rx, ry, rz, vx, vy, vz = state

    radius_km = math.sqrt(rx * rx + ry * ry + rz * rz)
    cross_x = ry * vz - rz * vy
    cross_y = rz * vx - rx * vz
    cross_z = rx * vy - ry * vx
    cross_mag = math.sqrt(cross_x * cross_x + cross_y * cross_y + cross_z * cross_z)
    angular_velocity_rad_s = cross_mag / max(radius_km * radius_km, 1e-12)
    radial_velocity_km_s = (rx * vx + ry * vy + rz * vz) / max(radius_km, 1e-12)

    longitude_rad = math.atan2(ry, rx)
    longitude_deg = angle_wrap_degrees(math.degrees(longitude_rad))
    distance_au = radius_km / KM_PER_AU
    tidal_force_proxy = body["mass_kg"] / max(radius_km ** 3, 1e-12)
    torque_proxy = tidal_force_proxy * angular_velocity_rad_s

    result = {
        "distance_au": distance_au,
        "angular_velocity_deg_per_day": math.degrees(angular_velocity_rad_s) * SECONDS_PER_DAY,
        "radial_velocity_km_s": radial_velocity_km_s,
        "ecliptic_longitude_deg": longitude_deg,
        "torque_proxy": torque_proxy,
    }

    all_bodies_data.append(
        {
            "key": body["key"],
            "mass_kg": body["mass_kg"],
            "radius_km": radius_km,
            "angular_velocity_rad_s": angular_velocity_rad_s,
            "radial_velocity_km_s": radial_velocity_km_s,
            "longitude_rad": longitude_rad,
            "longitude_deg": longitude_deg,
            "distance_au": distance_au,
            "torque_proxy": torque_proxy,
        }
    )

    return result


def body_data_from_record(record: dict[str, Any]) -> list[dict[str, Any]]:
    bodies = record.get("bodies", {})
    if not isinstance(bodies, dict):
        return []

    all_bodies_data = []
    body_config_by_key = {body["key"]: body for body in BODIES}
    for key, config in body_config_by_key.items():
        sample = bodies.get(key)
        if not isinstance(sample, dict):
            return []

        try:
            distance_au = float(sample["distance_au"])
            angular_velocity_deg_per_day = float(sample["angular_velocity_deg_per_day"])
            radial_velocity_km_s = float(sample["radial_velocity_km_s"])
            longitude_deg = float(sample["ecliptic_longitude_deg"])
            torque_proxy = float(sample["torque_proxy"])
        except (KeyError, TypeError, ValueError):
            return []

        radius_km = distance_au * KM_PER_AU
        longitude_rad = math.radians(longitude_deg)
        angular_velocity_rad_s = math.radians(angular_velocity_deg_per_day) / SECONDS_PER_DAY
        all_bodies_data.append(
            {
                "key": key,
                "mass_kg": config["mass_kg"],
                "radius_km": radius_km,
                "angular_velocity_rad_s": angular_velocity_rad_s,
                "radial_velocity_km_s": radial_velocity_km_s,
                "longitude_rad": longitude_rad,
                "longitude_deg": longitude_deg,
                "distance_au": distance_au,
                "torque_proxy": torque_proxy,
            }
        )

    return all_bodies_data


def compute_net_values(
    all_bodies_data: list[dict[str, Any]],
    torque_normalizers: dict[str, float] | None = None,
) -> dict[str, float]:
    if not all_bodies_data:
        return {
            "distance_au": 0.0,
            "angular_velocity_deg_per_day": 0.0,
            "radial_velocity_km_s": 0.0,
            "ecliptic_longitude_deg": 0.0,
            "torque_proxy": 0.0,
        }

    total_mass = sum(body["mass_kg"] for body in all_bodies_data)

    net_position_x = sum(body["radius_km"] * math.cos(body["longitude_rad"]) for body in all_bodies_data)
    net_position_y = sum(body["radius_km"] * math.sin(body["longitude_rad"]) for body in all_bodies_data)
    net_distance_km = math.sqrt(net_position_x * net_position_x + net_position_y * net_position_y)
    net_distance_au = net_distance_km / KM_PER_AU

    total_angular_momentum = sum(
        body["mass_kg"] * body["radius_km"] * body["radius_km"] * body["angular_velocity_rad_s"]
        for body in all_bodies_data
    )
    total_moment_of_inertia = sum(
        body["mass_kg"] * body["radius_km"] * body["radius_km"]
        for body in all_bodies_data
    )
    net_angular_velocity_rad_s = total_angular_momentum / max(total_moment_of_inertia, 1e-12)

    total_mass_weighted_radial_velocity = sum(body["mass_kg"] * body["radial_velocity_km_s"] for body in all_bodies_data)
    net_radial_velocity_km_s = total_mass_weighted_radial_velocity / total_mass

    total_mass_weighted_longitude = sum(body["mass_kg"] * body["longitude_rad"] for body in all_bodies_data)
    net_longitude_rad = total_mass_weighted_longitude / total_mass
    net_longitude_deg = angle_wrap_degrees(math.degrees(net_longitude_rad))

    # Temporal-comparison signal: every non-solar/non-lunar body contributes
    # by its own peak torque over the output cache, deliberately flattening
    # intensity differences so phase and timing relationships are easier to see.
    net_torque_proxy = 0.0
    normalizers = torque_normalizers or {}
    for body in all_bodies_data:
        if body["key"] not in NORMALIZED_TORQUE_BODY_KEYS:
            continue
        normalizer = normalizers.get(body["key"], 0.0)
        if normalizer > 0:
            net_torque_proxy += body["torque_proxy"] / normalizer

    return {
        "distance_au": net_distance_au,
        "angular_velocity_deg_per_day": math.degrees(net_angular_velocity_rad_s) * SECONDS_PER_DAY,
        "radial_velocity_km_s": net_radial_velocity_km_s,
        "ecliptic_longitude_deg": net_longitude_deg,
        "torque_proxy": net_torque_proxy,
    }


def compute_torque_normalizers(records: list[dict[str, Any]]) -> dict[str, float]:
    normalizers = {key: 0.0 for key in NORMALIZED_TORQUE_BODY_KEYS}
    for record in records:
        bodies = record.get("bodies", {})
        if not isinstance(bodies, dict):
            continue
        for key in NORMALIZED_TORQUE_BODY_KEYS:
            sample = bodies.get(key)
            if not isinstance(sample, dict):
                continue
            value = sample.get("torque_proxy")
            if isinstance(value, (int, float)) and math.isfinite(value):
                normalizers[key] = max(normalizers[key], abs(float(value)))

    return normalizers


def refresh_net_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    torque_normalizers = compute_torque_normalizers(records)
    refreshed = []
    for record in records:
        all_bodies_data = body_data_from_record(record)
        if all_bodies_data:
            bodies = dict(record.get("bodies", {}))
            bodies["net"] = compute_net_values(all_bodies_data, torque_normalizers)
            refreshed.append({**record, "bodies": bodies})
        else:
            refreshed.append(record)

    return refreshed


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
        "net_torque_proxy": {
            "description": "Sum of per-body temporal-normalized torque proxies for non-Sun/non-Moon bodies.",
            "normalization": "Each included body is divided by its own maximum absolute torque_proxy over this cache before summing.",
            "purpose": "Prioritizes timing and phase comparison over absolute intensity resolution.",
            "included_bodies": NORMALIZED_TORQUE_BODY_KEYS,
        },
        "bodies": [
            {"key": body["key"], "label": body["label"], "target": body["target"]}
            for body in BODIES
        ] + [
            {
                "key": "net",
                "label": "Net",
                "target": "DERIVED_NON_SOLAR_NON_LUNAR_TEMPORAL_NORMALIZED_SUM",
            }
        ],
        "metrics": OUTPUT_METRICS,
    }


def write_year_partitions(source: dict[str, Any], records: list[dict[str, Any]]) -> None:
    records_by_year: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        date_value = record.get("t")
        if not isinstance(date_value, str) or len(date_value) < 4:
            continue
        records_by_year.setdefault(date_value[:4], []).append(record)

    years = sorted(records_by_year)
    for year in years:
        write_json(
            f"{PARTITION_DIR}/{year}.json",
            {
                "source": {
                    **source,
                    "partition_year": year,
                },
                "records": records_by_year[year],
            },
            mirror_to_public=False,
            compact=True,
        )

    write_json(
        "ephemeris_historic.manifest.json",
        {
            "source": source,
            "partition_dir": PARTITION_DIR,
            "years": years,
            "record_count": len(records),
        },
        mirror_to_public=False,
        compact=True,
    )


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
    if dates_to_generate:
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

        for index, current_date in enumerate(dates_to_generate):
            date_str = current_date.isoformat()
            et = spice.utc2et(f"{date_str}T00:00:00")

            all_bodies_data = []
            bodies = {}
            for body in BODIES:
                body_record = build_body_record(spice, body, et, all_bodies_data)
                bodies[body["key"]] = body_record

            generated.append({"t": date_str, "bodies": bodies})

            if index and index % 1000 == 0:
                print(f"Processed {index}/{len(dates_to_generate)} dates...")

        spice.kclear()

    if args.merge:
        merged_by_date = {**existing_by_date, **{record["t"]: record for record in generated}}
        output = [merged_by_date[key] for key in sorted(merged_by_date)]
    else:
        output = generated

    output = refresh_net_records(output)

    if not output:
        raise SystemExit("No ephemeris records were generated or found.")

    output_start = date.fromisoformat(output[0]["t"])
    output_end = date.fromisoformat(output[-1]["t"])
    payload = {
        "source": build_source_metadata(output_start, output_end),
        "records": output,
    }

    output_path = write_json("ephemeris_historic.json", payload, compact=True)
    write_year_partitions(payload["source"], output)
    print(f"Saved {len(output)} ephemeris samples to {output_path}")
    print(f"Date range: {output[0]['t']} to {output[-1]['t']}")


if __name__ == "__main__":
    main()
