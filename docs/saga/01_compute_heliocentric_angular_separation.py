#!/usr/bin/env python3
"""
01_compute_heliocentric_angular_separation.py

DRIFT comparison script.

Purpose
-------
Compute phase / angular-separation diagnostics from the DRIFT JSON cache and
compare them against polar-motion diagnostics derived from EOP:

    - R(t) = sqrt(xp^2 + yp^2)
    - polar-motion angular velocity = sqrt(dxp^2 + dyp^2) / dt
    - LOD, where available
    - body torque proxies
    - body angular velocities
    - selected body-body angular separations

Input directory
---------------
Default: ../../data relative to this script.

Expected cache files
--------------------
    ../../data/ephemeris_historic.json
    ../../data/ephemeris_historic.manifest.json + ../../data/ephemeris_by_year/*.json  optional
    ../../data/combined_latest.json
    ../../data/combined_historic.json
    ../../data/eop_historic.json
    ../../data/eop_latest.json
    ../../data/eop_c04_historic.json
    ../../data/eop_jpl_eop2_historic.json
    ../../data/markers.json

Outputs
-------
    outputs/01_heliocentric_angular_separation/
        drift_comparison_timeseries.csv
        angular_separations.csv
        marker_windows_summary.csv
        overlay_matrix.png
        marker_window_<date>_<label>.png
"""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt


BODY_KEYS = [
    "sun",
    "moon",
    "mercury",
    "venus",
    "mars",
    "jupiter",
    "saturn",
    "uranus",
    "neptune",
    "pluto",
    "net",
]

DEFAULT_SEPARATION_PAIRS = [
    ("venus", "mars"),
    ("venus", "jupiter"),
    ("venus", "saturn"),
    ("mars", "jupiter"),
    ("mars", "saturn"),
    ("jupiter", "saturn"),
    ("sun", "jupiter"),
    ("sun", "saturn"),
    ("moon", "sun"),
    ("moon", "venus"),
    ("moon", "mars"),
]

DEFAULT_OVERLAY_COLUMNS = [
    "R",
    "polar_angular_velocity",
    "lod",
    "torque_sun",
    "torque_moon",
    "torque_mercury",
    "torque_venus",
    "torque_mars",
    "torque_jupiter",
    "torque_saturn",
    "torque_uranus",
    "torque_neptune",
    "torque_pluto",
    "torque_net",
    "angvel_sun",
    "angvel_moon",
    "angvel_venus",
    "angvel_mars",
    "sep_venus_mars",
    "sep_jupiter_saturn",
    "sep_sun_jupiter",
    "sep_sun_saturn",
    "sep_moon_sun",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compute DRIFT heliocentric/angular-separation comparison products."
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path(__file__).resolve().parent / "../../data",
        help="Path to DRIFT JSON cache directory. Default: ../../data relative to script.",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("outputs/01_heliocentric_angular_separation"),
        help="Output directory.",
    )
    parser.add_argument(
        "--eop",
        default="auto",
        choices=[
            "auto",
            "combined_latest",
            "combined_historic",
            "eop_historic",
            "eop_latest",
            "eop_c04_historic",
            "eop_jpl_eop2_historic",
        ],
        help="EOP cache source.",
    )
    parser.add_argument(
        "--start",
        default=None,
        help="Optional start date, YYYY-MM-DD.",
    )
    parser.add_argument(
        "--end",
        default=None,
        help="Optional end date, YYYY-MM-DD.",
    )
    parser.add_argument(
        "--window-days",
        type=int,
        default=540,
        help="Marker-window width in days for individual plots.",
    )
    parser.add_argument(
        "--smooth",
        type=int,
        default=21,
        help="Centered rolling smoothing window in days for comparison rows.",
    )
    parser.add_argument(
        "--z-window",
        type=int,
        default=365,
        help="Rolling normalization window in days.",
    )
    parser.add_argument(
        "--min-periods",
        type=int,
        default=30,
        help="Minimum periods for rolling operations.",
    )
    parser.add_argument(
        "--no-marker-plots",
        action="store_true",
        help="Skip individual marker-window plots.",
    )
    return parser.parse_args()


def read_json(path: Path) -> Any:
    if not path.exists():
        raise FileNotFoundError(f"Missing required file: {path}")
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def safe_float(x: Any) -> float:
    try:
        if x is None or x == "":
            return np.nan
        return float(x)
    except Exception:
        return np.nan


