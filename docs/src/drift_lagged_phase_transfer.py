#!/usr/bin/env python3
"""
DRIFT Lagged Phase-Transfer Test

Tests whether pre-registered planetary composite phase leads or lags
DRIFT residual phase during high-R states.

Key convention:
  positive lag_days means:

      planetary composite phase at time t
      is compared to DRIFT residual phase at time t + lag

  Therefore:
      positive lag = planetary phase leads DRIFT state
      negative lag = DRIFT state leads planetary phase

Usage:
  python drift_lagged_phase_transfer.py \
    --csv drift.csv \
    --out outputs/lagged_phase_transfer
"""

from __future__ import annotations

import argparse
from pathlib import Path
from dataclasses import dataclass

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy.signal import hilbert, savgol_filter


DATE_COL = "date"
THETA_COL = "θ (Phase) raw"
R_COL = "R(t) normalized"
SUN = "Sun"

DEFAULT_R_Q = 95.0
DEFAULT_SMOOTH_DAYS = 31
DEFAULT_MAX_LAG = 365
DEFAULT_SURROGATES = 3000
RNG_SEED = 42


PREREGISTERED_COMPOSITES: dict[str, dict[str, float]] = {
    "Venus_Mars_Jupiter": {
        "Venus": 1.0,
        "Mars": 1.0,
        "Jupiter": 1.0,
    },
    "Venus_Mars": {
        "Venus": 1.0,
        "Mars": 1.0,
    },
    "Mercury_Venus_Mars": {
        "Mercury": 1.0,
        "Venus": 1.0,
        "Mars": 1.0,
    },
    "All_NonSolar_Major": {
        "Mercury": 1.0,
        "Venus": 1.0,
        "Mars": 1.0,
        "Jupiter": 1.0,
        "Saturn": 1.0,
        "Uranus": 1.0,
        "Neptune": 1.0,
        "Moon": 1.0,
    },
    "Mars_Jupiter": {
        "Mars": 1.0,
        "Jupiter": 1.0,
    },
    "Venus_Jupiter": {
        "Venus": 1.0,
        "Jupiter": 1.0,
    },
    "Jupiter_Saturn": {
        "Jupiter": 1.0,
        "Saturn": 1.0,
    },
    "Sun_removed_Moon": {
        "Moon": 1.0,
    },
}


@dataclass
class LagResult:
    name: str
    bodies: str
    best_lag_days: int
    best_lag_plv: float
    zero_lag_plv: float
    lead_minus_zero: float
    best_positive_lag_days: int
    best_positive_lag_plv: float
    best_negative_lag_days: int
    best_negative_lag_plv: float
    lead_asymmetry: float
    phase_randomized_lag_p: float
    z_score: float


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

    return wrap_phase(np.angle(hilbert(y)))


