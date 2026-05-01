#!/usr/bin/env python3
"""
DRIFT Pre-Registered Composite Phase Validation

Purpose:
  Avoid combinatorial overfit by testing only pre-registered non-solar
  planetary composite phase indices.

  Solar phase is removed first:

      theta_res(t) = wrap(theta(t) - phi_sun(t))

  Then each pre-registered composite is tested:

      Phi_C(t) = arg(sum_i w_i exp(i phi_i(t)))

      Δphi(t) = wrap(theta_res(t) - Phi_C(t))

  Main diagnostics:
    - high-R PLV
    - background PLV
    - contrast = high-R PLV - background PLV
    - circular-shift p
    - rolling-window out-of-sample contrast
    - year-block surrogate p

Usage:
  python drift_preregistered_composite_validation.py \
    --csv drift.csv \
    --out outputs/preregistered_composites
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
DEFAULT_SURROGATES = 5000
DEFAULT_ROLL_YEARS = 8
DEFAULT_ROLL_STEP_YEARS = 1
RNG_SEED = 42


PREREGISTERED_COMPOSITES: dict[str, dict[str, float]] = {
    # Inner-system candidates
    "Venus_Mars": {
        "Venus": 1.0,
        "Mars": 1.0,
    },
    "Mercury_Venus_Mars": {
        "Mercury": 1.0,
        "Venus": 1.0,
        "Mars": 1.0,
    },
    "Venus_Mars_Jupiter": {
        "Venus": 1.0,
        "Mars": 1.0,
        "Jupiter": 1.0,
    },

    # Giant-planet / slow-phase candidates
    "Jupiter_Saturn": {
        "Jupiter": 1.0,
        "Saturn": 1.0,
    },
    "Jupiter_Saturn_Uranus_Neptune": {
        "Jupiter": 1.0,
        "Saturn": 1.0,
        "Uranus": 1.0,
        "Neptune": 1.0,
    },
    "Jupiter_Uranus_Neptune": {
        "Jupiter": 1.0,
        "Uranus": 1.0,
        "Neptune": 1.0,
    },

    # Prior optimizer-indicated slow composite, tested here without fitted weights
    "Jupiter_Saturn_Uranus_Pluto": {
        "Jupiter": 1.0,
        "Saturn": 1.0,
        "Uranus": 1.0,
        "Pluto": 1.0,
    },

    # Mixed inner/outer candidates from previous amplitude work
    "Venus_Jupiter": {
        "Venus": 1.0,
        "Jupiter": 1.0,
    },
    "Mars_Jupiter": {
        "Mars": 1.0,
        "Jupiter": 1.0,
    },
    "Venus_Jupiter_Neptune": {
        "Venus": 1.0,
        "Jupiter": 1.0,
        "Neptune": 1.0,
    },
    "Mars_Jupiter_Neptune": {
        "Mars": 1.0,
        "Jupiter": 1.0,
        "Neptune": 1.0,
    },

    # Lunar modulation baselines
    "Sun_removed_Moon": {
        "Moon": 1.0,
    },
    "Jupiter_Moon": {
        "Jupiter": 1.0,
        "Moon": 1.0,
    },
    "Venus_Mars_Moon": {
        "Venus": 1.0,
        "Mars": 1.0,
        "Moon": 1.0,
    },

    # Broad non-solar reference
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
}


@dataclass
class CompositeResult:
    name: str
    bodies: str
    high_R_plv: float
    background_plv: float
    contrast: float
    circular_shift_p: float
    year_block_p: float
    rolling_mean_contrast: float
    rolling_median_contrast: float
    rolling_positive_fraction: float
    n_high_R: int
    n_background: int


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
        if body not in phase_map:
            raise KeyError(f"Missing analytic phase for body: {body}")
        z += float(weight) * np.exp(1j * phase_map[body])

    return wrap_phase(np.angle(z))


def phase_locking_value(a: np.ndarray, b: np.ndarray, mask: np.ndarray) -> float:
    valid = np.isfinite(a) & np.isfinite(b) & mask

    if valid.sum() < 10:
        return np.nan

    return float(np.abs(np.mean(np.exp(1j * wrap_phase(a[valid] - b[valid])))))


def contrast_plv(theta_res: np.ndarray, phi: np.ndarray, high_R: np.ndarray) -> tuple[float, float, float]:
    valid = np.isfinite(theta_res) & np.isfinite(phi)
    bg = valid & ~high_R
    hi = valid & high_R

    high = phase_locking_value(theta_res, phi, hi)
    background = phase_locking_value(theta_res, phi, bg)
    contrast = high - background

    return high, background, contrast


def circular_shift_p(
    theta_res: np.ndarray,
    phi: np.ndarray,
    high_R: np.ndarray,
    observed_high_plv: float,
    n_surrogates: int,
    rng: np.random.Generator,
) -> float:
    n = len(phi)
    vals = []

    for _ in range(n_surrogates):
        shift = int(rng.integers(1, n - 1))
        shifted = np.roll(phi, shift)
        vals.append(phase_locking_value(theta_res, shifted, high_R))

    vals = np.asarray(vals, dtype=float)
    vals = vals[np.isfinite(vals)]

    if len(vals) == 0:
        return np.nan

    return float((np.sum(vals >= observed_high_plv) + 1) / (len(vals) + 1))


def year_block_shuffle_p(
    dates: pd.Series,
    theta_res: np.ndarray,
    phi: np.ndarray,
    high_R: np.ndarray,
    observed_high_plv: float,
    n_surrogates: int,
    rng: np.random.Generator,
) -> float:
    """
    Stronger null:
      Shuffle whole calendar-year blocks of the planetary phase series.
      This preserves within-year phase structure but breaks long-range
      alignment with DRIFT high-R states.
    """
    years = pd.to_datetime(dates).dt.year.to_numpy()
    unique_years = np.array(sorted(pd.unique(years[np.isfinite(years)])))

    if len(unique_years) < 5:
        return np.nan

    year_indices = {y: np.where(years == y)[0] for y in unique_years}

    vals = []

    for _ in range(n_surrogates):
        shuffled_years = unique_years.copy()
        rng.shuffle(shuffled_years)

        phi_s = np.empty_like(phi)

        for original_y, shuffled_y in zip(unique_years, shuffled_years):
            target_idx = year_indices[original_y]
            source_idx = year_indices[shuffled_y]

            source_vals = phi[source_idx]

            if len(source_vals) == len(target_idx):
                phi_s[target_idx] = source_vals
            else:
                # Handles leap years / unequal block lengths by interpolation
                x_src = np.linspace(0, 1, len(source_vals))
                x_tgt = np.linspace(0, 1, len(target_idx))
                phi_s[target_idx] = np.interp(x_tgt, x_src, source_vals)

        vals.append(phase_locking_value(theta_res, phi_s, high_R))

    vals = np.asarray(vals, dtype=float)
    vals = vals[np.isfinite(vals)]

    if len(vals) == 0:
        return np.nan

    return float((np.sum(vals >= observed_high_plv) + 1) / (len(vals) + 1))


def rolling_window_validation(
    dates: pd.Series,
    theta_res: np.ndarray,
    phi: np.ndarray,
    high_R: np.ndarray,
    roll_years: int,
    step_years: int,
) -> pd.DataFrame:
    d = pd.to_datetime(dates)
    min_date = d.min()
    max_date = d.max()

    rows = []

    start = pd.Timestamp(year=min_date.year, month=1, day=1)

    while start < max_date:
        end = start + pd.DateOffset(years=roll_years)
        mask = (d >= start) & (d < end)

        n_hi = int((mask.to_numpy() & high_R).sum())
        n_bg = int((mask.to_numpy() & ~high_R & np.isfinite(theta_res) & np.isfinite(phi)).sum())

        if n_hi >= 10 and n_bg >= 50:
            high, background, contrast = contrast_plv(
                theta_res,
                phi,
                mask.to_numpy() & high_R,
            )

            rows.append({
                "window_start": start.date().isoformat(),
                "window_end": end.date().isoformat(),
                "n_high_R": n_hi,
                "n_background": n_bg,
                "high_R_plv": high,
                "background_plv": background,
                "contrast": contrast,
            })

        start = start + pd.DateOffset(years=step_years)

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


def plot_summary(summary: pd.DataFrame, figdir: Path) -> None:
    s = summary.sort_values("contrast", ascending=False)

    plt.figure(figsize=(14, 7))
    plt.bar(s["name"], s["contrast"])
    plt.axhline(0.0, linestyle="--", linewidth=1)
    plt.ylabel("High-R PLV minus background PLV")
    plt.xlabel("Pre-registered composite")
    plt.title("Pre-registered composite residual phase contrast")
    plt.xticks(rotation=70, ha="right")
    plt.tight_layout()
    plt.savefig(figdir / "preregistered_composite_contrast.png", dpi=200)
    plt.close()

    plt.figure(figsize=(14, 7))
    plt.bar(s["name"], s["rolling_positive_fraction"])
    plt.axhline(0.5, linestyle="--", linewidth=1)
    plt.ylabel("Fraction of rolling windows with positive contrast")
    plt.xlabel("Pre-registered composite")
    plt.title("Rolling-window stability of residual phase contrast")
    plt.xticks(rotation=70, ha="right")
    plt.tight_layout()
    plt.savefig(figdir / "rolling_positive_fraction.png", dpi=200)
    plt.close()

    plt.figure(figsize=(14, 7))
    ordered = summary.sort_values("year_block_p", ascending=True)
    plt.bar(ordered["name"], -np.log10(ordered["year_block_p"].clip(lower=1e-12)))
    plt.ylabel("-log10 year-block surrogate p")
    plt.xlabel("Pre-registered composite")
    plt.title("Year-block surrogate significance")
    plt.xticks(rotation=70, ha="right")
    plt.tight_layout()
    plt.savefig(figdir / "year_block_significance.png", dpi=200)
    plt.close()


def plot_rolling(rolling_all: pd.DataFrame, figdir: Path) -> None:
    for name, g in rolling_all.groupby("name"):
        plt.figure(figsize=(12, 5))
        x = pd.to_datetime(g["window_start"])
        plt.plot(x, g["contrast"], marker="o", linewidth=1)
        plt.axhline(0.0, linestyle="--", linewidth=1)
        plt.xlabel("Window start")
        plt.ylabel("High-R minus background PLV")
        plt.title(f"Rolling residual phase contrast: {name}")
        plt.tight_layout()
        plt.savefig(figdir / f"rolling_contrast_{name}.png", dpi=200)
        plt.close()


def plot_best_phase_histogram(
    theta_res: np.ndarray,
    phi: np.ndarray,
    high_R: np.ndarray,
    figdir: Path,
    name: str,
) -> None:
    delta = wrap_phase(theta_res - phi)

    plt.figure(figsize=(10, 5))
    plt.hist(delta[~high_R & np.isfinite(delta)], bins=36, density=True, alpha=0.5, label="background")
    plt.hist(delta[high_R & np.isfinite(delta)], bins=36, density=True, alpha=0.75, label="high-R")
    plt.xlabel("Residual phase misalignment Δφ")
    plt.ylabel("Density")
    plt.title(f"Best pre-registered composite: {name}")
    plt.legend()
    plt.tight_layout()
    plt.savefig(figdir / "best_preregistered_phase_histogram.png", dpi=200)
    plt.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", required=True)
    parser.add_argument("--out", default="outputs/preregistered_composites")
    parser.add_argument("--r-q", type=float, default=DEFAULT_R_Q)
    parser.add_argument("--smooth-days", type=int, default=DEFAULT_SMOOTH_DAYS)
    parser.add_argument("--surrogates", type=int, default=DEFAULT_SURROGATES)
    parser.add_argument("--roll-years", type=int, default=DEFAULT_ROLL_YEARS)
    parser.add_argument("--roll-step-years", type=int, default=DEFAULT_ROLL_STEP_YEARS)
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

    sun_phase = analytic_phase(
        pd.to_numeric(df[proxy_col(SUN)], errors="coerce").to_numpy(dtype=float),
        args.smooth_days,
    )

    theta_res = wrap_phase(theta - sun_phase)

    required_bodies = sorted({
        body
        for comp in PREREGISTERED_COMPOSITES.values()
        for body in comp.keys()
    })

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

    rows = []
    rolling_frames = []
    phi_by_name = {}

    for name, weights in PREREGISTERED_COMPOSITES.items():
        if not all(body in phase_map for body in weights.keys()):
            print(f"Skipping {name}: missing one or more bodies")
            continue

        print(f"Testing {name}...")

        phi = composite_phase(phase_map, weights)
        phi_by_name[name] = phi

        high, background, contrast = contrast_plv(theta_res, phi, high_R)

        circ_p = circular_shift_p(
            theta_res=theta_res,
            phi=phi,
            high_R=high_R,
            observed_high_plv=high,
            n_surrogates=args.surrogates,
            rng=rng,
        )

        block_p = year_block_shuffle_p(
            dates=df[DATE_COL],
            theta_res=theta_res,
            phi=phi,
            high_R=high_R,
            observed_high_plv=high,
            n_surrogates=args.surrogates,
            rng=rng,
        )

        rolling = rolling_window_validation(
            dates=df[DATE_COL],
            theta_res=theta_res,
            phi=phi,
            high_R=high_R,
            roll_years=args.roll_years,
            step_years=args.roll_step_years,
        )

        if len(rolling):
            rolling["name"] = name
            rolling_frames.append(rolling)

            rolling_mean = float(rolling["contrast"].mean())
            rolling_median = float(rolling["contrast"].median())
            rolling_positive = float((rolling["contrast"] > 0).mean())
        else:
            rolling_mean = np.nan
            rolling_median = np.nan
            rolling_positive = np.nan

        valid = np.isfinite(theta_res) & np.isfinite(phi)

        rows.append(CompositeResult(
            name=name,
            bodies="+".join(weights.keys()),
            high_R_plv=high,
            background_plv=background,
            contrast=contrast,
            circular_shift_p=circ_p,
            year_block_p=block_p,
            rolling_mean_contrast=rolling_mean,
            rolling_median_contrast=rolling_median,
            rolling_positive_fraction=rolling_positive,
            n_high_R=int((valid & high_R).sum()),
            n_background=int((valid & ~high_R).sum()),
        ).__dict__)

    summary = pd.DataFrame(rows)

    summary["circular_fdr_q"] = fdr_bh(summary["circular_shift_p"].to_numpy())
    summary["year_block_fdr_q"] = fdr_bh(summary["year_block_p"].to_numpy())

    summary = summary.sort_values(
        ["year_block_fdr_q", "contrast"],
        ascending=[True, False],
        na_position="last",
    )

    summary.to_csv(out / "preregistered_composite_summary.csv", index=False)

    if rolling_frames:
        rolling_all = pd.concat(rolling_frames, ignore_index=True)
    else:
        rolling_all = pd.DataFrame()

    rolling_all.to_csv(out / "preregistered_rolling_summary.csv", index=False)

    ts = pd.DataFrame({
        "date": df[DATE_COL],
        "theta_residual_minus_sun_rad": theta_res,
        "R": R,
        "high_R": high_R,
    })

    for name, phi in phi_by_name.items():
        ts[f"{name}_phase"] = phi
        ts[f"{name}_misalignment"] = wrap_phase(theta_res - phi)

    ts.to_csv(out / "preregistered_phase_timeseries.csv", index=False)

    plot_summary(summary, figdir)

    if len(rolling_all):
        plot_rolling(rolling_all, figdir)

    if len(summary):
        best_name = summary.iloc[0]["name"]
        plot_best_phase_histogram(theta_res, phi_by_name[best_name], high_R, figdir, best_name)

    print("\n=== PRE-REGISTERED COMPOSITE SUMMARY ===")
    print(summary.to_string(index=False))

    print(f"\nOutputs written to: {out.resolve()}")


if __name__ == "__main__":
    main()