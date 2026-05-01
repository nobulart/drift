#!/usr/bin/env python3
"""
compute_phase_escape.py

Build operational phase-escape inputs from the internal DRIFT EOP state and
DE442 ephemeris cache. This intentionally does not read docs/drift.csv or any
exploratory docs/outputs artifacts.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from scipy.signal import hilbert, savgol_filter

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from compute_rolling_stats import compute_rolling_stats, nan_to_none


COMPOSITES: dict[str, dict[str, float]] = {
    "Venus_Mars": {"venus": 1.0, "mars": 1.0},
    "Venus_Mars_Jupiter": {"venus": 1.0, "mars": 1.0, "jupiter": 1.0},
    "Mercury_Venus_Mars": {"mercury": 1.0, "venus": 1.0, "mars": 1.0},
    "All_NonSolar_Major": {
        "mercury": 1.0,
        "venus": 1.0,
        "mars": 1.0,
        "jupiter": 1.0,
        "saturn": 1.0,
        "uranus": 1.0,
        "neptune": 1.0,
        "moon": 1.0,
    },
}


def wrap_phase(x: np.ndarray) -> np.ndarray:
    return (x + np.pi) % (2.0 * np.pi) - np.pi


def analytic_phase(x: np.ndarray, smooth_days: int) -> np.ndarray:
    x = np.asarray(x, dtype=float)
    valid = np.isfinite(x)

    if valid.sum() < 20:
        return np.full_like(x, np.nan)

    y = x.copy()
    y[~valid] = np.nanmedian(y[valid])

    if smooth_days >= 5:
        win = int(smooth_days)
        if win % 2 == 0:
            win += 1
        if win >= len(y):
            win = len(y) - 1
            if win % 2 == 0:
                win -= 1
        if win >= 5:
            y = savgol_filter(y, window_length=win, polyorder=3, mode="interp")

    y = y - np.nanmean(y)
    return wrap_phase(np.angle(hilbert(y)))


def composite_phase(phase_map: dict[str, np.ndarray], weights: dict[str, float]) -> np.ndarray:
    n = len(next(iter(phase_map.values())))
    z = np.zeros(n, dtype=complex)

    for body, weight in weights.items():
        z += float(weight) * np.exp(1j * phase_map[body])

    return wrap_phase(np.angle(z))


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def finite_or_none(value: float) -> float | None:
    if value is None:
        return None
    if not math.isfinite(float(value)):
        return None
    return float(value)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--eop", required=True)
    parser.add_argument("--ephemeris", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--window-size", type=float, default=1825.0)
    parser.add_argument("--turn-threshold", type=float, default=0.05)
    parser.add_argument("--smooth-days", type=int, default=31)
    parser.add_argument("--path-points", type=int, default=30)
    args = parser.parse_args()

    eop_rows = load_json(Path(args.eop))
    ephemeris_payload = load_json(Path(args.ephemeris))
    ephemeris_rows = ephemeris_payload.get("records", [])

    eop_by_date = {
        row["t"][:10]: row
        for row in eop_rows
        if row.get("t") and row.get("xp") is not None and row.get("yp") is not None
    }
    ephemeris_by_date = {
        row["t"][:10]: row.get("bodies", {})
        for row in ephemeris_rows
        if row.get("t")
    }

    dates = sorted(set(eop_by_date) & set(ephemeris_by_date))
    if len(dates) < 64:
        raise RuntimeError("Not enough overlapping EOP and DE442 samples for phase-escape computation.")

    xp = [float(eop_by_date[date]["xp"]) for date in dates]
    yp = [float(eop_by_date[date]["yp"]) for date in dates]
    t_days = [(pd.Timestamp(date) - pd.Timestamp(dates[0])).days for date in dates]

    rolling = compute_rolling_stats(
        xp,
        yp,
        t_days,
        window_size=args.window_size,
        turn_threshold=args.turn_threshold,
        path_points=args.path_points,
    )

    theta_raw = np.asarray(rolling["theta"], dtype=float)
    r_ratio = np.asarray(rolling["rRatio"], dtype=float)

    required_bodies = sorted({"sun"} | {body for weights in COMPOSITES.values() for body in weights})
    normalized_torque: dict[str, np.ndarray] = {}
    phase_map: dict[str, np.ndarray] = {}

    for body in required_bodies:
        series = np.asarray([
            ephemeris_by_date[date].get(body, {}).get("torque_proxy", np.nan)
            for date in dates
        ], dtype=float)
        finite = np.isfinite(series)
        if finite.sum() < 20:
            normalized_torque[body] = np.full_like(series, np.nan)
            phase_map[body] = np.full_like(series, np.nan)
            continue

        mean = np.nanmean(series)
        std = np.nanstd(series)
        normalized = (series - mean) / (std if std > 0 else 1.0)
        normalized_torque[body] = normalized
        phase_map[body] = analytic_phase(normalized, args.smooth_days)

    sun_phase = phase_map["sun"]
    theta_residual = wrap_phase(theta_raw - sun_phase)

    composites = {
        name: composite_phase(phase_map, weights)
        for name, weights in COMPOSITES.items()
        if all(body in phase_map for body in weights)
    }
    misalignments = {
        name: wrap_phase(theta_residual - phase)
        for name, phase in composites.items()
    }

    records = []
    for index, date in enumerate(dates):
        records.append({
            "t": date,
            "thetaRaw": finite_or_none(theta_raw[index]),
            "thetaResidual": finite_or_none(theta_residual[index]),
            "sunPhase": finite_or_none(sun_phase[index]),
            "rRatio": finite_or_none(r_ratio[index]),
            "bodyPhases": {
                body: finite_or_none(phase[index])
                for body, phase in phase_map.items()
            },
            "composites": {
                name: finite_or_none(phase[index])
                for name, phase in composites.items()
            },
            "misalignment": {
                name: finite_or_none(phi[index])
                for name, phi in misalignments.items()
            },
        })

    payload = {
        "source": {
            "eop": str(Path(args.eop).resolve()),
            "ephemeris": str(Path(args.ephemeris).resolve()),
            "ephemerisKernel": ephemeris_payload.get("source", {}).get("kernel", "de442.bsp"),
            "observer": ephemeris_payload.get("source", {}).get("observer", "EARTH"),
            "smoothDays": args.smooth_days,
            "windowSize": args.window_size,
            "turnThreshold": args.turn_threshold,
            "phaseExtraction": "31-day Savitzky-Golay smoothing plus scipy Hilbert analytic phase on normalized torque_proxy series",
        },
        "composites": COMPOSITES,
        "records": records,
    }

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as handle:
        json.dump(nan_to_none(payload), handle)


if __name__ == "__main__":
    main()