def circular_abs_separation_deg(a: pd.Series, b: pd.Series) -> pd.Series:
    """
    Return minimum angular separation in degrees on [0, 180].
    """
    d = (a - b + 180.0) % 360.0 - 180.0
    return d.abs()


def signed_circular_delta_deg(a: pd.Series, b: pd.Series) -> pd.Series:
    """
    Return signed angular delta in degrees on [-180, 180].
    """
    return (a - b + 180.0) % 360.0 - 180.0


def slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^\w\s-]", "", value)
    value = re.sub(r"[-\s]+", "_", value)
    return value or "marker"


def load_eop(data_dir: Path, choice: str = "auto") -> pd.DataFrame:
    candidates = {
        "combined_latest": data_dir / "combined_latest.json",
        "combined_historic": data_dir / "combined_historic.json",
        "eop_historic": data_dir / "eop_historic.json",
        "eop_latest": data_dir / "eop_latest.json",
        "eop_c04_historic": data_dir / "eop_c04_historic.json",
        "eop_jpl_eop2_historic": data_dir / "eop_jpl_eop2_historic.json",
    }

    if choice == "auto":
        preferred = [
            "combined_latest",
            "combined_historic",
            "eop_historic",
            "eop_c04_historic",
            "eop_jpl_eop2_historic",
            "eop_latest",
        ]
    else:
        preferred = [choice]

    for key in preferred:
        path = candidates[key]
        if path.exists():
            records = read_json(path)
            if isinstance(records, list) and records:
                df = pd.DataFrame(records)
                if {"t", "xp", "yp"}.issubset(df.columns):
                    df["t"] = pd.to_datetime(df["t"], errors="coerce")
                    df = df.dropna(subset=["t"]).sort_values("t")
                    for col in ["xp", "yp", "lod", "ut1_utc"]:
                        if col in df.columns:
                            df[col] = pd.to_numeric(df[col], errors="coerce")
                    df["source_eop"] = key
                    return df

    raise FileNotFoundError(
        f"No usable EOP cache found in {data_dir}. Tried: {', '.join(preferred)}"
    )


def compute_eop_diagnostics(eop: pd.DataFrame) -> pd.DataFrame:
    df = eop.copy()
    df = df.sort_values("t").drop_duplicates("t").reset_index(drop=True)

    df["R"] = np.sqrt(df["xp"] ** 2 + df["yp"] ** 2)

    dt_days = df["t"].diff().dt.total_seconds() / 86400.0
    dx = df["xp"].diff()
    dy = df["yp"].diff()

    df["polar_angular_velocity"] = np.sqrt(dx ** 2 + dy ** 2) / dt_days
    df.loc[dt_days <= 0, "polar_angular_velocity"] = np.nan

    df["polar_heading_deg"] = (np.degrees(np.arctan2(dy, dx)) + 360.0) % 360.0
    df["dR_dt"] = df["R"].diff() / dt_days

    keep = ["t", "xp", "yp", "R", "polar_angular_velocity", "polar_heading_deg", "dR_dt"]
    for optional in ["lod", "ut1_utc", "source_eop"]:
        if optional in df.columns:
            keep.append(optional)

    return df[keep]


def load_ephemeris_from_monolith(path: Path) -> pd.DataFrame:
    payload = read_json(path)
    records = payload.get("records", [])
    rows: List[Dict[str, Any]] = []

    for rec in records:
        row: Dict[str, Any] = {"t": rec.get("t")}
        bodies = rec.get("bodies", {})
        for body in BODY_KEYS:
            bd = bodies.get(body, {})
            row[f"lon_{body}"] = safe_float(bd.get("ecliptic_longitude_deg"))
            row[f"torque_{body}"] = safe_float(bd.get("torque_proxy"))
            row[f"angvel_{body}"] = safe_float(bd.get("angular_velocity_deg_per_day"))
            row[f"distance_au_{body}"] = safe_float(bd.get("distance_au"))
            row[f"radial_velocity_{body}"] = safe_float(bd.get("radial_velocity_km_s"))
        rows.append(row)

    df = pd.DataFrame(rows)
    if df.empty:
        raise ValueError(f"No ephemeris records found in {path}")

    df["t"] = pd.to_datetime(df["t"], errors="coerce")
    df = df.dropna(subset=["t"]).sort_values("t").drop_duplicates("t")
    return df


