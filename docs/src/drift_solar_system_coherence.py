#!/usr/bin/env python3
"""
DRIFT Solar-System Coherence Analysis

Usage:
  python drift_solar_system_coherence.py --csv drift.csv --out outputs/solar_coherence

Outputs:
  - body_summary.csv
  - theta_sector_summary.csv
  - lag_summary.csv
  - multibody_summary.csv
  - figures/*.png

Purpose:
  Quantitatively test whether Earth-rotation phase-space diagnostics show
  state-conditioned coherence with solar-system torque proxies.

Author: Craig Stone / DRIFT workflow
"""

from __future__ import annotations

import argparse
import itertools
import math
import os
from pathlib import Path
from dataclasses import dataclass

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt


# ---------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------

BODIES = [
    "Mercury",
    "Venus",
    "Mars",
    "Jupiter",
    "Saturn",
    "Uranus",
    "Neptune",
    "Pluto",
    "Sun",
    "Moon",
]

OMEGA_COL = "ω (Angular Velocity) normalized"
THETA_COL = "θ (Phase) raw"
R_COL = "R(t) normalized"
DRIFT_COL = "Drift normalized"

DATE_COL = "date"

DEFAULT_HIGH_Q = 95.0
DEFAULT_R_Q = 95.0
DEFAULT_THETA_BINS = 12
DEFAULT_MAX_LAG = 180
DEFAULT_SURROGATES = 2000
RNG_SEED = 42


@dataclass
class BodyResult:
    body: str
    threshold_q: float
    proxy_threshold: float
    global_prob: float
    high_r_prob: float
    enrichment: float
    best_lag_days: int
    best_lag_prob: float
    best_lag_enrichment: float
    circular_shift_p: float
    n_high_proxy: int
    n_high_r: int
    n_joint: int


# ---------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------

def safe_col(df: pd.DataFrame, col: str) -> None:
    if col not in df.columns:
        raise KeyError(f"Required column not found: {col}")


def proxy_col(body: str) -> str:
    return f"{body} Torque Proxy normalized"


def ensure_dirs(out: Path) -> Path:
    out.mkdir(parents=True, exist_ok=True)
    figdir = out / "figures"
    figdir.mkdir(exist_ok=True)
    return figdir


def circular_shift_bool(mask: np.ndarray, shift: int) -> np.ndarray:
    return np.roll(mask, shift)


def circular_p_value(
    event_mask: np.ndarray,
    condition_mask: np.ndarray,
    observed_prob: float,
    n_surrogates: int,
    rng: np.random.Generator,
) -> float:
    """
    Circular-shift surrogate test.

    Preserves autocorrelation/seasonality structure in event_mask while
    breaking exact alignment with the condition mask.
    """
    n = len(event_mask)
    if n < 10:
        return np.nan

    probs = []
    for _ in range(n_surrogates):
        shift = int(rng.integers(1, n - 1))
        shifted = circular_shift_bool(event_mask, shift)
        denom = condition_mask.sum()
        if denom == 0:
            probs.append(np.nan)
        else:
            probs.append(np.mean(shifted[condition_mask]))

    probs = np.asarray(probs, dtype=float)
    probs = probs[np.isfinite(probs)]

    if len(probs) == 0:
        return np.nan

    # One-sided enrichment p-value
    return float((np.sum(probs >= observed_prob) + 1) / (len(probs) + 1))


def fdr_bh(pvals: np.ndarray) -> np.ndarray:
    """
    Benjamini-Hochberg FDR correction.
    """
    pvals = np.asarray(pvals, dtype=float)
    qvals = np.full_like(pvals, np.nan)

    valid = np.isfinite(pvals)
    pv = pvals[valid]

    if len(pv) == 0:
        return qvals

    order = np.argsort(pv)
    ranked = pv[order]
    m = len(ranked)

    q = ranked * m / (np.arange(m) + 1)
    q = np.minimum.accumulate(q[::-1])[::-1]
    q = np.clip(q, 0, 1)

    out = np.empty_like(q)
    out[order] = q

    qvals[valid] = out
    return qvals


def phase_to_degrees(theta: pd.Series) -> np.ndarray:
    """
    Accepts theta in radians or degrees.

    Heuristic:
      if absolute max <= 2π-ish, treat as radians.
      otherwise treat as degrees.
    """
    x = pd.to_numeric(theta, errors="coerce").to_numpy(dtype=float)
    finite = np.isfinite(x)

    if finite.sum() == 0:
        return x

    max_abs = np.nanmax(np.abs(x[finite]))

    if max_abs <= 2 * np.pi + 0.5:
        deg = np.degrees(x)
    else:
        deg = x

    # Wrap to [-180, 180)
    return ((deg + 180.0) % 360.0) - 180.0


