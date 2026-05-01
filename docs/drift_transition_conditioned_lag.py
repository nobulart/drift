#!/usr/bin/env python3
"""
DRIFT Transition-Conditioned Lag Analysis

Purpose:
  Test whether planetary-composite phase coherence sharpens near DRIFT
  transition events, compared with non-transition high-R intervals.

Convention:
  positive lag = planetary composite phase leads DRIFT residual phase
  negative lag = DRIFT residual phase leads planetary composite phase

Usage:
  python drift_transition_conditioned_lag.py \
    --csv drift.csv \
    --out outputs/transition_conditioned_lag
"""

from __future__ import annotations

import argparse
from pathlib import Path
from dataclasses import dataclass

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy.signal import hilbert, savgol_filter, find_peaks


DATE_COL = "date"
THETA_COL = "θ (Phase) raw"
R_COL = "R(t) normalized"
OMEGA_COL = "ω (Angular Velocity) normalized"
SUN = "Sun"

DEFAULT_R_Q = 95.0
DEFAULT_SMOOTH_DAYS = 31
DEFAULT_MAX_LAG = 365
DEFAULT_EVENT_WINDOW = 45
DEFAULT_SURROGATES = 3000
RNG_SEED = 42


COMPOSITES = {
    "Venus_Mars": {"Venus": 1.0, "Mars": 1.0},
    "Mercury_Venus_Mars": {"Mercury": 1.0, "Venus": 1.0, "Mars": 1.0},
    "Venus_Mars_Jupiter": {"Venus": 1.0, "Mars": 1.0, "Jupiter": 1.0},
    "All_NonSolar_Major": {
        "Mercury": 1.0, "Venus": 1.0, "Mars": 1.0,
        "Jupiter": 1.0, "Saturn": 1.0, "Uranus": 1.0,
        "Neptune": 1.0, "Moon": 1.0,
    },
    "Mars_Jupiter": {"Mars": 1.0, "Jupiter": 1.0},
    "Venus_Jupiter": {"Venus": 1.0, "Jupiter": 1.0},
    "Jupiter_Saturn": {"Jupiter": 1.0, "Saturn": 1.0},
    "Sun_removed_Moon": {"Moon": 1.0},
}


@dataclass
class TransitionLagResult:
    name: str
    bodies: str
    n_transition_days: int
    n_nontransition_high_R_days: int
    transition_best_lag_days: int
    transition_best_plv: float
    nontransition_best_lag_days: int
    nontransition_best_plv: float
    transition_zero_lag_plv: float
    nontransition_zero_lag_plv: float
    transition_gain_best: float
    transition_gain_zero: float
    transition_peak_sharpness: float
    transition_vs_nontransition_p: float
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
    mask: np.ndarray,
    max_lag: int,
) -> pd.DataFrame:
    rows = []
    for lag in range(-max_lag, max_lag + 1):
        if lag == 0:
            a = theta_res
            b = phi
            m = mask
        elif lag > 0:
            a = theta_res[lag:]
            b = phi[:-lag]
            m = mask[lag:]
        else:
            k = abs(lag)
            a = theta_res[:-k]
            b = phi[k:]
            m = mask[:-k]

        rows.append({"lag_days": lag, "plv": phase_locking_value(a, b, m)})

    return pd.DataFrame(rows)


def detect_transition_events(
    R: np.ndarray,
    omega: np.ndarray,
    r_q: float,
    min_distance_days: int = 90,
) -> np.ndarray:
    """
    Transition candidates:
      - high R(t)
      - local maxima of R(t)
      - optionally supported by large |omega|

    This is conservative enough to avoid selecting every high-R day.
    """
    R = np.asarray(R, dtype=float)
    omega = np.asarray(omega, dtype=float)

    valid = np.isfinite(R)
    r_thr = np.nanpercentile(R[valid], r_q)

    y = R.copy()
    y[~valid] = np.nanmedian(R[valid])

    peaks, _ = find_peaks(
        y,
        height=r_thr,
        distance=min_distance_days,
        prominence=max(0.05, 0.15 * np.nanstd(y)),
    )

    events = np.zeros(len(R), dtype=bool)
    events[peaks] = True

    return events


def expand_event_window(events: np.ndarray, window_days: int) -> np.ndarray:
    mask = np.zeros_like(events, dtype=bool)
    idx = np.where(events)[0]
    n = len(events)
    for i in idx:
        lo = max(0, i - window_days)
        hi = min(n, i + window_days + 1)
        mask[lo:hi] = True
    return mask


def peak_sharpness(curve: pd.DataFrame) -> float:
    plv = curve["plv"].to_numpy(dtype=float)
    if not np.isfinite(plv).any():
        return np.nan
    mx = np.nanmax(plv)
    med = np.nanmedian(plv)
    return float(mx - med)