def load_ephemeris_from_partitions(data_dir: Path, start: Optional[str], end: Optional[str]) -> Optional[pd.DataFrame]:
    manifest_path = data_dir / "ephemeris_historic.manifest.json"
    if not manifest_path.exists():
        return None

    manifest = read_json(manifest_path)
    partition_dir = data_dir / manifest.get("partition_dir", "ephemeris_by_year")
    if not partition_dir.exists():
        return None

    if start:
        start_year = pd.Timestamp(start).year
    else:
        start_year = int(min(manifest.get("years", ["1900"])))

    if end:
        end_year = pd.Timestamp(end).year
    else:
        end_year = int(max(manifest.get("years", ["2100"])))

    rows: List[pd.DataFrame] = []
    for year in range(start_year, end_year + 1):
        candidates = [
            partition_dir / f"{year}.json",
            partition_dir / f"ephemeris_{year}.json",
            partition_dir / f"{year}.records.json",
        ]
        path = next((p for p in candidates if p.exists()), None)
        if path is None:
            continue

        payload = read_json(path)
        if isinstance(payload, dict) and "records" in payload:
            tmp_path_payload = {"records": payload["records"]}
        elif isinstance(payload, list):
            tmp_path_payload = {"records": payload}
        else:
            continue

        temp_rows: List[Dict[str, Any]] = []
        for rec in tmp_path_payload["records"]:
            row: Dict[str, Any] = {"t": rec.get("t")}
            bodies = rec.get("bodies", {})
            for body in BODY_KEYS:
                bd = bodies.get(body, {})
                row[f"lon_{body}"] = safe_float(bd.get("ecliptic_longitude_deg"))
                row[f"torque_{body}"] = safe_float(bd.get("torque_proxy"))
                row[f"angvel_{body}"] = safe_float(bd.get("angular_velocity_deg_per_day"))
                row[f"distance_au_{body}"] = safe_float(bd.get("distance_au"))
                row[f"radial_velocity_{body}"] = safe_float(bd.get("radial_velocity_km_s"))
            temp_rows.append(row)

        if temp_rows:
            rows.append(pd.DataFrame(temp_rows))

    if not rows:
        return None

    df = pd.concat(rows, ignore_index=True)
    df["t"] = pd.to_datetime(df["t"], errors="coerce")
    df = df.dropna(subset=["t"]).sort_values("t").drop_duplicates("t")
    return df


def load_ephemeris(data_dir: Path, start: Optional[str], end: Optional[str]) -> pd.DataFrame:
    partitioned = load_ephemeris_from_partitions(data_dir, start, end)
    if partitioned is not None and not partitioned.empty:
        return partitioned

    monolith = data_dir / "ephemeris_historic.json"
    if monolith.exists():
        return load_ephemeris_from_monolith(monolith)

    raise FileNotFoundError(
        f"No usable ephemeris cache found. Expected {monolith} or partition manifest."
    )


def compute_angular_separations(ephem: pd.DataFrame) -> pd.DataFrame:
    df = ephem.copy()

    for a, b in DEFAULT_SEPARATION_PAIRS:
        ca = f"lon_{a}"
        cb = f"lon_{b}"
        if ca in df.columns and cb in df.columns:
            df[f"sep_{a}_{b}"] = circular_abs_separation_deg(df[ca], df[cb])
            df[f"signed_sep_{a}_{b}"] = signed_circular_delta_deg(df[ca], df[cb])

    return df


def load_markers(data_dir: Path) -> pd.DataFrame:
    path = data_dir / "markers.json"
    if not path.exists():
        return pd.DataFrame(columns=["date", "emoji", "label"])

    payload = read_json(path)
    records = payload.get("chartMarkers", [])
    if not records:
        return pd.DataFrame(columns=["date", "emoji", "label"])

    df = pd.DataFrame(records)
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df = df.dropna(subset=["date"]).copy()
    df["emoji"] = df.get("emoji", "").fillna("")
    df["label"] = df.get("label", "").fillna("")
    df["marker_name"] = (
        df["emoji"].astype(str).str.strip()
        + " "
        + df["label"].astype(str).str.strip()
    ).str.strip()
    return df.sort_values("date")


def restrict_dates(df: pd.DataFrame, start: Optional[str], end: Optional[str]) -> pd.DataFrame:
    out = df.copy()
    if start:
        out = out[out["t"] >= pd.Timestamp(start)]
    if end:
        out = out[out["t"] <= pd.Timestamp(end)]
    return out