def lagged_condition_probability(
    event_mask: np.ndarray,
    condition_mask: np.ndarray,
    max_lag: int,
) -> pd.DataFrame:
    """
    Tests whether event at t is associated with condition at t + lag.

    Positive lag means proxy event precedes later high-R/instability state.
    """
    rows = []
    base_prob = np.mean(event_mask)

    for lag in range(0, max_lag + 1):
        if lag == 0:
            ev = event_mask
            cond_future = condition_mask
        else:
            ev = event_mask[:-lag]
            cond_future = condition_mask[lag:]

        if ev.sum() == 0:
            prob = np.nan
        else:
            prob = np.mean(cond_future[ev])

        rows.append({
            "lag_days": lag,
            "prob_condition_after_event": prob,
            "global_event_probability": base_prob,
        })

    return pd.DataFrame(rows)


# ---------------------------------------------------------------------
# Core analysis
# ---------------------------------------------------------------------

def analyze_body(
    df: pd.DataFrame,
    body: str,
    high_q: float,
    r_q: float,
    max_lag: int,
    n_surrogates: int,
    rng: np.random.Generator,
) -> tuple[BodyResult, pd.DataFrame, pd.DataFrame]:

    col = proxy_col(body)
    safe_col(df, col)

    proxy = pd.to_numeric(df[col], errors="coerce").to_numpy(dtype=float)
    R = pd.to_numeric(df[R_COL], errors="coerce").to_numpy(dtype=float)

    valid = np.isfinite(proxy) & np.isfinite(R)

    proxy_thr = np.nanpercentile(proxy[valid], high_q)
    R_thr = np.nanpercentile(R[valid], r_q)

    event = np.zeros(len(df), dtype=bool)
    high_R = np.zeros(len(df), dtype=bool)

    event[valid] = proxy[valid] >= proxy_thr
    high_R[valid] = R[valid] >= R_thr

    global_prob = float(np.mean(event[valid]))
    high_r_prob = float(np.mean(event[high_R])) if high_R.sum() else np.nan
    enrichment = float(high_r_prob / global_prob) if global_prob > 0 else np.nan

    p = circular_p_value(event, high_R, high_r_prob, n_surrogates, rng)

    lag_df = lagged_condition_probability(event, high_R, max_lag=max_lag)
    lag_df["body"] = body

    # Best lag by enrichment relative to unconditional high-R probability
    baseline_high_r = float(np.mean(high_R[valid]))
    lag_df["lag_enrichment"] = lag_df["prob_condition_after_event"] / baseline_high_r

    best_idx = lag_df["lag_enrichment"].idxmax()
    best_lag_days = int(lag_df.loc[best_idx, "lag_days"])
    best_lag_prob = float(lag_df.loc[best_idx, "prob_condition_after_event"])
    best_lag_enrichment = float(lag_df.loc[best_idx, "lag_enrichment"])

    theta_sector_df = theta_sector_analysis(df, body, event, high_R)

    result = BodyResult(
        body=body,
        threshold_q=high_q,
        proxy_threshold=float(proxy_thr),
        global_prob=global_prob,
        high_r_prob=high_r_prob,
        enrichment=enrichment,
        best_lag_days=best_lag_days,
        best_lag_prob=best_lag_prob,
        best_lag_enrichment=best_lag_enrichment,
        circular_shift_p=p,
        n_high_proxy=int(event.sum()),
        n_high_r=int(high_R.sum()),
        n_joint=int((event & high_R).sum()),
    )

    return result, lag_df, theta_sector_df


def theta_sector_analysis(
    df: pd.DataFrame,
    body: str,
    event: np.ndarray,
    high_R: np.ndarray,
) -> pd.DataFrame:

    theta_deg = phase_to_degrees(df[THETA_COL])
    valid = np.isfinite(theta_deg)

    bins = np.linspace(-180, 180, DEFAULT_THETA_BINS + 1)
    labels = [
        f"{int(bins[i])} to {int(bins[i+1])}"
        for i in range(len(bins) - 1)
    ]

    sector = pd.cut(theta_deg, bins=bins, labels=labels, include_lowest=True)

    rows = []
    global_prob = np.mean(event[valid])

    for lab in labels:
        mask = valid & (sector.astype(str) == lab)
        boundary = mask & high_R

        sector_prob = np.mean(event[mask]) if mask.sum() else np.nan
        boundary_prob = np.mean(event[boundary]) if boundary.sum() else np.nan
        enrichment = boundary_prob / global_prob if global_prob > 0 else np.nan

        rows.append({
            "body": body,
            "theta_sector_deg": lab,
            "n_sector": int(mask.sum()),
            "n_high_R_sector": int(boundary.sum()),
            "event_prob_sector": sector_prob,
            "event_prob_high_R_sector": boundary_prob,
            "enrichment_high_R_sector": enrichment,
            "n_joint_high_R_event_sector": int((boundary & event).sum()),
        })

    return pd.DataFrame(rows)