def shuffled_event_window_p(
    theta_res: np.ndarray,
    phi: np.ndarray,
    transition_mask: np.ndarray,
    nontransition_mask: np.ndarray,
    max_lag: int,
    observed_gain: float,
    n_surrogates: int,
    rng: np.random.Generator,
) -> tuple[float, float]:
    """
    Randomly relocate transition windows while preserving their count/extent
    approximately by circular shifting the transition mask.
    """
    n = len(transition_mask)
    vals = []

    for _ in range(n_surrogates):
        shift = int(rng.integers(1, n - 1))
        tm = np.roll(transition_mask, shift)
        nt = nontransition_mask & ~tm

        tc = lagged_plv_curve(theta_res, phi, tm, max_lag)
        nc = lagged_plv_curve(theta_res, phi, nt, max_lag)

        t_best = np.nanmax(tc["plv"].to_numpy(dtype=float))
        n_best = np.nanmax(nc["plv"].to_numpy(dtype=float))
        vals.append(t_best - n_best)

    vals = np.asarray(vals, dtype=float)
    vals = vals[np.isfinite(vals)]

    if len(vals) == 0:
        return np.nan, np.nan

    p = float((np.sum(vals >= observed_gain) + 1) / (len(vals) + 1))
    z = float((observed_gain - np.mean(vals)) / np.std(vals, ddof=1)) if np.std(vals, ddof=1) > 0 else np.nan
    return p, z


def plot_transition_events(dates: pd.Series, R: np.ndarray, events: np.ndarray, transition_mask: np.ndarray, figdir: Path) -> None:
    plt.figure(figsize=(14, 5))
    plt.plot(dates, R, linewidth=0.9)
    plt.scatter(dates[events], R[events], s=35, label="transition event peaks")
    plt.scatter(dates[transition_mask], R[transition_mask], s=4, alpha=0.25, label="transition windows")
    plt.xlabel("Date")
    plt.ylabel("R(t) normalized")
    plt.title("Detected DRIFT transition windows")
    plt.legend()
    plt.tight_layout()
    plt.savefig(figdir / "transition_windows.png", dpi=200)
    plt.close()


def plot_curves(name: str, transition_curve: pd.DataFrame, nontransition_curve: pd.DataFrame, figdir: Path) -> None:
    plt.figure(figsize=(11, 5))
    plt.plot(transition_curve["lag_days"], transition_curve["plv"], label="transition-window high-R")
    plt.plot(nontransition_curve["lag_days"], nontransition_curve["plv"], label="non-transition high-R")
    plt.axvline(0, linestyle="--", linewidth=1)
    plt.xlabel("Lag days; positive = planetary phase leads DRIFT")
    plt.ylabel("PLV")
    plt.title(f"Transition-conditioned lag coherence: {name}")
    plt.legend()
    plt.tight_layout()
    plt.savefig(figdir / f"transition_lag_curve_{name}.png", dpi=200)
    plt.close()


