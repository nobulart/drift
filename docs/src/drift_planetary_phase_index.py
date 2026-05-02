#!/usr/bin/env python3
"""
DRIFT Planetary Phase Index Analysis

Builds analytic phase fields from normalized solar-system torque proxies,
constructs weighted composite planetary phase indices, and tests whether
high-R DRIFT instability states are phase-selectively organized.

Usage:
  python drift_planetary_phase_index.py --csv drift.csv --out outputs/planetary_phase_index
"""

from __future__ import annotations

import argparse
from pathlib import Path
import itertools

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy.signal import hilbert, savgol_filter
from scipy.stats import circmean


DATE_COL = "date"
R_COL = "R(t) normalized"
THETA_COL = "θ (Phase) raw"
OMEGA_COL = "ω (Angular Velocity) normalized"

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

DEFAULT_R_Q = 95.0
DEFAULT_SMOOTH_DAYS = 31
DEFAULT_SURROGATES = 2000
DEFAULT_MAX_LAG = 240
RNG_SEED = 42


def proxy_col(body: str) -> str:
    return f"{body} Torque Proxy normalized"


def ensure_dirs(out: Path) -> Path:
    out.mkdir(parents=True, exist_ok=True)
    figdir = out / "figures"
    figdir.mkdir(exist_ok=True)
    return figdir


def wrap_phase(x: np.ndarray) -> np.ndarray:
    return (x + np.pi) % (2 * np.pi) - np.pi


def phase_to_degrees(theta: pd.Series) -> np.ndarray:
    x = pd.to_numeric(theta, errors="coerce").to_numpy(dtype=float)
    finite = np.isfinite(x)
    if finite.sum() == 0:
        return x
    if np.nanmax(np.abs(x[finite])) <= 2 * np.pi + 0.5:
        deg = np.degrees(x)
    else:
        deg = x
    return ((deg + 180.0) % 360.0) - 180.0


def analytic_phase(x: np.ndarray, smooth_days: int) -> np.ndarray:
    """
    Smooths a proxy and returns Hilbert analytic phase.
    """
    x = np.asarray(x, dtype=float)
    good = np.isfinite(x)

    if good.sum() < 20:
        return np.full_like(x, np.nan)

    y = x.copy()
    y[~good] = np.nanmedian(y[good])

    if smooth_days and smooth_days >= 5:
        win = int(smooth_days)
        if win % 2 == 0:
            win += 1
        win = min(win, len(y) - 1 if (len(y) - 1) % 2 == 1 else len(y) - 2)
        if win >= 5:
            y = savgol_filter(y, window_length=win, polyorder=3, mode="interp")

    y = y - np.nanmean(y)
    z = hilbert(y)
    return wrap_phase(np.angle(z))


def phase_locking_value(phi_a: np.ndarray, phi_b: np.ndarray, mask: np.ndarray) -> float:
    valid = np.isfinite(phi_a) & np.isfinite(phi_b) & mask
    if valid.sum() < 5:
        return np.nan
    return float(np.abs(np.mean(np.exp(1j * wrap_phase(phi_a[valid] - phi_b[valid])))))


def circular_p_value_plv(
    phi_a: np.ndarray,
    phi_b: np.ndarray,
    mask: np.ndarray,
    observed: float,
    n_surrogates: int,
    rng: np.random.Generator,
) -> float:
    n = len(phi_b)
    vals = []
    for _ in range(n_surrogates):
        shift = int(rng.integers(1, n - 1))
        shifted = np.roll(phi_b, shift)
        vals.append(phase_locking_value(phi_a, shifted, mask))
    vals = np.asarray(vals, dtype=float)
    vals = vals[np.isfinite(vals)]
    if len(vals) == 0:
        return np.nan
    return float((np.sum(vals >= observed) + 1) / (len(vals) + 1))


def composite_phase(phase_map: dict[str, np.ndarray], weights: dict[str, float]) -> np.ndarray:
    """
    Weighted circular mean phase.
    """
    names = list(weights.keys())
    n = len(next(iter(phase_map.values())))
    z = np.zeros(n, dtype=complex)

    total_w = 0.0
    for name in names:
        w = float(weights[name])
        z += w * np.exp(1j * phase_map[name])
        total_w += abs(w)

    if total_w == 0:
        return np.full(n, np.nan)

    return wrap_phase(np.angle(z))


