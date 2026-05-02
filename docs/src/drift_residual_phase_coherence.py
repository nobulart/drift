#!/usr/bin/env python3
"""
DRIFT Residual Phase Coherence Analysis

Purpose:
  Remove the dominant solar/annual analytic phase from DRIFT phase θ(t),
  then retest whether non-solar planetary torque phases retain coherence
  with high-R instability states.

Usage:
  python drift_residual_phase_coherence.py \
    --csv drift.csv \
    --out outputs/residual_phase_coherence
"""

from __future__ import annotations

import argparse
import itertools
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy.signal import hilbert, savgol_filter


DATE_COL = "date"
THETA_COL = "θ (Phase) raw"
R_COL = "R(t) normalized"

BODIES = [
    "Mercury",
    "Venus",
    "Mars",
    "Jupiter",
    "Saturn",
    "Uranus",
    "Neptune",
    "Pluto",
    "Moon",
]

SUN = "Sun"

DEFAULT_R_Q = 95.0
DEFAULT_SMOOTH_DAYS = 31
DEFAULT_SURROGATES = 3000
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
    return (x + np.pi) % (2.0 * np.pi) - np.pi


def phase_to_radians(theta: pd.Series) -> np.ndarray:
    x = pd.to_numeric(theta, errors="coerce").to_numpy(dtype=float)
    finite = np.isfinite(x)

    if finite.sum() == 0:
        return x

    if np.nanmax(np.abs(x[finite])) <= 2.0 * np.pi + 0.5:
        rad = x
    else:
        rad = np.radians(x)

    return wrap_phase(rad)


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
    z = hilbert(y)

    return wrap_phase(np.angle(z))


def phase_locking_value(a: np.ndarray, b: np.ndarray, mask: np.ndarray) -> float:
    valid = np.isfinite(a) & np.isfinite(b) & mask

    if valid.sum() < 10:
        return np.nan

    return float(np.abs(np.mean(np.exp(1j * wrap_phase(a[valid] - b[valid])))))


def circular_shift_p(
    a: np.ndarray,
    b: np.ndarray,
    mask: np.ndarray,
    observed: float,
    n_surrogates: int,
    rng: np.random.Generator,
) -> float:
    n = len(b)
    vals = []

    for _ in range(n_surrogates):
        shift = int(rng.integers(1, n - 1))
        bs = np.roll(b, shift)
        vals.append(phase_locking_value(a, bs, mask))

    vals = np.asarray(vals, dtype=float)
    vals = vals[np.isfinite(vals)]

    if len(vals) == 0:
        return np.nan

    return float((np.sum(vals >= observed) + 1) / (len(vals) + 1))


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


def residualize_against_sun(theta: np.ndarray, sun_phase: np.ndarray) -> np.ndarray:
    """
    Circular residual:
      θ_res = angle(exp(iθ) / exp(iφ_sun))
            = wrap(θ - φ_sun)

    This removes the direct solar/annual phase scaffold.
    """
    return wrap_phase(theta - sun_phase)


def composite_phase(phase_map: dict[str, np.ndarray], bodies: tuple[str, ...]) -> np.ndarray:
    z = np.zeros(len(next(iter(phase_map.values()))), dtype=complex)

    for b in bodies:
        z += np.exp(1j * phase_map[b])

    return wrap_phase(np.angle(z))


def lagged_plv(a: np.ndarray, b: np.ndarray, mask: np.ndarray, max_lag: int) -> pd.DataFrame:
    rows = []

    for lag in range(0, max_lag + 1):
        if lag == 0:
            aa = a
            bb = b
            mm = mask
        else:
            aa = a[lag:]
            bb = b[:-lag]
            mm = mask[lag:]

        rows.append({
            "lag_days": lag,
            "plv": phase_locking_value(aa, bb, mm),
        })

    return pd.DataFrame(rows)


def build_signals(phase_map: dict[str, np.ndarray], available: list[str]) -> dict[str, np.ndarray]:
    signals = {}

    for b in available:
        signals[b] = phase_map[b]

    named = {
        "venus_mars": ("Venus", "Mars"),
        "venus_mars_jupiter": ("Venus", "Mars", "Jupiter"),
        "inner_planets": ("Mercury", "Venus", "Mars"),
        "jupiter_neptune": ("Jupiter", "Neptune"),
        "jupiter_moon": ("Jupiter", "Moon"),
        "mars_jupiter": ("Mars", "Jupiter"),
        "venus_jupiter": ("Venus", "Jupiter"),
        "all_non_solar": tuple(available),
    }

    for name, combo in named.items():
        combo = tuple(b for b in combo if b in available)
        if len(combo) >= 2:
            signals[name] = composite_phase(phase_map, combo)

    for k in (2, 3):
        for combo in itertools.combinations(available, k):
            name = "combo_" + "_".join(combo)
            signals[name] = composite_phase(phase_map, combo)

    return signals


def plot_before_after(summary: pd.DataFrame, figdir: Path) -> None:
    s = summary.sort_values("residual_high_R_plv", ascending=False).head(30)

    labels = s["signal"].to_numpy()
    x = np.arange(len(labels))
    width = 0.4

    plt.figure(figsize=(16, 7))
    plt.bar(x - width / 2, s["raw_high_R_plv"], width, label="raw θ")
    plt.bar(x + width / 2, s["residual_high_R_plv"], width, label="θ minus solar phase")
    plt.ylabel("High-R PLV")
    plt.xlabel("Signal")
    plt.title("Before/after solar-phase removal")
    plt.xticks(x, labels, rotation=70, ha="right")
    plt.legend()
    plt.tight_layout()
    plt.savefig(figdir / "before_after_solar_removal_PLV.png", dpi=200)
    plt.close()