def robust_zscore(series: pd.Series, window: int, min_periods: int) -> pd.Series:
    x = pd.to_numeric(series, errors="coerce")
    med = x.rolling(window=window, center=True, min_periods=min_periods).median()
    mad = (x - med).abs().rolling(window=window, center=True, min_periods=min_periods).median()
    z = 0.6745 * (x - med) / mad.replace(0, np.nan)
    return z.replace([np.inf, -np.inf], np.nan)


def minmax_row(series: pd.Series) -> pd.Series:
    x = pd.to_numeric(series, errors="coerce")
    mn = np.nanmin(x.values)
    mx = np.nanmax(x.values)
    if not np.isfinite(mn) or not np.isfinite(mx) or math.isclose(mx, mn):
        return pd.Series(np.zeros(len(x)), index=x.index)
    return 2.0 * ((x - mn) / (mx - mn)) - 1.0


def build_comparison_frame(eop_diag: pd.DataFrame, ephem_sep: pd.DataFrame) -> pd.DataFrame:
    merged = pd.merge(eop_diag, ephem_sep, on="t", how="inner")
    merged = merged.sort_values("t").drop_duplicates("t").reset_index(drop=True)
    return merged


def choose_overlay_columns(df: pd.DataFrame) -> List[str]:
    return [c for c in DEFAULT_OVERLAY_COLUMNS if c in df.columns and df[c].notna().any()]