def lagged_plv(phi_earth: np.ndarray, phi_body: np.ndarray, mask: np.ndarray, max_lag: int) -> pd.DataFrame:
    rows = []
    for lag in range(0, max_lag + 1):
        if lag == 0:
            a = phi_earth
            b = phi_body
            m = mask
        else:
            a = phi_earth[lag:]
            b = phi_body[:-lag]
            m = mask[lag:]
        rows.append({
            "lag_days": lag,
            "plv": phase_locking_value(a, b, m),
        })
    return pd.DataFrame(rows)


def fdr_bh(pvals: np.ndarray) -> np.ndarray:
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


def build_named_composites(available: list[str]) -> dict[str, dict[str, float]]:
    composites: dict[str, dict[str, float]] = {}

    candidate_sets = {
        "inner_planets": ["Mercury", "Venus", "Mars"],
        "venus_mars": ["Venus", "Mars"],
        "venus_mars_jupiter": ["Venus", "Mars", "Jupiter"],
        "jupiter_outer": ["Jupiter", "Saturn", "Uranus", "Neptune"],
        "gas_giants": ["Jupiter", "Saturn"],
        "sun_moon": ["Sun", "Moon"],
        "all_classical": ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"],
        "all_major": ["Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Sun", "Moon"],
    }

    for name, bodies in candidate_sets.items():
        bodies = [b for b in bodies if b in available]
        if len(bodies) >= 2:
            composites[name] = {b: 1.0 for b in bodies}

    for k in (2, 3):
        for combo in itertools.combinations(available, k):
            name = "combo_" + "_".join(combo)
            composites[name] = {b: 1.0 for b in combo}

    return composites


def plot_plv_summary(summary: pd.DataFrame, figdir: Path) -> None:
    s = summary.sort_values("high_R_plv", ascending=False).head(25)

    plt.figure(figsize=(14, 7))
    plt.bar(s["signal"], s["high_R_plv"])
    plt.ylabel("PLV during high-R states")
    plt.xlabel("Signal")
    plt.title("Planetary analytic-phase coherence with DRIFT phase during high-R states")
    plt.xticks(rotation=70, ha="right")
    plt.tight_layout()
    plt.savefig(figdir / "high_R_PLV_summary.png", dpi=200)
    plt.close()

    plt.figure(figsize=(14, 7))
    plt.bar(s["signal"], -np.log10(s["p_circular"].clip(lower=1e-12)))
    plt.ylabel("-log10 circular-shift p")
    plt.xlabel("Signal")
    plt.title("Circular-shift significance of high-R phase locking")
    plt.xticks(rotation=70, ha="right")
    plt.tight_layout()
    plt.savefig(figdir / "high_R_PLV_significance.png", dpi=200)
    plt.close()


def plot_phase_histograms(df_phase: pd.DataFrame, figdir: Path, top_signals: list[str]) -> None:
    for sig in top_signals:
        col = f"{sig}_phase"
        if col not in df_phase.columns:
            continue

        phase = df_phase[col].to_numpy(dtype=float)
        high_R = df_phase["high_R"].to_numpy(dtype=bool)

        plt.figure(figsize=(9, 5))
        plt.hist(phase[~high_R], bins=36, alpha=0.5, density=True, label="non-high-R")
        plt.hist(phase[high_R], bins=36, alpha=0.7, density=True, label="high-R")
        plt.xlabel("Analytic phase, radians")
        plt.ylabel("Density")
        plt.title(f"{sig}: phase distribution during high-R vs background")
        plt.legend()
        plt.tight_layout()
        plt.savefig(figdir / f"phase_hist_{sig}.png", dpi=200)
        plt.close()