def plot_summary(summary: pd.DataFrame, figdir: Path) -> None:
    s = summary.sort_values("transition_gain_best", ascending=False)

    plt.figure(figsize=(13, 6))
    plt.bar(s["name"], s["transition_gain_best"])
    plt.axhline(0, linestyle="--", linewidth=1)
    plt.ylabel("Best PLV gain: transition minus non-transition")
    plt.xlabel("Composite")
    plt.title("Transition-conditioned coherence gain")
    plt.xticks(rotation=65, ha="right")
    plt.tight_layout()
    plt.savefig(figdir / "transition_coherence_gain.png", dpi=200)
    plt.close()

    s2 = summary.sort_values("transition_vs_nontransition_p", ascending=True)

    plt.figure(figsize=(13, 6))
    plt.bar(s2["name"], -np.log10(s2["transition_vs_nontransition_p"].clip(lower=1e-12)))
    plt.ylabel("-log10 p")
    plt.xlabel("Composite")
    plt.title("Transition-window significance vs shuffled windows")
    plt.xticks(rotation=65, ha="right")
    plt.tight_layout()
    plt.savefig(figdir / "transition_window_significance.png", dpi=200)
    plt.close()

    plt.figure(figsize=(13, 6))
    plt.bar(s["name"], s["transition_best_lag_days"])
    plt.axhline(0, linestyle="--", linewidth=1)
    plt.ylabel("Best transition lag days")
    plt.xlabel("Composite")
    plt.title("Best transition lag; positive = planetary phase leads DRIFT")
    plt.xticks(rotation=65, ha="right")
    plt.tight_layout()
    plt.savefig(figdir / "transition_best_lag_days.png", dpi=200)
    plt.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", required=True)
    parser.add_argument("--out", default="outputs/transition_conditioned_lag")
    parser.add_argument("--r-q", type=float, default=DEFAULT_R_Q)
    parser.add_argument("--smooth-days", type=int, default=DEFAULT_SMOOTH_DAYS)
    parser.add_argument("--max-lag", type=int, default=DEFAULT_MAX_LAG)
    parser.add_argument("--event-window", type=int, default=DEFAULT_EVENT_WINDOW)
    parser.add_argument("--surrogates", type=int, default=DEFAULT_SURROGATES)
    args = parser.parse_args()

    out = Path(args.out)
    figdir = ensure_dirs(out)
    rng = np.random.default_rng(RNG_SEED)

    df = pd.read_csv(args.csv)
    df[DATE_COL] = pd.to_datetime(df[DATE_COL], errors="coerce")

    for col in [DATE_COL, THETA_COL, R_COL, OMEGA_COL, proxy_col(SUN)]:
        if col not in df.columns:
            raise KeyError(f"Missing required column: {col}")

    dates = df[DATE_COL]
    theta = phase_to_radians(df[THETA_COL])
    R = pd.to_numeric(df[R_COL], errors="coerce").to_numpy(dtype=float)
    omega = pd.to_numeric(df[OMEGA_COL], errors="coerce").to_numpy(dtype=float)

    r_thr = np.nanpercentile(R[np.isfinite(R)], args.r_q)
    high_R = np.isfinite(R) & (R >= r_thr)

    events = detect_transition_events(R, omega, args.r_q)
    transition_window = expand_event_window(events, args.event_window) & high_R
    nontransition_high_R = high_R & ~transition_window

    sun_phase = analytic_phase(
        pd.to_numeric(df[proxy_col(SUN)], errors="coerce").to_numpy(dtype=float),
        args.smooth_days,
    )
    theta_res = wrap_phase(theta - sun_phase)

    required_bodies = sorted({b for weights in COMPOSITES.values() for b in weights})
    phase_map = {}

    for body in required_bodies:
        col = proxy_col(body)
        if col not in df.columns:
            print(f"Skipping missing body: {body}")
            continue
        phase_map[body] = analytic_phase(
            pd.to_numeric(df[col], errors="coerce").to_numpy(dtype=float),
            args.smooth_days,
        )

    plot_transition_events(dates, R, events, transition_window, figdir)

    rows = []
    all_curves = []

    print(f"Detected transition event peaks: {events.sum()}")
    print(f"Transition-window high-R days: {transition_window.sum()}")
    print(f"Non-transition high-R days: {nontransition_high_R.sum()}")

    for name, weights in COMPOSITES.items():
        if not all(b in phase_map for b in weights):
            print(f"Skipping {name}: missing body")
            continue

        print(f"Testing {name}...")

        phi = composite_phase(phase_map, weights)

        tc = lagged_plv_curve(theta_res, phi, transition_window, args.max_lag)
        nc = lagged_plv_curve(theta_res, phi, nontransition_high_R, args.max_lag)

        tc["name"] = name
        tc["mask_type"] = "transition_window"
        nc["name"] = name
        nc["mask_type"] = "nontransition_high_R"
        all_curves.append(tc)
        all_curves.append(nc)

        t_valid = tc[np.isfinite(tc["plv"])]
        n_valid = nc[np.isfinite(nc["plv"])]

        t_best = t_valid.loc[t_valid["plv"].idxmax()]
        n_best = n_valid.loc[n_valid["plv"].idxmax()]

        t_zero = float(t_valid[t_valid["lag_days"] == 0]["plv"].iloc[0])
        n_zero = float(n_valid[n_valid["lag_days"] == 0]["plv"].iloc[0])

        gain_best = float(t_best["plv"] - n_best["plv"])
        gain_zero = float(t_zero - n_zero)

        p, z = shuffled_event_window_p(
            theta_res=theta_res,
            phi=phi,
            transition_mask=transition_window,
            nontransition_mask=nontransition_high_R,
            max_lag=args.max_lag,
            observed_gain=gain_best,
            n_surrogates=args.surrogates,
            rng=rng,
        )

        rows.append(TransitionLagResult(
            name=name,
            bodies="+".join(weights.keys()),
            n_transition_days=int(transition_window.sum()),
            n_nontransition_high_R_days=int(nontransition_high_R.sum()),
            transition_best_lag_days=int(t_best["lag_days"]),
            transition_best_plv=float(t_best["plv"]),
            nontransition_best_lag_days=int(n_best["lag_days"]),
            nontransition_best_plv=float(n_best["plv"]),
            transition_zero_lag_plv=t_zero,
            nontransition_zero_lag_plv=n_zero,
            transition_gain_best=gain_best,
            transition_gain_zero=gain_zero,
            transition_peak_sharpness=peak_sharpness(tc),
            transition_vs_nontransition_p=p,
            z_score=z,
        ).__dict__)

        plot_curves(name, tc, nc, figdir)

    summary = pd.DataFrame(rows).sort_values(
        ["transition_vs_nontransition_p", "transition_gain_best"],
        ascending=[True, False],
        na_position="last",
    )

    curves = pd.concat(all_curves, ignore_index=True)

    summary.to_csv(out / "transition_conditioned_lag_summary.csv", index=False)
    curves.to_csv(out / "transition_conditioned_lag_curves.csv", index=False)

    plot_summary(summary, figdir)

    print("\n=== TRANSITION-CONDITIONED LAG SUMMARY ===")
    print(summary.to_string(index=False))

    print(f"\nOutputs written to: {out.resolve()}")


if __name__ == "__main__":
    main()