def analyze_multibody(
    df: pd.DataFrame,
    bodies: list[str],
    high_q: float,
    r_q: float,
    n_surrogates: int,
    rng: np.random.Generator,
    max_combo_size: int = 3,
) -> pd.DataFrame:

    R = pd.to_numeric(df[R_COL], errors="coerce").to_numpy(dtype=float)
    valid_R = np.isfinite(R)
    R_thr = np.nanpercentile(R[valid_R], r_q)
    high_R = np.zeros(len(df), dtype=bool)
    high_R[valid_R] = R[valid_R] >= R_thr

    body_events = {}

    for body in bodies:
        col = proxy_col(body)
        if col not in df.columns:
            continue

        proxy = pd.to_numeric(df[col], errors="coerce").to_numpy(dtype=float)
        valid = np.isfinite(proxy)
        thr = np.nanpercentile(proxy[valid], high_q)

        ev = np.zeros(len(df), dtype=bool)
        ev[valid] = proxy[valid] >= thr

        body_events[body] = ev

    rows = []

    for k in range(2, max_combo_size + 1):
        for combo in itertools.combinations(body_events.keys(), k):
            masks = [body_events[b] for b in combo]

            either = np.logical_or.reduce(masks)
            all_overlap = np.logical_and.reduce(masks)
            product_like = np.sum(np.vstack(masks), axis=0) >= 2

            for mode_name, event in [
                ("either", either),
                ("all_overlap", all_overlap),
                ("at_least_two", product_like),
            ]:
                if event.sum() == 0:
                    continue

                global_prob = float(np.mean(event))
                high_r_prob = float(np.mean(event[high_R])) if high_R.sum() else np.nan
                enrichment = high_r_prob / global_prob if global_prob > 0 else np.nan
                p = circular_p_value(event, high_R, high_r_prob, n_surrogates, rng)

                rows.append({
                    "combo": "+".join(combo),
                    "mode": mode_name,
                    "combo_size": k,
                    "global_prob": global_prob,
                    "high_R_prob": high_r_prob,
                    "enrichment": enrichment,
                    "circular_shift_p": p,
                    "n_event": int(event.sum()),
                    "n_high_R": int(high_R.sum()),
                    "n_joint": int((event & high_R).sum()),
                })

    out = pd.DataFrame(rows)

    if len(out):
        out["fdr_q"] = fdr_bh(out["circular_shift_p"].to_numpy())

    return out.sort_values(
        ["fdr_q", "enrichment"],
        ascending=[True, False],
        na_position="last",
    )


# ---------------------------------------------------------------------
# Figures
# ---------------------------------------------------------------------

def plot_body_summary(summary: pd.DataFrame, figdir: Path) -> None:
    s = summary.sort_values("enrichment", ascending=False)

    plt.figure(figsize=(12, 6))
    plt.bar(s["body"], s["enrichment"])
    plt.axhline(1.0, linestyle="--", linewidth=1)
    plt.ylabel("High-R enrichment")
    plt.xlabel("Body")
    plt.title("DRIFT state-conditioned torque-proxy enrichment by body")
    plt.xticks(rotation=45, ha="right")
    plt.tight_layout()
    plt.savefig(figdir / "body_enrichment.png", dpi=200)
    plt.close()

    plt.figure(figsize=(12, 6))
    plt.bar(s["body"], -np.log10(s["circular_shift_p"].clip(lower=1e-12)))
    plt.ylabel("-log10 circular-shift p")
    plt.xlabel("Body")
    plt.title("Surrogate significance by body")
    plt.xticks(rotation=45, ha="right")
    plt.tight_layout()
    plt.savefig(figdir / "body_surrogate_significance.png", dpi=200)
    plt.close()


def plot_lag_curves(lag_all: pd.DataFrame, figdir: Path) -> None:
    for body, g in lag_all.groupby("body"):
        plt.figure(figsize=(10, 5))
        plt.plot(g["lag_days"], g["lag_enrichment"])
        plt.axhline(1.0, linestyle="--", linewidth=1)
        plt.xlabel("Lag in days: proxy event at t, high-R at t + lag")
        plt.ylabel("Lagged enrichment")
        plt.title(f"{body}: lagged high-R probability after proxy event")
        plt.tight_layout()
        plt.savefig(figdir / f"lag_curve_{body.lower()}.png", dpi=200)
        plt.close()


