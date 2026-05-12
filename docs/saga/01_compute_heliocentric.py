#!/usr/bin/env python3
"""
01_compute_heliocentric.py

DRIFT / SAGA heliocentric alignment test.

Purpose
-------
Compute heliocentric angular separations of Venus, Mars, and all cached bodies
from the Sun--Earth anti-vector at every R(t) minimum, then compare the observed
minima cohort against:

  1. randomized dates drawn from the same ephemeris/EOP date support,
  2. shuffled minima dates preserving the number of observed minima,
  3. all local R(t) minima of equivalent prominence.

The script is designed for the DRIFT JSON cache layout, with files located by
default in ../../data relative to the script.

Key geometric definition
------------------------
The cache is geocentric: observer=EARTH, frame=ECLIPJ2000.  For each date:

  Earth -> Sun vector:      r_ES
  Earth -> Planet vector:   r_EP
  Sun   -> Planet vector:   r_SP = r_EP - r_ES

The Sun--Earth anti-vector is taken as the direction opposite Sun->Earth, i.e.
the Earth->Sun direction r_ES.  Thus a planet lying behind the Sun as seen from
Earth has small heliocentric separation angle between r_SP and r_ES.

This is the physically appropriate 2-D ecliptic-plane reconstruction available
from the cache fields distance_au and ecliptic_longitude_deg.

Outputs
-------
  observed_minima.csv
  equivalent_prominence_minima.csv
  random_date_samples_summary.csv
  shuffled_minima_summary.csv
  body_metric_summary.csv
  metadata.json
  observed_minima_alignment.png
  observed_vs_random_alignment.png

Dependencies
------------
Python 3.10+, pandas, numpy, matplotlib. scipy is preferred for peak detection;
if unavailable, a deterministic local-minima fallback is used.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

try:
    from scipy.signal import find_peaks  # type: ignore
except Exception:  # pragma: no cover
    find_peaks = None

try:
    import matplotlib.pyplot as plt
except Exception:  # pragma: no cover
    plt = None


PLANET_KEYS_DEFAULT = [
    "mercury",
    "venus",
    "mars",
    "jupiter",
    "saturn",
    "uranus",
    "neptune",
    "pluto",
]
SENSIBLE_EXTRA_BODIES = ["sun", "moon", "net"]


# -----------------------------------------------------------------------------
# Utility functions
# -----------------------------------------------------------------------------


def log(msg: str) -> None:
    print(msg, flush=True)


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def normalize_date_series(s: pd.Series) -> pd.Series:
    return pd.to_datetime(s, errors="coerce", utc=False).dt.tz_localize(None).dt.normalize()


def circular_sep_deg(a_deg: np.ndarray | float, b_deg: np.ndarray | float) -> np.ndarray | float:
    """Smallest unsigned circular separation in degrees, range [0, 180]."""
    return np.abs(((np.asarray(a_deg) - np.asarray(b_deg) + 180.0) % 360.0) - 180.0)


def angle_deg_from_xy(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    return (np.degrees(np.arctan2(y, x)) + 360.0) % 360.0


def unit_xy_from_lon(lon_deg: np.ndarray | float) -> Tuple[np.ndarray, np.ndarray]:
    lon = np.radians(np.asarray(lon_deg, dtype=float))
    return np.cos(lon), np.sin(lon)


def vec_xy(distance: np.ndarray | float, lon_deg: np.ndarray | float) -> Tuple[np.ndarray, np.ndarray]:
    ux, uy = unit_xy_from_lon(lon_deg)
    d = np.asarray(distance, dtype=float)
    return d * ux, d * uy


def robust_numeric_convert(df: pd.DataFrame, exclude: Sequence[str] = ("date", "t", "timestamp")) -> pd.DataFrame:
    """
    Pandas >=2.x removed/invalidated errors='ignore' for some call paths.
    Use explicit exclusion + errors='coerce'. This is the direct fix for:
        ValueError: invalid error value specified
    """
    out = df.copy()
    exclusions = {c.lower() for c in exclude}
    for c in out.columns:
        if c.lower() in exclusions or np.issubdtype(out[c].dtype, np.datetime64):
            continue
        if out[c].dtype == object:
            out[c] = pd.to_numeric(out[c], errors="coerce")
        else:
            out[c] = pd.to_numeric(out[c], errors="coerce")
    return out


# -----------------------------------------------------------------------------
# DRIFT JSON loaders
# -----------------------------------------------------------------------------


def load_eop_json(path: Path) -> pd.DataFrame:
    """Load finals.all/combined_historic style EOP JSON into a date-indexable DataFrame."""
    obj = read_json(path)

    records: Optional[List[Dict[str, Any]]] = None

    # finals.all.json: EOP.data.timeSeries
    if isinstance(obj, dict):
        try:
            ts = obj["EOP"]["data"]["timeSeries"]
            if isinstance(ts, list):
                records = ts
        except Exception:
            pass

    # Generic wrappers
    if records is None and isinstance(obj, dict):
        for key in ("records", "data", "timeSeries", "rows"):
            val = obj.get(key)
            if isinstance(val, list) and val and isinstance(val[0], dict):
                records = val
                break

    if records is None and isinstance(obj, list) and (not obj or isinstance(obj[0], dict)):
        records = obj

    if records is None:
        raise ValueError(f"Could not locate EOP records in {path}")

    rows: List[Dict[str, Any]] = []
    for r in records:
        flat: Dict[str, Any] = {}

        # finals.all fields may be nested in date + BulletinA/B dicts.
        if "date" in r and isinstance(r["date"], dict):
            d = r["date"]
            y = d.get("year") or d.get("Year") or d.get("sYear")
            m = d.get("month") or d.get("Month") or d.get("sMonth")
            day = d.get("day") or d.get("Day") or d.get("sDay")
            if y and m and day:
                flat["date"] = f"{int(y):04d}-{int(m):02d}-{int(day):02d}"
            if "MJD" in d:
                flat["mjd"] = d["MJD"]
            elif "mjd" in d:
                flat["mjd"] = d["mjd"]

        for key in ("t", "date", "datetime", "timestamp", "mjd", "MJD"):
            if key in r and key not in flat:
                flat[key] = r[key]

        for k, v in r.items():
            if k == "date":
                continue
            if isinstance(v, dict):
                # Prefer explicit BulletinB over BulletinA when both exist, but keep both.
                for kk, vv in v.items():
                    if isinstance(vv, (str, int, float, type(None))):
                        flat[f"{k}_{kk}"] = vv
            elif isinstance(v, (str, int, float, type(None))):
                flat[k] = v

        rows.append(flat)

    df = pd.DataFrame(rows)

    # Date inference
    date_col = first_present(df, ["date", "datetime", "timestamp", "t"])
    if date_col:
        if date_col == "t" and pd.api.types.is_numeric_dtype(df[date_col]):
            # leave for caller if rolling t alignment is needed
            pass
        else:
            df["date"] = normalize_date_series(df[date_col])
    elif "mjd" in df.columns:
        df["date"] = pd.to_datetime(df["mjd"].astype(float), unit="D", origin="1858-11-17", errors="coerce").dt.normalize()
    elif "MJD" in df.columns:
        df["date"] = pd.to_datetime(df["MJD"].astype(float), unit="D", origin="1858-11-17", errors="coerce").dt.normalize()

    if "date" not in df.columns:
        raise ValueError(f"Could not infer EOP date column in {path}")

    df = robust_numeric_convert(df, exclude=("date", "datetime", "timestamp"))
    df = df.dropna(subset=["date"]).drop_duplicates("date").sort_values("date").reset_index(drop=True)
    return df


def first_present(df: pd.DataFrame, candidates: Sequence[str]) -> Optional[str]:
    cols_lower = {c.lower(): c for c in df.columns}
    for c in candidates:
        if c in df.columns:
            return c
        if c.lower() in cols_lower:
            return cols_lower[c.lower()]
    return None


def load_rolling_json(path: Path, eop_df: Optional[pd.DataFrame] = None) -> pd.DataFrame:
    """Load rolling_stats.json. Handles dict-of-arrays and list-of-records."""
    obj = read_json(path)

    if isinstance(obj, dict):
        # Common DRIFT rolling_stats.json format: {"t": [...], "R": [...], ...}
        array_keys = [k for k, v in obj.items() if isinstance(v, list)]
        lengths = {k: len(obj[k]) for k in array_keys}
        if array_keys and len(set(lengths.values())) == 1:
            df = pd.DataFrame({k: obj[k] for k in array_keys})
        elif isinstance(obj.get("records"), list):
            df = pd.DataFrame(obj["records"])
        elif isinstance(obj.get("data"), list):
            df = pd.DataFrame(obj["data"])
        else:
            raise ValueError(f"Could not locate rolling arrays/records in {path}")
    elif isinstance(obj, list):
        df = pd.DataFrame(obj)
    else:
        raise ValueError(f"Unsupported rolling JSON structure in {path}")

    # Date inference. rolling_stats often has t=0..N-1 aligned to EOP rows.
    if "date" in df.columns:
        df["date"] = normalize_date_series(df["date"])
    elif "datetime" in df.columns:
        df["date"] = normalize_date_series(df["datetime"])
    elif "timestamp" in df.columns:
        df["date"] = normalize_date_series(df["timestamp"])
    elif "t" in df.columns and eop_df is not None and len(eop_df) >= len(df):
        t_num = pd.to_numeric(df["t"], errors="coerce")
        if t_num.notna().all() and np.allclose(t_num.values, np.round(t_num.values), equal_nan=False):
            idx = t_num.astype(int).to_numpy()
            if idx.min() >= 0 and idx.max() < len(eop_df):
                df["date"] = eop_df.iloc[idx]["date"].to_numpy()
            else:
                df["date"] = eop_df.iloc[: len(df)]["date"].to_numpy()
        else:
            df["date"] = eop_df.iloc[: len(df)]["date"].to_numpy()
    elif eop_df is not None and len(eop_df) >= len(df):
        df["date"] = eop_df.iloc[: len(df)]["date"].to_numpy()
    else:
        raise ValueError(
            f"Could not infer rolling date column in {path}. Provide --eop-file so t can be aligned."
        )

    df = robust_numeric_convert(df, exclude=("date", "datetime", "timestamp"))
    df = df.dropna(subset=["date"]).drop_duplicates("date").sort_values("date").reset_index(drop=True)
    return df


def flatten_ephemeris_records(records: Iterable[Dict[str, Any]]) -> pd.DataFrame:
    rows: List[Dict[str, Any]] = []
    for rec in records:
        row: Dict[str, Any] = {}
        t = rec.get("t") or rec.get("date") or rec.get("datetime") or rec.get("timestamp")
        row["date"] = t
        bodies = rec.get("bodies", {})
        if not isinstance(bodies, dict):
            continue
        for body_key, metrics in bodies.items():
            if not isinstance(metrics, dict):
                continue
            for metric, val in metrics.items():
                if isinstance(val, (str, int, float, type(None))):
                    row[f"{body_key}_{metric}"] = val
        rows.append(row)
    df = pd.DataFrame(rows)
    df["date"] = normalize_date_series(df["date"])
    df = robust_numeric_convert(df, exclude=("date",))
    return df.dropna(subset=["date"]).drop_duplicates("date").sort_values("date").reset_index(drop=True)


def load_ephemeris_json(data_dir: Path, ephemeris_file: str) -> pd.DataFrame:
    """
    Load ephemeris_historic.json. If a manifest is supplied or the main JSON is
    missing/too large by partition, also supports ephemeris_by_year/*.json.
    """
    path = data_dir / ephemeris_file
    if not path.exists():
        raise FileNotFoundError(path)

    obj = read_json(path)

    # Main full file: {source:{...}, records:[...]}
    if isinstance(obj, dict) and isinstance(obj.get("records"), list):
        return flatten_ephemeris_records(obj["records"])

    # Manifest: source + partition_dir + years.
    if isinstance(obj, dict) and "partition_dir" in obj and "years" in obj:
        part_dir = data_dir / str(obj["partition_dir"])
        return load_partitioned_ephemeris(part_dir, [str(y) for y in obj["years"]])

    # Some deployments name the full file but only ship sidecar manifest.
    manifest = data_dir / f"{Path(ephemeris_file).stem}.manifest.json"
    if manifest.exists():
        man = read_json(manifest)
        part_dir = data_dir / str(man.get("partition_dir", "ephemeris_by_year"))
        years = [str(y) for y in man.get("years", [])]
        if years:
            return load_partitioned_ephemeris(part_dir, years)

    raise ValueError(f"Could not load ephemeris records or manifest from {path}")


def load_partitioned_ephemeris(part_dir: Path, years: Sequence[str]) -> pd.DataFrame:
    frames: List[pd.DataFrame] = []
    for y in years:
        candidates = [part_dir / f"{y}.json", part_dir / f"ephemeris_{y}.json"]
        p = next((c for c in candidates if c.exists()), None)
        if p is None:
            continue
        obj = read_json(p)
        if isinstance(obj, dict) and isinstance(obj.get("records"), list):
            frames.append(flatten_ephemeris_records(obj["records"]))
        elif isinstance(obj, list):
            frames.append(flatten_ephemeris_records(obj))
    if not frames:
        raise FileNotFoundError(f"No partitioned ephemeris files found in {part_dir}")
    return pd.concat(frames, ignore_index=True).drop_duplicates("date").sort_values("date").reset_index(drop=True)


# -----------------------------------------------------------------------------
# R(t) minima detection
# -----------------------------------------------------------------------------


def choose_r_column(df: pd.DataFrame, explicit: Optional[str]) -> str:
    if explicit:
        if explicit not in df.columns:
            raise ValueError(f"Requested --r-column '{explicit}' not found. Available columns: {list(df.columns)[:80]}")
        return explicit

    candidates = [
        "R(t)", "R", "r", "orthogonal_deviation_ratio", "orthogonalDeviationRatio",
        "deviation_ratio", "ratio", "stability_ratio", "R_smooth",
    ]
    for c in candidates:
        if c in df.columns and pd.api.types.is_numeric_dtype(df[c]):
            return c

    # Avoid t/date. Prefer columns with 'R' or 'ratio'.
    numeric = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c]) and c.lower() not in ("t", "index")]
    scored: List[Tuple[int, str]] = []
    for c in numeric:
        cl = c.lower()
        score = 0
        if cl == "r": score += 10
        if "r(" in cl: score += 10
        if "ratio" in cl: score += 6
        if "orthogonal" in cl: score += 6
        if "deviation" in cl: score += 3
        if "smooth" in cl: score += 1
        scored.append((score, c))
    scored.sort(reverse=True)
    if scored and scored[0][0] > 0:
        return scored[0][1]
    raise ValueError(f"Could not infer R(t) column. Use --r-column. Available columns: {list(df.columns)[:100]}")


def detect_local_minima(
    df: pd.DataFrame,
    r_col: str,
    smooth_days: int,
    min_distance_days: int,
    prominence_quantile: float,
) -> Tuple[pd.DataFrame, pd.DataFrame, float]:
    work = df[["date", r_col]].copy().dropna().sort_values("date").reset_index(drop=True)
    work["R_raw"] = pd.to_numeric(work[r_col], errors="coerce")
    work = work.dropna(subset=["R_raw"]).reset_index(drop=True)

    if smooth_days and smooth_days > 1:
        win = int(smooth_days)
        if win % 2 == 0:
            win += 1
        work["R_smooth"] = work["R_raw"].rolling(win, center=True, min_periods=max(3, win // 3)).median()
        work["R_smooth"] = work["R_smooth"].interpolate(limit_direction="both")
    else:
        work["R_smooth"] = work["R_raw"]

    y = work["R_smooth"].to_numpy(dtype=float)
    inv = -y

    if find_peaks is not None:
        peaks_all, props_all = find_peaks(inv, distance=max(1, int(min_distance_days)))
        if len(peaks_all) == 0:
            raise ValueError("No local minima detected. Try lowering --min-distance-days or changing --r-column.")
        prominences_all = props_all.get("prominences")
        if prominences_all is None:
            _, props_prom = find_peaks(inv, distance=max(1, int(min_distance_days)), prominence=0)
            peaks_all, prominences_all = _, props_prom.get("prominences", np.zeros(len(_)))
    else:
        # Simple fallback: strict local minima, then greedy distance thinning by depth.
        idx = np.where((y[1:-1] < y[:-2]) & (y[1:-1] <= y[2:]))[0] + 1
        if len(idx) == 0:
            raise ValueError("No local minima detected by fallback detector.")
        # crude prominence proxy = local max shoulder minus y
        prominences = []
        half = max(30, int(min_distance_days))
        for i in idx:
            lo, hi = max(0, i - half), min(len(y), i + half + 1)
            prominences.append(float(np.nanmax(y[lo:hi]) - y[i]))
        order = np.argsort([-p for p in prominences])
        keep: List[int] = []
        for oi in order:
            ii = int(idx[oi])
            if all(abs(ii - jj) >= min_distance_days for jj in keep):
                keep.append(ii)
        peaks_all = np.array(sorted(keep), dtype=int)
        prominences_all = np.array([prominences[list(idx).index(i)] for i in peaks_all], dtype=float)

    all_min = work.iloc[peaks_all].copy().reset_index(drop=True)
    all_min["min_index"] = peaks_all
    all_min["prominence"] = np.asarray(prominences_all, dtype=float)
    all_min = all_min.sort_values("date").reset_index(drop=True)

    prom_threshold = float(np.nanquantile(all_min["prominence"], prominence_quantile))
    observed = all_min[all_min["prominence"] >= prom_threshold].copy().reset_index(drop=True)

    return observed, all_min, prom_threshold


# -----------------------------------------------------------------------------
# Heliocentric geometry
# -----------------------------------------------------------------------------


def available_bodies(eph: pd.DataFrame) -> List[str]:
    bodies = []
    suffix = "_ecliptic_longitude_deg"
    for c in eph.columns:
        if c.endswith(suffix):
            bodies.append(c[: -len(suffix)])
    return sorted(set(bodies))


def add_heliocentric_metrics(eph: pd.DataFrame, bodies: Sequence[str]) -> pd.DataFrame:
    out = eph.copy()

    sun_lon_col = "sun_ecliptic_longitude_deg"
    sun_dist_col = "sun_distance_au"
    if sun_lon_col not in out.columns or sun_dist_col not in out.columns:
        raise ValueError("Ephemeris cache must include sun_ecliptic_longitude_deg and sun_distance_au")

    sun_x, sun_y = vec_xy(out[sun_dist_col].to_numpy(float), out[sun_lon_col].to_numpy(float))
    sun_anti_lon = out[sun_lon_col].to_numpy(float)  # Earth->Sun direction = anti-vector to Sun->Earth.
    out["sun_earth_antivector_lon_deg"] = sun_anti_lon

    for body in bodies:
        lon_col = f"{body}_ecliptic_longitude_deg"
        dist_col = f"{body}_distance_au"
        if lon_col not in out.columns or dist_col not in out.columns:
            continue
        if body == "sun":
            continue

        bx, by = vec_xy(out[dist_col].to_numpy(float), out[lon_col].to_numpy(float))
        spx = bx - sun_x
        spy = by - sun_y
        sp_dist = np.sqrt(spx * spx + spy * spy)
        sp_lon = angle_deg_from_xy(spx, spy)

        out[f"{body}_heliocentric_lon_deg"] = sp_lon
        out[f"{body}_heliocentric_distance_au"] = sp_dist
        out[f"{body}_helio_sep_from_sun_earth_antivector_deg"] = circular_sep_deg(sp_lon, sun_anti_lon)
        out[f"{body}_geocentric_elongation_from_sun_deg"] = circular_sep_deg(out[lon_col].to_numpy(float), sun_anti_lon)

    # Pairwise Venus-Mars compact diagnostics if available.
    if "venus_heliocentric_lon_deg" in out.columns and "mars_heliocentric_lon_deg" in out.columns:
        out["venus_mars_heliocentric_sep_deg"] = circular_sep_deg(
            out["venus_heliocentric_lon_deg"].to_numpy(float),
            out["mars_heliocentric_lon_deg"].to_numpy(float),
        )
        out["venus_mars_joint_antivector_sep_mean_deg"] = (
            out["venus_helio_sep_from_sun_earth_antivector_deg"]
            + out["mars_helio_sep_from_sun_earth_antivector_deg"]
        ) / 2.0
        out["venus_mars_joint_antivector_sep_max_deg"] = np.maximum(
            out["venus_helio_sep_from_sun_earth_antivector_deg"],
            out["mars_helio_sep_from_sun_earth_antivector_deg"],
        )

    return out


def nearest_join_dates(left: pd.DataFrame, right: pd.DataFrame, tolerance_days: int = 2) -> pd.DataFrame:
    left2 = left.sort_values("date").copy()
    right2 = right.sort_values("date").copy()
    joined = pd.merge_asof(
        left2,
        right2,
        on="date",
        direction="nearest",
        tolerance=pd.Timedelta(days=tolerance_days),
    )
    return joined


# -----------------------------------------------------------------------------
# Null models and summaries
# -----------------------------------------------------------------------------


def summarize_metric(values: pd.Series | np.ndarray) -> Dict[str, float]:
    a = pd.to_numeric(pd.Series(values), errors="coerce").dropna().to_numpy(float)
    if len(a) == 0:
        return {"n": 0, "mean": np.nan, "median": np.nan, "min": np.nan, "p10": np.nan, "p25": np.nan, "p75": np.nan, "p90": np.nan}
    return {
        "n": int(len(a)),
        "mean": float(np.mean(a)),
        "median": float(np.median(a)),
        "min": float(np.min(a)),
        "p10": float(np.quantile(a, 0.10)),
        "p25": float(np.quantile(a, 0.25)),
        "p75": float(np.quantile(a, 0.75)),
        "p90": float(np.quantile(a, 0.90)),
    }


def cohort_summary(df: pd.DataFrame, metrics: Sequence[str], label: str) -> pd.DataFrame:
    rows = []
    for m in metrics:
        if m not in df.columns:
            continue
        s = summarize_metric(df[m])
        rows.append({"cohort": label, "metric": m, **s})
    return pd.DataFrame(rows)


def random_date_null(
    eph: pd.DataFrame,
    metrics: Sequence[str],
    n_dates: int,
    iterations: int,
    seed: int,
) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    idx_all = np.arange(len(eph))
    rows: List[Dict[str, Any]] = []
    replace = n_dates > len(eph)
    for i in range(iterations):
        idx = rng.choice(idx_all, size=n_dates, replace=replace)
        sample = eph.iloc[idx]
        row: Dict[str, Any] = {"iteration": i, "n": n_dates}
        for m in metrics:
            if m not in sample.columns:
                continue
            vals = pd.to_numeric(sample[m], errors="coerce").dropna().to_numpy(float)
            row[f"{m}__mean"] = float(np.mean(vals)) if len(vals) else np.nan
            row[f"{m}__median"] = float(np.median(vals)) if len(vals) else np.nan
            row[f"{m}__min"] = float(np.min(vals)) if len(vals) else np.nan
        rows.append(row)
    return pd.DataFrame(rows)


def shuffled_minima_null(
    all_minima_joined: pd.DataFrame,
    metrics: Sequence[str],
    n_dates: int,
    iterations: int,
    seed: int,
) -> pd.DataFrame:
    rng = np.random.default_rng(seed + 1009)
    idx_all = np.arange(len(all_minima_joined))
    rows: List[Dict[str, Any]] = []
    replace = n_dates > len(all_minima_joined)
    for i in range(iterations):
        idx = rng.choice(idx_all, size=n_dates, replace=replace)
        sample = all_minima_joined.iloc[idx]
        row: Dict[str, Any] = {"iteration": i, "n": n_dates}
        for m in metrics:
            if m not in sample.columns:
                continue
            vals = pd.to_numeric(sample[m], errors="coerce").dropna().to_numpy(float)
            row[f"{m}__mean"] = float(np.mean(vals)) if len(vals) else np.nan
            row[f"{m}__median"] = float(np.median(vals)) if len(vals) else np.nan
            row[f"{m}__min"] = float(np.min(vals)) if len(vals) else np.nan
        rows.append(row)
    return pd.DataFrame(rows)


def p_low_against_null(observed_value: float, null_values: pd.Series) -> float:
    vals = pd.to_numeric(null_values, errors="coerce").dropna().to_numpy(float)
    if len(vals) == 0 or not np.isfinite(observed_value):
        return np.nan
    # Lower angular separation is the alignment direction of interest.
    return float((np.sum(vals <= observed_value) + 1.0) / (len(vals) + 1.0))


def build_metric_summary(
    observed: pd.DataFrame,
    equivalent: pd.DataFrame,
    random_null: pd.DataFrame,
    shuffled_null: pd.DataFrame,
    metrics: Sequence[str],
) -> pd.DataFrame:
    rows: List[Dict[str, Any]] = []
    for m in metrics:
        if m not in observed.columns:
            continue
        obs_mean = float(pd.to_numeric(observed[m], errors="coerce").mean())
        obs_median = float(pd.to_numeric(observed[m], errors="coerce").median())
        obs_min = float(pd.to_numeric(observed[m], errors="coerce").min())

        row = {
            "metric": m,
            "observed_n": int(pd.to_numeric(observed[m], errors="coerce").notna().sum()),
            "observed_mean": obs_mean,
            "observed_median": obs_median,
            "observed_min": obs_min,
        }

        if m in equivalent.columns:
            eq_vals = pd.to_numeric(equivalent[m], errors="coerce")
            row.update({
                "equivalent_all_mean": float(eq_vals.mean()),
                "equivalent_all_median": float(eq_vals.median()),
                "equivalent_all_min": float(eq_vals.min()),
            })

        for stat, obs_val in (("mean", obs_mean), ("median", obs_median), ("min", obs_min)):
            col = f"{m}__{stat}"
            if col in random_null.columns:
                row[f"random_p_low_{stat}"] = p_low_against_null(obs_val, random_null[col])
                row[f"random_null_{stat}_median"] = float(pd.to_numeric(random_null[col], errors="coerce").median())
            if col in shuffled_null.columns:
                row[f"shuffled_p_low_{stat}"] = p_low_against_null(obs_val, shuffled_null[col])
                row[f"shuffled_null_{stat}_median"] = float(pd.to_numeric(shuffled_null[col], errors="coerce").median())
        rows.append(row)
    return pd.DataFrame(rows)


# -----------------------------------------------------------------------------
# Plotting
# -----------------------------------------------------------------------------


def write_plots(out_dir: Path, observed: pd.DataFrame, random_null: pd.DataFrame, metrics: Sequence[str]) -> None:
    if plt is None:
        return

    key_metrics = [m for m in metrics if m in observed.columns][:12]
    if key_metrics:
        plot_df = observed[["date"] + key_metrics].copy()
        fig, ax = plt.subplots(figsize=(14, max(5, 0.45 * len(key_metrics))))
        y_positions = np.arange(len(key_metrics))
        for yi, m in enumerate(key_metrics):
            vals = pd.to_numeric(plot_df[m], errors="coerce").to_numpy(float)
            ax.scatter(plot_df["date"], np.full_like(vals, yi, dtype=float), s=np.maximum(8, 90 - vals * 0.3), alpha=0.75)
        ax.set_yticks(y_positions)
        ax.set_yticklabels(key_metrics)
        ax.set_title("Observed R(t) minima: heliocentric/geocentric alignment metrics")
        ax.set_xlabel("Date")
        ax.grid(True, alpha=0.25)
        fig.tight_layout()
        fig.savefig(out_dir / "observed_minima_alignment.png", dpi=180)
        plt.close(fig)

    # Null histogram for the most important joint metric if present.
    preferred = "venus_mars_joint_antivector_sep_mean_deg"
    if preferred in observed.columns and f"{preferred}__mean" in random_null.columns:
        obs = float(pd.to_numeric(observed[preferred], errors="coerce").mean())
        vals = pd.to_numeric(random_null[f"{preferred}__mean"], errors="coerce").dropna().to_numpy(float)
        fig, ax = plt.subplots(figsize=(10, 6))
        ax.hist(vals, bins=60, alpha=0.8)
        ax.axvline(obs, linestyle="--", linewidth=2, label=f"observed mean = {obs:.2f}°")
        ax.set_title("Observed Venus-Mars joint anti-vector separation vs randomized dates")
        ax.set_xlabel("Random-date cohort mean separation (deg)")
        ax.set_ylabel("Count")
        ax.legend()
        ax.grid(True, alpha=0.25)
        fig.tight_layout()
        fig.savefig(out_dir / "observed_vs_random_alignment.png", dpi=180)
        plt.close(fig)


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Compute heliocentric planetary alignment at DRIFT R(t) minima.")
    p.add_argument("--data-dir", default="../../data", help="Directory containing DRIFT JSON caches.")
    p.add_argument("--out-dir", default="./outputs/heliocentric_minima", help="Output directory.")
    p.add_argument("--eop-file", default="combined_historic.json", help="EOP JSON file, e.g. combined_historic.json or finals.all.json.")
    p.add_argument("--rolling-file", default="rolling_stats.json", help="rolling_stats JSON file containing R(t).")
    p.add_argument("--ephemeris-file", default="ephemeris_historic.json", help="Ephemeris JSON file or manifest.")
    p.add_argument("--r-column", default=None, help="Explicit R(t) column name. If omitted, inferred.")
    p.add_argument("--smooth-days", type=int, default=31, help="Centered rolling median smoothing window for R(t).")
    p.add_argument("--min-distance-days", type=int, default=120, help="Minimum spacing between R(t) minima.")
    p.add_argument("--prominence-quantile", type=float, default=0.75, help="Prominence quantile threshold for observed minima cohort.")
    p.add_argument("--random-iterations", type=int, default=5000, help="Monte Carlo iterations for random/shuffled nulls.")
    p.add_argument("--seed", type=int, default=10431, help="Random seed.")
    p.add_argument("--bodies", default="auto", help="Comma list of bodies or 'auto'.")
    p.add_argument("--date-min", default=None, help="Optional lower date bound YYYY-MM-DD.")
    p.add_argument("--date-max", default=None, help="Optional upper date bound YYYY-MM-DD.")
    return p.parse_args()


def main() -> int:
    args = parse_args()

    script_dir = Path(__file__).resolve().parent
    data_dir = (script_dir / args.data_dir).resolve() if not Path(args.data_dir).is_absolute() else Path(args.data_dir)
    out_dir = (script_dir / args.out_dir).resolve() if not Path(args.out_dir).is_absolute() else Path(args.out_dir)
    ensure_dir(out_dir)

    log(f"Data dir: {data_dir}")
    log(f"Out dir:  {out_dir}")

    eop_path = data_dir / args.eop_file
    rolling_path = data_dir / args.rolling_file

    log(f"Loading EOP:        {eop_path}")
    eop = load_eop_json(eop_path)
    log(f"  EOP rows:        {len(eop):,}  {eop['date'].min().date()} to {eop['date'].max().date()}")

    log(f"Loading rolling:    {rolling_path}")
    rolling = load_rolling_json(rolling_path, eop_df=eop)
    r_col = choose_r_column(rolling, args.r_column)
    log(f"  rolling rows:    {len(rolling):,}  R column: {r_col}")

    log(f"Loading ephemeris:  {data_dir / args.ephemeris_file}")
    eph = load_ephemeris_json(data_dir, args.ephemeris_file)
    log(f"  ephemeris rows:  {len(eph):,}  {eph['date'].min().date()} to {eph['date'].max().date()}")

    # Optional date bounds.
    if args.date_min:
        dmin = pd.Timestamp(args.date_min).normalize()
        rolling = rolling[rolling["date"] >= dmin].reset_index(drop=True)
        eph = eph[eph["date"] >= dmin].reset_index(drop=True)
    if args.date_max:
        dmax = pd.Timestamp(args.date_max).normalize()
        rolling = rolling[rolling["date"] <= dmax].reset_index(drop=True)
        eph = eph[eph["date"] <= dmax].reset_index(drop=True)

    bodies_avail = available_bodies(eph)
    if args.bodies.strip().lower() == "auto":
        bodies = [b for b in PLANET_KEYS_DEFAULT + SENSIBLE_EXTRA_BODIES if b in bodies_avail]
    else:
        bodies = [b.strip().lower() for b in args.bodies.split(",") if b.strip()]
        missing = [b for b in bodies if b not in bodies_avail]
        if missing:
            raise ValueError(f"Requested bodies not present in ephemeris cache: {missing}. Available: {bodies_avail}")
    log(f"Bodies:            {', '.join(bodies)}")

    observed_min, all_min, prom_threshold = detect_local_minima(
        rolling,
        r_col=r_col,
        smooth_days=args.smooth_days,
        min_distance_days=args.min_distance_days,
        prominence_quantile=args.prominence_quantile,
    )
    log(f"All local minima:  {len(all_min):,}")
    log(f"Observed minima:   {len(observed_min):,}  prominence >= {prom_threshold:.6g}")

    eph2 = add_heliocentric_metrics(eph, bodies=bodies)

    observed_joined = nearest_join_dates(observed_min, eph2, tolerance_days=2)
    all_min_joined = nearest_join_dates(all_min, eph2, tolerance_days=2)

    # Metrics to compare. Include all sensible angular and proxy columns.
    metrics: List[str] = []
    for b in bodies:
        for suffix in (
            "helio_sep_from_sun_earth_antivector_deg",
            "geocentric_elongation_from_sun_deg",
            "heliocentric_distance_au",
            "torque_proxy",
            "angular_velocity_deg_per_day",
            "radial_velocity_km_s",
            "distance_au",
        ):
            col = f"{b}_{suffix}"
            if col in observed_joined.columns:
                metrics.append(col)
    for col in (
        "venus_mars_heliocentric_sep_deg",
        "venus_mars_joint_antivector_sep_mean_deg",
        "venus_mars_joint_antivector_sep_max_deg",
        "net_torque_proxy",
        "moon_torque_proxy",
        "sun_torque_proxy",
    ):
        if col in observed_joined.columns and col not in metrics:
            metrics.append(col)

    # Restrict null support to ephemeris dates overlapping the rolling/EOP date range.
    support_min = rolling["date"].min()
    support_max = rolling["date"].max()
    eph_support = eph2[(eph2["date"] >= support_min) & (eph2["date"] <= support_max)].reset_index(drop=True)
    if len(eph_support) == 0:
        raise ValueError("No ephemeris rows overlap the rolling R(t) date support.")

    log("Running randomized-date null...")
    random_null = random_date_null(
        eph_support,
        metrics=metrics,
        n_dates=len(observed_joined),
        iterations=args.random_iterations,
        seed=args.seed,
    )

    log("Running shuffled-minima null...")
    shuffled_null = shuffled_minima_null(
        all_min_joined,
        metrics=metrics,
        n_dates=len(observed_joined),
        iterations=args.random_iterations,
        seed=args.seed,
    )

    metric_summary = build_metric_summary(observed_joined, all_min_joined, random_null, shuffled_null, metrics)

    observed_summary = cohort_summary(observed_joined, metrics, "observed_prominent_R_minima")
    all_min_summary = cohort_summary(all_min_joined, metrics, "all_local_R_minima")
    cohort_summaries = pd.concat([observed_summary, all_min_summary], ignore_index=True)

    # Outputs.
    observed_joined.to_csv(out_dir / "observed_minima.csv", index=False)
    all_min_joined.to_csv(out_dir / "equivalent_prominence_minima.csv", index=False)
    random_null.to_csv(out_dir / "random_date_samples_summary.csv", index=False)
    shuffled_null.to_csv(out_dir / "shuffled_minima_summary.csv", index=False)
    metric_summary.to_csv(out_dir / "body_metric_summary.csv", index=False)
    cohort_summaries.to_csv(out_dir / "cohort_summaries.csv", index=False)

    meta = {
        "data_dir": str(data_dir),
        "out_dir": str(out_dir),
        "eop_file": args.eop_file,
        "rolling_file": args.rolling_file,
        "ephemeris_file": args.ephemeris_file,
        "r_column": r_col,
        "smooth_days": args.smooth_days,
        "min_distance_days": args.min_distance_days,
        "prominence_quantile": args.prominence_quantile,
        "prominence_threshold": prom_threshold,
        "random_iterations": args.random_iterations,
        "seed": args.seed,
        "bodies": bodies,
        "available_bodies": bodies_avail,
        "rolling_date_min": str(rolling["date"].min().date()),
        "rolling_date_max": str(rolling["date"].max().date()),
        "ephemeris_date_min": str(eph["date"].min().date()),
        "ephemeris_date_max": str(eph["date"].max().date()),
        "n_all_local_minima": int(len(all_min_joined)),
        "n_observed_prominent_minima": int(len(observed_joined)),
        "geometric_definition": "Planet heliocentric vector reconstructed as Earth->Planet minus Earth->Sun; separation measured to Earth->Sun, the anti-vector of Sun->Earth.",
    }
    with (out_dir / "metadata.json").open("w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    write_plots(out_dir, observed_joined, random_null, metrics)

    # Console top-line diagnostics.
    log("\nTop alignment metrics, sorted by randomized-date p_low_mean:")
    show_cols = [
        "metric", "observed_mean", "random_null_mean_median", "random_p_low_mean",
        "observed_median", "random_p_low_median", "observed_min", "random_p_low_min",
    ]
    available_show = [c for c in show_cols if c in metric_summary.columns]
    if available_show:
        tmp = metric_summary.copy()
        if "random_p_low_mean" in tmp.columns:
            tmp = tmp.sort_values("random_p_low_mean", na_position="last")
        print(tmp[available_show].head(30).to_string(index=False))

    log("\nWrote:")
    for name in [
        "observed_minima.csv",
        "equivalent_prominence_minima.csv",
        "random_date_samples_summary.csv",
        "shuffled_minima_summary.csv",
        "body_metric_summary.csv",
        "cohort_summaries.csv",
        "metadata.json",
        "observed_minima_alignment.png",
        "observed_vs_random_alignment.png",
    ]:
        p = out_dir / name
        if p.exists():
            log(f"  {p}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