def plot_overlay_matrix(
    df: pd.DataFrame,
    markers: pd.DataFrame,
    columns: Sequence[str],
    out_path: Path,
    title: str,
    smooth: int,
    z_window: int,
    min_periods: int,
) -> None:
    if not columns:
        raise ValueError("No overlay columns available for plotting.")

    plot_df = df[["t", *columns]].copy()

    matrix_rows = []
    row_labels = []

    for col in columns:
        s = plot_df[col]
        if smooth and smooth > 1:
            s = s.rolling(smooth, center=True, min_periods=max(3, smooth // 3)).mean()
        z = robust_zscore(s, window=z_window, min_periods=min_periods)
        if z.notna().sum() < 10:
            z = minmax_row(s)
        else:
            z = z.clip(-3, 3) / 3.0
        matrix_rows.append(z.values)
        row_labels.append(col)

    matrix = np.vstack(matrix_rows)

    fig_width = 18
    fig_height = max(7, 0.42 * len(columns) + 2.5)
    fig, ax = plt.subplots(figsize=(fig_width, fig_height))

    extent = [
        df["t"].iloc[0].toordinal(),
        df["t"].iloc[-1].toordinal(),
        0,
        len(columns),
    ]

    im = ax.imshow(
        matrix,
        aspect="auto",
        interpolation="nearest",
        origin="lower",
        extent=extent,
        vmin=-1,
        vmax=1,
        cmap="gray",
    )

    ax.set_yticks(np.arange(len(columns)) + 0.5)
    ax.set_yticklabels(row_labels)
    ax.set_xlabel("Date")
    ax.set_title(title)

    xticks = pd.date_range(df["t"].min(), df["t"].max(), periods=8)
    ax.set_xticks([x.toordinal() for x in xticks])
    ax.set_xticklabels([x.strftime("%Y-%m-%d") for x in xticks], rotation=30, ha="right")

    if not markers.empty:
        visible = markers[
            (markers["date"] >= df["t"].min())
            & (markers["date"] <= df["t"].max())
        ]
        for _, m in visible.iterrows():
            x = m["date"].toordinal()
            ax.axvline(x, linestyle=":", linewidth=1.0)
            label = m.get("marker_name", "")
            if label:
                ax.text(
                    x,
                    len(columns) + 0.15,
                    label,
                    rotation=0,
                    ha="center",
                    va="bottom",
                    fontsize=8,
                    clip_on=False,
                )

    cbar = fig.colorbar(im, ax=ax, pad=0.02)
    cbar.set_label("row-normalized value")

    fig.tight_layout()
    fig.savefig(out_path, dpi=180)
    plt.close(fig)


def summarize_marker_windows(
    df: pd.DataFrame,
    markers: pd.DataFrame,
    columns: Sequence[str],
    window_days: int,
) -> pd.DataFrame:
    rows: List[Dict[str, Any]] = []
    half = pd.Timedelta(days=window_days // 2)

    for _, m in markers.iterrows():
        center = m["date"]
        w = df[(df["t"] >= center - half) & (df["t"] <= center + half)].copy()
        if w.empty:
            continue

        row: Dict[str, Any] = {
            "marker_date": center.strftime("%Y-%m-%d"),
            "marker_name": m.get("marker_name", ""),
            "n_days": int(len(w)),
        }

        for col in columns:
            if col not in w.columns:
                continue
            s = pd.to_numeric(w[col], errors="coerce")
            row[f"{col}_mean"] = float(s.mean()) if s.notna().any() else np.nan
            row[f"{col}_min"] = float(s.min()) if s.notna().any() else np.nan
            row[f"{col}_max"] = float(s.max()) if s.notna().any() else np.nan

        rows.append(row)

    return pd.DataFrame(rows)


def plot_marker_windows(
    df: pd.DataFrame,
    markers: pd.DataFrame,
    columns: Sequence[str],
    out_dir: Path,
    window_days: int,
    smooth: int,
    z_window: int,
    min_periods: int,
) -> None:
    half = pd.Timedelta(days=window_days // 2)

    for _, m in markers.iterrows():
        center = m["date"]
        w = df[(df["t"] >= center - half) & (df["t"] <= center + half)].copy()
        if len(w) < 30:
            continue

        label = m.get("marker_name", "") or center.strftime("%Y-%m-%d")
        slug = slugify(f"{center.strftime('%Y-%m-%d')}_{label}")
        out_path = out_dir / f"marker_window_{slug}.png"

        title = f"DRIFT marker window: {label} ({center.strftime('%Y-%m-%d')})"
        plot_overlay_matrix(
            w,
            markers=pd.DataFrame([m]),
            columns=columns,
            out_path=out_path,
            title=title,
            smooth=smooth,
            z_window=min(z_window, max(60, len(w))),
            min_periods=min(min_periods, max(10, len(w) // 5)),
        )


def main() -> None:
    args = parse_args()

    data_dir = args.data_dir.resolve()
    out_dir = args.out_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"DRIFT data dir: {data_dir}")
    print(f"Output dir:     {out_dir}")

    eop = load_eop(data_dir, args.eop)
    eop_diag = compute_eop_diagnostics(eop)

    ephem = load_ephemeris(data_dir, args.start, args.end)
    ephem_sep = compute_angular_separations(ephem)

    comparison = build_comparison_frame(eop_diag, ephem_sep)
    comparison = restrict_dates(comparison, args.start, args.end)

    markers = load_markers(data_dir)
    if args.start:
        markers = markers[markers["date"] >= pd.Timestamp(args.start)]
    if args.end:
        markers = markers[markers["date"] <= pd.Timestamp(args.end)]

    overlay_columns = choose_overlay_columns(comparison)

    comparison_path = out_dir / "drift_comparison_timeseries.csv"
    separations_path = out_dir / "angular_separations.csv"
    marker_summary_path = out_dir / "marker_windows_summary.csv"
    overlay_path = out_dir / "overlay_matrix.png"

    comparison.to_csv(comparison_path, index=False)

    sep_cols = ["t"] + [c for c in comparison.columns if c.startswith("sep_") or c.startswith("signed_sep_")]
    comparison[sep_cols].to_csv(separations_path, index=False)

    marker_summary = summarize_marker_windows(
        comparison,
        markers,
        overlay_columns,
        window_days=args.window_days,
    )
    marker_summary.to_csv(marker_summary_path, index=False)

    date_span = f"{comparison['t'].min().strftime('%Y-%m-%d')} to {comparison['t'].max().strftime('%Y-%m-%d')}"
    source_eop = comparison["source_eop"].dropna().iloc[0] if "source_eop" in comparison.columns and comparison["source_eop"].notna().any() else "unknown"

    plot_overlay_matrix(
        comparison,
        markers,
        overlay_columns,
        overlay_path,
        title=f"DRIFT angular-separation / EOP comparison ({date_span}) | EOP: {source_eop}",
        smooth=args.smooth,
        z_window=args.z_window,
        min_periods=args.min_periods,
    )

    if not args.no_marker_plots:
        plot_marker_windows(
            comparison,
            markers,
            overlay_columns,
            out_dir,
            window_days=args.window_days,
            smooth=args.smooth,
            z_window=args.z_window,
            min_periods=args.min_periods,
        )

    print("\nComplete.")
    print(f"Rows:                  {len(comparison):,}")
    print(f"Overlay columns:       {len(overlay_columns)}")
    print(f"Markers in range:      {len(markers):,}")
    print(f"Timeseries CSV:        {comparison_path}")
    print(f"Separations CSV:       {separations_path}")
    print(f"Marker summary CSV:    {marker_summary_path}")
    print(f"Overlay matrix PNG:    {overlay_path}")


if __name__ == "__main__":
    main()