def plot_theta_heatmap(theta_all: pd.DataFrame, figdir: Path) -> None:
    pivot = theta_all.pivot_table(
        index="body",
        columns="theta_sector_deg",
        values="enrichment_high_R_sector",
        aggfunc="mean",
    )

    plt.figure(figsize=(14, 7))
    plt.imshow(pivot.to_numpy(dtype=float), aspect="auto")
    plt.colorbar(label="High-R sector enrichment")
    plt.yticks(range(len(pivot.index)), pivot.index)
    plt.xticks(range(len(pivot.columns)), pivot.columns, rotation=45, ha="right")
    plt.title("Phase-space localization of torque-proxy enrichment")
    plt.tight_layout()
    plt.savefig(figdir / "theta_sector_enrichment_heatmap.png", dpi=200)
    plt.close()


def plot_multibody(multibody: pd.DataFrame, figdir: Path, top_n: int = 20) -> None:
    if len(multibody) == 0:
        return

    s = multibody.head(top_n).copy()
    labels = s["combo"] + " / " + s["mode"]

    plt.figure(figsize=(14, 7))
    plt.bar(labels, s["enrichment"])
    plt.axhline(1.0, linestyle="--", linewidth=1)
    plt.ylabel("High-R enrichment")
    plt.xlabel("Combination")
    plt.title("Top multibody state-conditioned enrichments")
    plt.xticks(rotation=70, ha="right")
    plt.tight_layout()
    plt.savefig(figdir / "top_multibody_enrichment.png", dpi=200)
    plt.close()


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", required=True, help="Input DRIFT CSV")
    parser.add_argument("--out", default="outputs/solar_coherence", help="Output directory")
    parser.add_argument("--high-q", type=float, default=DEFAULT_HIGH_Q,
                        help="Percentile threshold for high torque proxy")
    parser.add_argument("--r-q", type=float, default=DEFAULT_R_Q,
                        help="Percentile threshold for high R(t)")
    parser.add_argument("--max-lag", type=int, default=DEFAULT_MAX_LAG,
                        help="Maximum lag in days")
    parser.add_argument("--surrogates", type=int, default=DEFAULT_SURROGATES,
                        help="Number of circular-shift surrogates")
    parser.add_argument("--max-combo-size", type=int, default=3,
                        help="Maximum multibody combination size")
    args = parser.parse_args()

    out = Path(args.out)
    figdir = ensure_dirs(out)

    rng = np.random.default_rng(RNG_SEED)

    df = pd.read_csv(args.csv)
    df[DATE_COL] = pd.to_datetime(df[DATE_COL], errors="coerce")

    required = [DATE_COL, OMEGA_COL, THETA_COL, R_COL, DRIFT_COL]
    for col in required:
        safe_col(df, col)

    available_bodies = [b for b in BODIES if proxy_col(b) in df.columns]

    if not available_bodies:
        raise RuntimeError("No torque proxy columns found.")

    print(f"Loaded {len(df):,} rows")
    print(f"Available bodies: {', '.join(available_bodies)}")

    body_results = []
    lag_frames = []
    theta_frames = []

    for body in available_bodies:
        print(f"Analyzing {body}...")
        result, lag_df, theta_df = analyze_body(
            df=df,
            body=body,
            high_q=args.high_q,
            r_q=args.r_q,
            max_lag=args.max_lag,
            n_surrogates=args.surrogates,
            rng=rng,
        )
        body_results.append(result.__dict__)
        lag_frames.append(lag_df)
        theta_frames.append(theta_df)

    summary = pd.DataFrame(body_results)
    summary["fdr_q"] = fdr_bh(summary["circular_shift_p"].to_numpy())
    summary = summary.sort_values(
        ["fdr_q", "enrichment"],
        ascending=[True, False],
        na_position="last",
    )

    lag_all = pd.concat(lag_frames, ignore_index=True)
    theta_all = pd.concat(theta_frames, ignore_index=True)

    multibody = analyze_multibody(
        df=df,
        bodies=available_bodies,
        high_q=args.high_q,
        r_q=args.r_q,
        n_surrogates=args.surrogates,
        rng=rng,
        max_combo_size=args.max_combo_size,
    )

    summary.to_csv(out / "body_summary.csv", index=False)
    lag_all.to_csv(out / "lag_summary.csv", index=False)
    theta_all.to_csv(out / "theta_sector_summary.csv", index=False)
    multibody.to_csv(out / "multibody_summary.csv", index=False)

    plot_body_summary(summary, figdir)
    plot_lag_curves(lag_all, figdir)
    plot_theta_heatmap(theta_all, figdir)
    plot_multibody(multibody, figdir)

    print("\n=== BODY SUMMARY ===")
    print(summary.to_string(index=False))

    if len(multibody):
        print("\n=== TOP MULTIBODY RESULTS ===")
        print(multibody.head(20).to_string(index=False))

    print(f"\nOutputs written to: {out.resolve()}")


if __name__ == "__main__":
    main()