def phase_randomize_signal(x: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    x = np.asarray(x, dtype=float)
    valid = np.isfinite(x)

    y = x.copy()
    y[~valid] = np.nanmedian(y[valid])
    mean = np.mean(y)
    y = y - mean

    spec = np.fft.rfft(y)
    amps = np.abs(spec)
    phases = rng.uniform(0.0, 2.0 * np.pi, size=len(spec))

    phases[0] = np.angle(spec[0])

    if len(y) % 2 == 0:
        phases[-1] = np.angle(spec[-1])

    new_spec = amps * np.exp(1j * phases)
    return np.fft.irfft(new_spec, n=len(y)) + mean


def composite_phase(phase_map: dict[str, np.ndarray], weights: dict[str, float]) -> np.ndarray:
    n = len(next(iter(phase_map.values())))
    z = np.zeros(n, dtype=complex)

    for body, weight in weights.items():
        z += float(weight) * np.exp(1j * phase_map[body])

    return wrap_phase(np.angle(z))


def phase_locking_value(a: np.ndarray, b: np.ndarray, mask: np.ndarray) -> float:
    valid = np.isfinite(a) & np.isfinite(b) & mask

    if valid.sum() < 10:
        return np.nan

    return float(np.abs(np.mean(np.exp(1j * wrap_phase(a[valid] - b[valid])))))


def lagged_plv_curve(
    theta_res: np.ndarray,
    phi: np.ndarray,
    high_R: np.ndarray,
    max_lag: int,
) -> pd.DataFrame:
    """
    positive lag:
      phi(t) compared with theta_res(t + lag)
      planetary phase leads DRIFT residual phase.
    """
    rows = []

    for lag in range(-max_lag, max_lag + 1):
        if lag == 0:
            a = theta_res
            b = phi
            m = high_R
        elif lag > 0:
            a = theta_res[lag:]
            b = phi[:-lag]
            m = high_R[lag:]
        else:
            k = abs(lag)
            a = theta_res[:-k]
            b = phi[k:]
            m = high_R[:-k]

        plv = phase_locking_value(a, b, m)

        rows.append({
            "lag_days": lag,
            "plv": plv,
        })

    return pd.DataFrame(rows)


def lead_asymmetry(curve: pd.DataFrame) -> float:
    pos = curve[curve["lag_days"] > 0]["plv"].mean()
    neg = curve[curve["lag_days"] < 0]["plv"].mean()
    return float(pos - neg)


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


def plot_lag_curve(curve: pd.DataFrame, name: str, figdir: Path) -> None:
    plt.figure(figsize=(11, 5))
    plt.plot(curve["lag_days"], curve["plv"], linewidth=1.4)
    plt.axvline(0, linestyle="--", linewidth=1)
    plt.xlabel("Lag days: positive = planetary phase leads DRIFT")
    plt.ylabel("High-R PLV")
    plt.title(f"Lagged residual phase coherence: {name}")
    plt.tight_layout()
    plt.savefig(figdir / f"lag_curve_{name}.png", dpi=200)
    plt.close()


def plot_summary(summary: pd.DataFrame, figdir: Path) -> None:
    s = summary.sort_values("best_lag_plv", ascending=False)

    plt.figure(figsize=(13, 6))
    plt.bar(s["name"], s["best_lag_days"])
    plt.axhline(0, linestyle="--", linewidth=1)
    plt.ylabel("Best lag days")
    plt.xlabel("Composite")
    plt.title("Best lag: positive means planetary phase leads DRIFT")
    plt.xticks(rotation=65, ha="right")
    plt.tight_layout()
    plt.savefig(figdir / "best_lag_days_summary.png", dpi=200)
    plt.close()

    plt.figure(figsize=(13, 6))
    plt.bar(s["name"], s["lead_asymmetry"])
    plt.axhline(0, linestyle="--", linewidth=1)
    plt.ylabel("Mean PLV(+lags) - mean PLV(-lags)")
    plt.xlabel("Composite")
    plt.title("Lead-lag asymmetry")
    plt.xticks(rotation=65, ha="right")
    plt.tight_layout()
    plt.savefig(figdir / "lead_lag_asymmetry_summary.png", dpi=200)
    plt.close()

    s2 = summary.sort_values("phase_randomized_lag_p", ascending=True)

    plt.figure(figsize=(13, 6))
    plt.bar(s2["name"], -np.log10(s2["phase_randomized_lag_p"].clip(lower=1e-12)))
    plt.ylabel("-log10 p")
    plt.xlabel("Composite")
    plt.title("Lagged coherence significance vs phase-randomized null")
    plt.xticks(rotation=65, ha="right")
    plt.tight_layout()
    plt.savefig(figdir / "lagged_phase_randomized_significance.png", dpi=200)
    plt.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", required=True)
    parser.add_argument("--out", default="outputs/lagged_phase_transfer")
    parser.add_argument("--r-q", type=float, default=DEFAULT_R_Q)
    parser.add_argument("--smooth-days", type=int, default=DEFAULT_SMOOTH_DAYS)
    parser.add_argument("--max-lag", type=int, default=DEFAULT_MAX_LAG)
    parser.add_argument("--surrogates", type=int, default=DEFAULT_SURROGATES)
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

    sun_raw = pd.to_numeric(df[proxy_col(SUN)], errors="coerce").to_numpy(dtype=float)
    sun_phase = analytic_phase(sun_raw, args.smooth_days)
    theta_res = wrap_phase(theta - sun_phase)

    required_bodies = sorted({
        b
        for comp in PREREGISTERED_COMPOSITES.values()
        for b in comp.keys()
    })

    raw_signals = {}
    phase_map = {}

    for body in required_bodies:
        col = proxy_col(body)

        if col not in df.columns:
            print(f"Skipping missing body: {body}")
            continue

        x = pd.to_numeric(df[col], errors="coerce").to_numpy(dtype=float)
        raw_signals[body] = x
        phase_map[body] = analytic_phase(x, args.smooth_days)

    summary_rows = []
    lag_rows = []

    for name, weights in PREREGISTERED_COMPOSITES.items():
        if not all(b in phase_map for b in weights):
            print(f"Skipping {name}: missing body")
            continue

        print(f"Testing {name}...")

        phi = composite_phase(phase_map, weights)
        curve = lagged_plv_curve(theta_res, phi, high_R, args.max_lag)
        curve["name"] = name
        lag_rows.append(curve)

        valid_curve = curve[np.isfinite(curve["plv"])]

        best = valid_curve.loc[valid_curve["plv"].idxmax()]
        zero = valid_curve[valid_curve["lag_days"] == 0]["plv"].iloc[0]

        positive = valid_curve[valid_curve["lag_days"] > 0]
        negative = valid_curve[valid_curve["lag_days"] < 0]

        best_pos = positive.loc[positive["plv"].idxmax()]
        best_neg = negative.loc[negative["plv"].idxmax()]

        observed_best = float(best["plv"])

        surrogate_best = []

        bodies = list(weights.keys())

        for _ in range(args.surrogates):
            surrogate_phase_map = {}

            for body in bodies:
                xr = phase_randomize_signal(raw_signals[body], rng)
                surrogate_phase_map[body] = analytic_phase(xr, args.smooth_days)

            phi_s = composite_phase(surrogate_phase_map, weights)
            curve_s = lagged_plv_curve(theta_res, phi_s, high_R, args.max_lag)
            surrogate_best.append(np.nanmax(curve_s["plv"].to_numpy(dtype=float)))

        surrogate_best = np.asarray(surrogate_best, dtype=float)
        surrogate_best = surrogate_best[np.isfinite(surrogate_best)]

        p = float((np.sum(surrogate_best >= observed_best) + 1) / (len(surrogate_best) + 1))

        z = (
            float((observed_best - np.mean(surrogate_best)) / np.std(surrogate_best, ddof=1))
            if len(surrogate_best) > 2 and np.std(surrogate_best, ddof=1) > 0
            else np.nan
        )

        summary_rows.append(LagResult(
            name=name,
            bodies="+".join(bodies),
            best_lag_days=int(best["lag_days"]),
            best_lag_plv=observed_best,
            zero_lag_plv=float(zero),
            lead_minus_zero=observed_best - float(zero),
            best_positive_lag_days=int(best_pos["lag_days"]),
            best_positive_lag_plv=float(best_pos["plv"]),
            best_negative_lag_days=int(best_neg["lag_days"]),
            best_negative_lag_plv=float(best_neg["plv"]),
            lead_asymmetry=lead_asymmetry(valid_curve),
            phase_randomized_lag_p=p,
            z_score=z,
        ).__dict__)

        plot_lag_curve(curve, name, figdir)

    summary = pd.DataFrame(summary_rows)
    summary["lag_fdr_q"] = fdr_bh(summary["phase_randomized_lag_p"].to_numpy())

    summary = summary.sort_values(
        ["lag_fdr_q", "best_lag_plv"],
        ascending=[True, False],
        na_position="last",
    )

    lag_all = pd.concat(lag_rows, ignore_index=True)

    summary.to_csv(out / "lagged_phase_transfer_summary.csv", index=False)
    lag_all.to_csv(out / "lagged_phase_transfer_curves.csv", index=False)

    plot_summary(summary, figdir)

    print("\n=== LAGGED PHASE TRANSFER SUMMARY ===")
    print(summary.to_string(index=False))

    print(f"\nOutputs written to: {out.resolve()}")


if __name__ == "__main__":
    main()