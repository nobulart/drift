#!/usr/bin/env python3
"""
DRIFT Phase-Randomized Null Validation

Purpose:
  Test whether the pre-registered residual planetary phase coherence survives
  a stronger null model.

  This null preserves each proxy's amplitude spectrum but randomizes Fourier
  phases, thereby destroying coherent phase relationships while retaining
  autocorrelation and dominant periodic content.

Workflow:
  1. Load DRIFT CSV.
  2. Compute θ_res = wrap(θ - φ_sun).
  3. Build pre-registered non-solar composite phases.
  4. Measure high-R PLV contrast.
  5. Generate phase-randomized surrogate proxies.
  6. Recompute analytic phases and composite phases for each surrogate.
  7. Compare observed contrast to surrogate contrast distribution.

Usage:
  python drift_phase_randomized_null.py \
    --csv drift.csv \
    --out outputs/phase_randomized_null
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
DEFAULT_SURROGATES = 1000
RNG_SEED = 42


PREREGISTERED_COMPOSITES: dict[str, dict[str, float]] = {
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
    "Jupiter_Saturn_Uranus_Pluto": {
        "Jupiter": 1.0,
        "Saturn": 1.0,
        "Uranus": 1.0,
        "Pluto": 1.0,
    },
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
class NullResult:
    name: str
    bodies: str
    observed_high_R_plv: float
    observed_background_plv: float
    observed_contrast: float
    surrogate_mean_contrast: float
    surrogate_median_contrast: float
    surrogate_std_contrast: float
    phase_randomized_p: float
    z_score: float
    n_surrogates: int


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
    """
    Fourier phase randomization preserving the amplitude spectrum.

    Uses rFFT for a real-valued signal. DC and Nyquist components are preserved.
    """
    x = np.asarray(x, dtype=float)
    valid = np.isfinite(x)

    y = x.copy()
    y[~valid] = np.nanmedian(y[valid])
    mean = np.mean(y)
    y = y - mean

    spec = np.fft.rfft(y)
    amplitudes = np.abs(spec)

    phases = rng.uniform(0.0, 2.0 * np.pi, size=len(spec))

    phases[0] = np.angle(spec[0])

    if len(spec) > 1 and len(y) % 2 == 0:
        phases[-1] = np.angle(spec[-1])

    new_spec = amplitudes * np.exp(1j * phases)
    yr = np.fft.irfft(new_spec, n=len(y))

    return yr + mean


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


def contrast_plv(theta_res: np.ndarray, phi: np.ndarray, high_R: np.ndarray) -> tuple[float, float, float]:
    valid = np.isfinite(theta_res) & np.isfinite(phi)
    hi = valid & high_R
    bg = valid & ~high_R

    high = phase_locking_value(theta_res, phi, hi)
    background = phase_locking_value(theta_res, phi, bg)

    return high, background, high - background


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


def plot_null_distribution(
    name: str,
    observed: float,
    surrogates: np.ndarray,
    figdir: Path,
) -> None:
    clean = surrogates[np.isfinite(surrogates)]

    plt.figure(figsize=(9, 5))
    plt.hist(clean, bins=40, density=True, alpha=0.7, label="phase-randomized null")
    plt.axvline(observed, linestyle="--", linewidth=2, label="observed")
    plt.xlabel("High-R PLV contrast")
    plt.ylabel("Density")
    plt.title(f"Phase-randomized null: {name}")
    plt.legend()
    plt.tight_layout()
    plt.savefig(figdir / f"null_distribution_{name}.png", dpi=200)
    plt.close()


def plot_summary(summary: pd.DataFrame, figdir: Path) -> None:
    s = summary.sort_values("observed_contrast", ascending=False)

    plt.figure(figsize=(14, 7))
    plt.bar(s["name"], s["observed_contrast"])
    plt.axhline(0.0, linestyle="--", linewidth=1)
    plt.ylabel("Observed high-R PLV contrast")
    plt.xlabel("Composite")
    plt.title("Observed residual phase contrast under pre-registered composites")
    plt.xticks(rotation=70, ha="right")
    plt.tight_layout()
    plt.savefig(figdir / "observed_contrast_summary.png", dpi=200)
    plt.close()

    s2 = summary.sort_values("phase_randomized_p", ascending=True)

    plt.figure(figsize=(14, 7))
    plt.bar(s2["name"], -np.log10(s2["phase_randomized_p"].clip(lower=1e-12)))
    plt.ylabel("-log10 phase-randomized p")
    plt.xlabel("Composite")
    plt.title("Spectrum-preserving phase-randomized null significance")
    plt.xticks(rotation=70, ha="right")
    plt.tight_layout()
    plt.savefig(figdir / "phase_randomized_significance.png", dpi=200)
    plt.close()

    s3 = summary.sort_values("z_score", ascending=False)

    plt.figure(figsize=(14, 7))
    plt.bar(s3["name"], s3["z_score"])
    plt.axhline(0.0, linestyle="--", linewidth=1)
    plt.ylabel("Observed contrast z-score vs phase-randomized null")
    plt.xlabel("Composite")
    plt.title("Residual phase contrast z-score")
    plt.xticks(rotation=70, ha="right")
    plt.tight_layout()
    plt.savefig(figdir / "phase_randomized_zscore.png", dpi=200)
    plt.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", required=True)
    parser.add_argument("--out", default="outputs/phase_randomized_null")
    parser.add_argument("--r-q", type=float, default=DEFAULT_R_Q)
    parser.add_argument("--smooth-days", type=int, default=DEFAULT_SMOOTH_DAYS)
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

    raw_signals: dict[str, np.ndarray] = {}
    phase_map: dict[str, np.ndarray] = {}

    for body in required_bodies:
        col = proxy_col(body)
        if col not in df.columns:
            print(f"Skipping body missing from CSV: {body}")
            continue

        x = pd.to_numeric(df[col], errors="coerce").to_numpy(dtype=float)
        raw_signals[body] = x
        phase_map[body] = analytic_phase(x, args.smooth_days)

    rows = []
    null_rows = []

    for name, weights in PREREGISTERED_COMPOSITES.items():
        if not all(b in phase_map for b in weights):
            print(f"Skipping {name}: missing body")
            continue

        print(f"Testing {name}...")

        observed_phi = composite_phase(phase_map, weights)
        obs_high, obs_bg, obs_contrast = contrast_plv(theta_res, observed_phi, high_R)

        surrogate_contrasts = []

        bodies = list(weights.keys())

        for s in range(args.surrogates):
            surrogate_phase_map = {}

            for body in bodies:
                xr = phase_randomize_signal(raw_signals[body], rng)
                surrogate_phase_map[body] = analytic_phase(xr, args.smooth_days)

            surrogate_phi = composite_phase(surrogate_phase_map, weights)
            _, _, c = contrast_plv(theta_res, surrogate_phi, high_R)

            surrogate_contrasts.append(c)

            null_rows.append({
                "composite": name,
                "surrogate_id": s,
                "surrogate_contrast": c,
            })

        surrogate_contrasts = np.asarray(surrogate_contrasts, dtype=float)
        clean = surrogate_contrasts[np.isfinite(surrogate_contrasts)]

        if len(clean) == 0:
            p = np.nan
            z = np.nan
            mean_c = np.nan
            median_c = np.nan
            std_c = np.nan
        else:
            p = float((np.sum(clean >= obs_contrast) + 1) / (len(clean) + 1))
            mean_c = float(np.mean(clean))
            median_c = float(np.median(clean))
            std_c = float(np.std(clean, ddof=1))
            z = float((obs_contrast - mean_c) / std_c) if std_c > 0 else np.nan

        rows.append(NullResult(
            name=name,
            bodies="+".join(bodies),
            observed_high_R_plv=obs_high,
            observed_background_plv=obs_bg,
            observed_contrast=obs_contrast,
            surrogate_mean_contrast=mean_c,
            surrogate_median_contrast=median_c,
            surrogate_std_contrast=std_c,
            phase_randomized_p=p,
            z_score=z,
            n_surrogates=len(clean),
        ).__dict__)

        plot_null_distribution(name, obs_contrast, surrogate_contrasts, figdir)

    summary = pd.DataFrame(rows)
    summary["phase_randomized_fdr_q"] = fdr_bh(summary["phase_randomized_p"].to_numpy())

    summary = summary.sort_values(
        ["phase_randomized_fdr_q", "observed_contrast"],
        ascending=[True, False],
        na_position="last",
    )

    null_df = pd.DataFrame(null_rows)

    summary.to_csv(out / "phase_randomized_null_summary.csv", index=False)
    null_df.to_csv(out / "phase_randomized_null_samples.csv", index=False)

    plot_summary(summary, figdir)

    print("\n=== PHASE-RANDOMIZED NULL SUMMARY ===")
    print(summary.to_string(index=False))

    print(f"\nOutputs written to: {out.resolve()}")


if __name__ == "__main__":
    main()