def plot_residual_significance(summary: pd.DataFrame, figdir: Path) -> None:
    s = summary.sort_values("residual_p", ascending=True).head(30)

    plt.figure(figsize=(16, 7))
    plt.bar(s["signal"], -np.log10(s["residual_p"].clip(lower=1e-12)))
    plt.ylabel("-log10 circular-shift p")
    plt.xlabel("Signal")
    plt.title("Residual phase coherence significance after solar-phase removal")
    plt.xticks(rotation=70, ha="right")
    plt.tight_layout()
    plt.savefig(figdir / "residual_phase_significance.png", dpi=200)
    plt.close()


def plot_lag_curves(lag_all: pd.DataFrame, figdir: Path, top_signals: list[str]) -> None:
    for sig in top_signals:
        g = lag_all[lag_all["signal"] == sig]
        if len(g) == 0:
            continue

        plt.figure(figsize=(10, 5))
        plt.plot(g["lag_days"], g["residual_plv"])
        plt.xlabel("Lag days: planetary phase at t, residual DRIFT phase at t + lag")
        plt.ylabel("Residual PLV")
        plt.title(f"{sig}: lagged residual phase coherence")
        plt.tight_layout()
        plt.savefig(figdir / f"residual_lag_{sig}.png", dpi=200)
        plt.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", required=True)
    parser.add_argument("--out", default="outputs/residual_phase_coherence")
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

    for col in [DATE_COL, THETA_COL, R_COL, proxy_col(SUN)]:
        if col not in df.columns:
            raise KeyError(f"Missing required column: {col}")

    theta = phase_to_radians(df[THETA_COL])
    R = pd.to_numeric(df[R_COL], errors="coerce").to_numpy(dtype=float)

    R_thr = np.nanpercentile(R[np.isfinite(R)], args.r_q)
    high_R = np.isfinite(R) & (R >= R_thr)

    sun_x = pd.to_numeric(df[proxy_col(SUN)], errors="coerce").to_numpy(dtype=float)
    sun_phase = analytic_phase(sun_x, args.smooth_days)
    theta_res = residualize_against_sun(theta, sun_phase)

    available = [b for b in BODIES if proxy_col(b) in df.columns]

    phase_map = {}
    for b in available:
        x = pd.to_numeric(df[proxy_col(b)], errors="coerce").to_numpy(dtype=float)
        phase_map[b] = analytic_phase(x, args.smooth_days)

    signals = build_signals(phase_map, available)

    rows = []
    lag_rows = []

    for sig, ph in signals.items():
        raw_high = phase_locking_value(theta, ph, high_R)
        raw_bg = phase_locking_value(theta, ph, ~high_R & np.isfinite(R))

        residual_high = phase_locking_value(theta_res, ph, high_R)
        residual_bg = phase_locking_value(theta_res, ph, ~high_R & np.isfinite(R))

        residual_p = circular_shift_p(
            theta_res,
            ph,
            high_R,
            residual_high,
            args.surrogates,
            rng,
        )

        raw_p = circular_shift_p(
            theta,
            ph,
            high_R,
            raw_high,
            args.surrogates,
            rng,
        )

        lag_df = lagged_plv(theta_res, ph, high_R, args.max_lag)
        best_idx = lag_df["plv"].idxmax()
        best_lag_days = int(lag_df.loc[best_idx, "lag_days"])
        best_lag_plv = float(lag_df.loc[best_idx, "plv"])

        for _, r in lag_df.iterrows():
            lag_rows.append({
                "signal": sig,
                "lag_days": int(r["lag_days"]),
                "residual_plv": float(r["plv"]),
            })

        rows.append({
            "signal": sig,
            "raw_high_R_plv": raw_high,
            "raw_background_plv": raw_bg,
            "raw_delta": raw_high - raw_bg,
            "raw_p": raw_p,
            "residual_high_R_plv": residual_high,
            "residual_background_plv": residual_bg,
            "residual_delta": residual_high - residual_bg,
            "residual_p": residual_p,
            "best_residual_lag_days": best_lag_days,
            "best_residual_lag_plv": best_lag_plv,
        })

    summary = pd.DataFrame(rows)
    summary["raw_fdr_q"] = fdr_bh(summary["raw_p"].to_numpy())
    summary["residual_fdr_q"] = fdr_bh(summary["residual_p"].to_numpy())

    summary = summary.sort_values(
        ["residual_fdr_q", "residual_high_R_plv"],
        ascending=[True, False],
    )

    lag_all = pd.DataFrame(lag_rows)

    out_ts = pd.DataFrame({
        "date": df[DATE_COL],
        "theta_raw_rad": theta,
        "sun_phase_rad": sun_phase,
        "theta_residual_minus_sun_rad": theta_res,
        "R": R,
        "high_R": high_R,
    })

    summary.to_csv(out / "residual_phase_summary.csv", index=False)
    lag_all.to_csv(out / "residual_phase_lag_summary.csv", index=False)
    out_ts.to_csv(out / "solar_residual_timeseries.csv", index=False)

    plot_before_after(summary, figdir)
    plot_residual_significance(summary, figdir)

    top = summary.head(8)["signal"].tolist()
    plot_lag_curves(lag_all, figdir, top)

    print("\n=== RESIDUAL PHASE SUMMARY ===")
    print(summary.head(40).to_string(index=False))

    print(f"\nOutputs written to: {out.resolve()}")


if __name__ == "__main__":
    main()