def plot_lag_curves(lag_all: pd.DataFrame, figdir: Path, top_signals: list[str]) -> None:
    for sig in top_signals:
        g = lag_all[lag_all["signal"] == sig]
        if len(g) == 0:
            continue
        plt.figure(figsize=(10, 5))
        plt.plot(g["lag_days"], g["plv"])
        plt.xlabel("Lag days: planetary phase at t, DRIFT phase at t + lag")
        plt.ylabel("PLV")
        plt.title(f"{sig}: lagged phase locking into high-R DRIFT states")
        plt.tight_layout()
        plt.savefig(figdir / f"lagged_PLV_{sig}.png", dpi=200)
        plt.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", required=True)
    parser.add_argument("--out", default="outputs/planetary_phase_index")
    parser.add_argument("--r-q", type=float, default=DEFAULT_R_Q)
    parser.add_argument("--smooth-days", type=int, default=DEFAULT_SMOOTH_DAYS)
    parser.add_argument("--surrogates", type=int, default=DEFAULT_SURROGATES)
    parser.add_argument("--max-lag", type=int, default=DEFAULT_MAX_LAG)
    args = parser.parse_args()

    out = Path(args.out)
    figdir = ensure_dirs(out)
    rng = np.random.default_rng(RNG_SEED)

    df = pd.read_csv(args.csv)
    df[DATE_COL] = pd.to_datetime(df[DATE_COL], errors="coerce")

    for col in [DATE_COL, R_COL, THETA_COL, OMEGA_COL]:
        if col not in df.columns:
            raise KeyError(f"Missing required column: {col}")

    R = pd.to_numeric(df[R_COL], errors="coerce").to_numpy(dtype=float)
    theta_deg = phase_to_degrees(df[THETA_COL])
    theta_rad = np.radians(theta_deg)

    R_thr = np.nanpercentile(R[np.isfinite(R)], args.r_q)
    high_R = np.isfinite(R) & (R >= R_thr)

    available = [b for b in BODIES if proxy_col(b) in df.columns]
    print(f"Available bodies: {', '.join(available)}")
    print(f"High-R threshold q={args.r_q}: {R_thr:.6g}")
    print(f"High-R days: {high_R.sum()} / {len(high_R)}")

    phase_map: dict[str, np.ndarray] = {}
    df_phase = pd.DataFrame({
        "date": df[DATE_COL],
        "theta_rad": theta_rad,
        "theta_deg": theta_deg,
        "R": R,
        "high_R": high_R,
    })

    for body in available:
        x = pd.to_numeric(df[proxy_col(body)], errors="coerce").to_numpy(dtype=float)
        ph = analytic_phase(x, smooth_days=args.smooth_days)
        phase_map[body] = ph
        df_phase[f"{body}_phase"] = ph

    composites = build_named_composites(available)

    for name, weights in composites.items():
        ph = composite_phase(phase_map, weights)
        phase_map[name] = ph
        df_phase[f"{name}_phase"] = ph

    signals = available + list(composites.keys())

    rows = []
    lag_frames = []

    for sig in signals:
        ph = phase_map[sig]

        global_plv = phase_locking_value(theta_rad, ph, np.isfinite(R))
        high_plv = phase_locking_value(theta_rad, ph, high_R)
        low_plv = phase_locking_value(theta_rad, ph, ~high_R & np.isfinite(R))

        p = circular_p_value_plv(
            theta_rad,
            ph,
            high_R,
            high_plv,
            n_surrogates=args.surrogates,
            rng=rng,
        )

        lag_df = lagged_plv(theta_rad, ph, high_R, args.max_lag)
        lag_df["signal"] = sig
        best_idx = lag_df["plv"].idxmax()
        best_lag = int(lag_df.loc[best_idx, "lag_days"])
        best_lag_plv = float(lag_df.loc[best_idx, "plv"])
        lag_frames.append(lag_df)

        rows.append({
            "signal": sig,
            "global_plv": global_plv,
            "high_R_plv": high_plv,
            "non_high_R_plv": low_plv,
            "high_minus_background": high_plv - low_plv,
            "best_lag_days": best_lag,
            "best_lag_plv": best_lag_plv,
            "p_circular": p,
        })

    summary = pd.DataFrame(rows)
    summary["fdr_q"] = fdr_bh(summary["p_circular"].to_numpy())
    summary = summary.sort_values(["fdr_q", "high_R_plv"], ascending=[True, False])

    lag_all = pd.concat(lag_frames, ignore_index=True)

    summary.to_csv(out / "planetary_phase_summary.csv", index=False)
    lag_all.to_csv(out / "planetary_phase_lag_summary.csv", index=False)
    df_phase.to_csv(out / "planetary_phase_timeseries.csv", index=False)

    top_signals = summary.head(10)["signal"].tolist()

    plot_plv_summary(summary, figdir)
    plot_phase_histograms(df_phase, figdir, top_signals[:6])
    plot_lag_curves(lag_all, figdir, top_signals[:6])

    print("\n=== PLANETARY PHASE SUMMARY ===")
    print(summary.head(40).to_string(index=False))

    print(f"\nOutputs written to: {out.resolve()}")


if __name__ == "__main__":
    main()