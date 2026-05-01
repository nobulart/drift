#!/usr/bin/env python3
"""
DRIFT Phase-Dependent Escape Rate Model

Fits a formal escape-rate model:

    P(escape | phi) = sigmoid(beta0 + beta1 cos(phi) + beta2 sin(phi))

where phi is the residual misalignment:

    phi = wrap(theta_residual_minus_sun - Phi_composite)

This estimates whether escape probability is modulated by planetary phase
alignment, and extracts:

    alpha = sqrt(beta1^2 + beta2^2)
    phi0  = atan2(beta2, beta1)

Usage:
  python drift_phase_dependent_escape_rate.py \
    --csv drift.csv \
    --out outputs/phase_dependent_escape_rate
"""

from __future__ import annotations

import argparse
from pathlib import Path
from dataclasses import dataclass

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy.signal import hilbert, savgol_filter, find_peaks
from scipy.special import expit
from scipy.optimize import minimize
from scipy.stats import chi2


DATE_COL = "date"
THETA_COL = "θ (Phase) raw"
R_COL = "R(t) normalized"
SUN = "Sun"

DEFAULT_R_Q = 95.0
DEFAULT_SMOOTH_DAYS = 31
DEFAULT_BINS = 36
DEFAULT_ESCAPE_WINDOW = 45
DEFAULT_MIN_WELL_DWELL = 20

COMPOSITES = {
    "Venus_Mars": {"Venus": 1.0, "Mars": 1.0},
    "Venus_Mars_Jupiter": {"Venus": 1.0, "Mars": 1.0, "Jupiter": 1.0},
    "Mercury_Venus_Mars": {"Mercury": 1.0, "Venus": 1.0, "Mars": 1.0},
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
class EscapeRateResult:
    composite: str
    bodies: str
    n_days: int
    n_escape_days: int
    beta0: float
    beta_cos: float
    beta_sin: float
    alpha: float
    phi0_rad: float
    phi0_deg: float
    loglike_full: float
    loglike_null: float
    likelihood_ratio: float
    lr_p: float
    mean_escape_prob: float
    max_escape_prob: float
    min_escape_prob: float
    modulation_ratio_max_min: float


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


def estimate_phase_potential(theta: np.ndarray, bins: int = 72, smooth_sigma: float = 2.0) -> tuple[np.ndarray, np.ndarray]:
    from scipy.ndimage import gaussian_filter1d

    valid = np.isfinite(theta)
    edges = np.linspace(-np.pi, np.pi, bins + 1)
    counts, _ = np.histogram(theta[valid], bins=edges)

    density = counts.astype(float) + 1e-12
    density = density / density.sum()
    density = gaussian_filter1d(density, sigma=smooth_sigma, mode="wrap")
    density = density / density.sum()

    V = -np.log(density + 1e-12)
    V -= np.nanmin(V)

    centers = 0.5 * (edges[:-1] + edges[1:])
    return centers, V


def identify_two_wells(theta_centers: np.ndarray, V: np.ndarray) -> np.ndarray:
    wells, _ = find_peaks(-V, distance=3)

    if len(wells) == 0:
        raise RuntimeError("No wells detected in phase potential.")

    order = np.argsort(V[wells])
    wells = wells[order[:2]]

    return theta_centers[wells]


def assign_well(theta: np.ndarray, well_phases: np.ndarray) -> np.ndarray:
    assigned = np.full(len(theta), -1, dtype=int)

    for i, th in enumerate(theta):
        if not np.isfinite(th):
            continue
        distances = np.abs(wrap_phase(th - well_phases))
        assigned[i] = int(np.argmin(distances))

    return assigned


def detect_escape_days(
    theta_res: np.ndarray,
    R: np.ndarray,
    r_q: float,
    escape_window: int,
    min_well_dwell: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    centers, V = estimate_phase_potential(theta_res)
    wells = identify_two_wells(centers, V)
    well_id = assign_well(theta_res, wells)

    r_thr = np.nanpercentile(R[np.isfinite(R)], r_q)

    escape_points = np.zeros(len(theta_res), dtype=bool)
    last_well = well_id[0]
    dwell = 0

    for i in range(1, len(well_id)):
        if well_id[i] == last_well:
            dwell += 1
            continue

        if well_id[i] >= 0 and last_well >= 0 and dwell >= min_well_dwell:
            lo = max(0, i - escape_window)
            hi = min(len(well_id), i + escape_window + 1)
            if np.nanmax(R[lo:hi]) >= r_thr:
                escape_points[i] = True

        last_well = well_id[i]
        dwell = 0

    escape_days = np.zeros(len(theta_res), dtype=bool)

    for i in np.where(escape_points)[0]:
        lo = max(0, i - escape_window)
        hi = min(len(theta_res), i + escape_window + 1)
        escape_days[lo:hi] = True

    return escape_points, escape_days, well_id


def logistic_negloglike(beta: np.ndarray, X: np.ndarray, y: np.ndarray) -> float:
    eta = X @ beta
    p = expit(eta)
    eps = 1e-12
    ll = np.sum(y * np.log(p + eps) + (1 - y) * np.log(1 - p + eps))
    return -float(ll)


def fit_logistic(phi: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, float, float, float]:
    valid = np.isfinite(phi) & np.isfinite(y)
    phi = phi[valid]
    y = y[valid].astype(float)

    X = np.column_stack([
        np.ones_like(phi),
        np.cos(phi),
        np.sin(phi),
    ])

    p0 = np.clip(y.mean(), 1e-6, 1 - 1e-6)
    beta0 = np.log(p0 / (1 - p0))
    init = np.array([beta0, 0.0, 0.0])

    res = minimize(
        logistic_negloglike,
        init,
        args=(X, y),
        method="BFGS",
    )

    beta = res.x
    ll_full = -logistic_negloglike(beta, X, y)

    X0 = np.ones((len(y), 1))
    res0 = minimize(
        lambda b: logistic_negloglike(b, X0, y),
        np.array([beta0]),
        method="BFGS",
    )
    ll_null = -logistic_negloglike(res0.x, X0, y)

    lr = 2.0 * (ll_full - ll_null)
    p = float(chi2.sf(lr, df=2))

    return beta, ll_full, ll_null, p


def model_curve(beta: np.ndarray, n: int = 361) -> pd.DataFrame:
    phi = np.linspace(-np.pi, np.pi, n)
    X = np.column_stack([np.ones_like(phi), np.cos(phi), np.sin(phi)])
    prob = expit(X @ beta)

    return pd.DataFrame({
        "phi_rad": phi,
        "phi_deg": np.degrees(phi),
        "escape_probability": prob,
    })


def binned_escape_rate(phi: np.ndarray, y: np.ndarray, bins: int) -> pd.DataFrame:
    edges = np.linspace(-np.pi, np.pi, bins + 1)
    centers = 0.5 * (edges[:-1] + edges[1:])

    rows = []
    for i in range(bins):
        mask = (phi >= edges[i]) & (phi < edges[i + 1]) & np.isfinite(phi)
        n = int(mask.sum())
        if n:
            rate = float(y[mask].mean())
        else:
            rate = np.nan

        rows.append({
            "bin": i,
            "phi_center_rad": centers[i],
            "phi_center_deg": np.degrees(centers[i]),
            "n": n,
            "escape_rate": rate,
        })

    return pd.DataFrame(rows)


def plot_escape_rate(
    composite: str,
    binned: pd.DataFrame,
    curve: pd.DataFrame,
    figdir: Path,
) -> None:
    plt.figure(figsize=(10, 5))
    plt.scatter(binned["phi_center_deg"], binned["escape_rate"], s=35, label="binned escape rate")
    plt.plot(curve["phi_deg"], curve["escape_probability"], linewidth=2, label="logistic harmonic fit")
    plt.xlabel("Residual phase misalignment φ, degrees")
    plt.ylabel("Escape-window probability")
    plt.title(f"Phase-dependent escape rate: {composite}")
    plt.legend()
    plt.tight_layout()
    plt.savefig(figdir / f"escape_rate_curve_{composite}.png", dpi=200)
    plt.close()


def plot_summary(summary: pd.DataFrame, figdir: Path) -> None:
    s = summary.sort_values("lr_p", ascending=True)

    plt.figure(figsize=(11, 6))
    plt.bar(s["composite"], -np.log10(s["lr_p"].clip(lower=1e-12)))
    plt.ylabel("-log10 likelihood-ratio p")
    plt.xlabel("Composite")
    plt.title("Phase-dependent escape-rate significance")
    plt.xticks(rotation=55, ha="right")
    plt.tight_layout()
    plt.savefig(figdir / "escape_rate_significance.png", dpi=200)
    plt.close()

    s2 = summary.sort_values("alpha", ascending=False)

    plt.figure(figsize=(11, 6))
    plt.bar(s2["composite"], s2["alpha"])
    plt.ylabel("Modulation amplitude α = sqrt(βcos² + βsin²)")
    plt.xlabel("Composite")
    plt.title("Escape-rate phase modulation amplitude")
    plt.xticks(rotation=55, ha="right")
    plt.tight_layout()
    plt.savefig(figdir / "escape_rate_modulation_amplitude.png", dpi=200)
    plt.close()

    plt.figure(figsize=(11, 6))
    plt.bar(s2["composite"], s2["modulation_ratio_max_min"])
    plt.axhline(1.0, linestyle="--", linewidth=1)
    plt.ylabel("Max / min fitted escape probability")
    plt.xlabel("Composite")
    plt.title("Fitted phase-dependent escape-rate ratio")
    plt.xticks(rotation=55, ha="right")
    plt.tight_layout()
    plt.savefig(figdir / "escape_rate_ratio.png", dpi=200)
    plt.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", required=True)
    parser.add_argument("--out", default="outputs/phase_dependent_escape_rate")
    parser.add_argument("--r-q", type=float, default=DEFAULT_R_Q)
    parser.add_argument("--smooth-days", type=int, default=DEFAULT_SMOOTH_DAYS)
    parser.add_argument("--bins", type=int, default=DEFAULT_BINS)
    parser.add_argument("--escape-window", type=int, default=DEFAULT_ESCAPE_WINDOW)
    parser.add_argument("--min-well-dwell", type=int, default=DEFAULT_MIN_WELL_DWELL)
    args = parser.parse_args()

    out = Path(args.out)
    figdir = ensure_dirs(out)

    df = pd.read_csv(args.csv)
    df[DATE_COL] = pd.to_datetime(df[DATE_COL], errors="coerce")

    for col in [DATE_COL, THETA_COL, R_COL, proxy_col(SUN)]:
        if col not in df.columns:
            raise KeyError(f"Missing required column: {col}")

    theta = phase_to_radians(df[THETA_COL])
    R = pd.to_numeric(df[R_COL], errors="coerce").to_numpy(dtype=float)

    sun_phase = analytic_phase(
        pd.to_numeric(df[proxy_col(SUN)], errors="coerce").to_numpy(dtype=float),
        args.smooth_days,
    )
    theta_res = wrap_phase(theta - sun_phase)

    escape_points, escape_days, well_id = detect_escape_days(
        theta_res=theta_res,
        R=R,
        r_q=args.r_q,
        escape_window=args.escape_window,
        min_well_dwell=args.min_well_dwell,
    )

    required_bodies = sorted({b for weights in COMPOSITES.values() for b in weights})
    phase_map: dict[str, np.ndarray] = {}

    for body in required_bodies:
        col = proxy_col(body)
        if col not in df.columns:
            print(f"Skipping missing body: {body}")
            continue

        phase_map[body] = analytic_phase(
            pd.to_numeric(df[col], errors="coerce").to_numpy(dtype=float),
            args.smooth_days,
        )

    y = escape_days.astype(float)

    rows = []
    all_binned = []
    all_curves = []

    for composite, weights in COMPOSITES.items():
        if not all(b in phase_map for b in weights):
            print(f"Skipping {composite}: missing body")
            continue

        phi_comp = composite_phase(phase_map, weights)
        misalignment = wrap_phase(theta_res - phi_comp)

        beta, ll_full, ll_null, p = fit_logistic(misalignment, y)

        alpha = float(np.sqrt(beta[1] ** 2 + beta[2] ** 2))
        phi0 = float(np.arctan2(beta[2], beta[1]))
        phi0 = float(wrap_phase(phi0))

        curve = model_curve(beta)
        binned = binned_escape_rate(misalignment, y, args.bins)

        curve["composite"] = composite
        binned["composite"] = composite
        all_curves.append(curve)
        all_binned.append(binned)

        mean_prob = float(curve["escape_probability"].mean())
        max_prob = float(curve["escape_probability"].max())
        min_prob = float(curve["escape_probability"].min())

        rows.append(EscapeRateResult(
            composite=composite,
            bodies="+".join(weights.keys()),
            n_days=int(np.isfinite(misalignment).sum()),
            n_escape_days=int(escape_days.sum()),
            beta0=float(beta[0]),
            beta_cos=float(beta[1]),
            beta_sin=float(beta[2]),
            alpha=alpha,
            phi0_rad=phi0,
            phi0_deg=float(np.degrees(phi0)),
            loglike_full=float(ll_full),
            loglike_null=float(ll_null),
            likelihood_ratio=float(2.0 * (ll_full - ll_null)),
            lr_p=float(p),
            mean_escape_prob=mean_prob,
            max_escape_prob=max_prob,
            min_escape_prob=min_prob,
            modulation_ratio_max_min=float(max_prob / min_prob) if min_prob > 0 else np.nan,
        ).__dict__)

        plot_escape_rate(composite, binned, curve, figdir)

    summary = pd.DataFrame(rows).sort_values("lr_p", ascending=True)

    summary.to_csv(out / "phase_dependent_escape_rate_summary.csv", index=False)
    pd.concat(all_binned, ignore_index=True).to_csv(out / "binned_escape_rates.csv", index=False)
    pd.concat(all_curves, ignore_index=True).to_csv(out / "fitted_escape_rate_curves.csv", index=False)

    ts = pd.DataFrame({
        "date": df[DATE_COL],
        "theta_residual_minus_sun_rad": theta_res,
        "R": R,
        "well_id": well_id,
        "escape_point": escape_points,
        "escape_day": escape_days,
    })
    ts.to_csv(out / "escape_rate_timeseries.csv", index=False)

    plot_summary(summary, figdir)

    print("\n=== PHASE-DEPENDENT ESCAPE RATE SUMMARY ===")
    print(summary.to_string(index=False))
    print(f"\nEscape points: {escape_points.sum()}")
    print(f"Escape days: {escape_days.sum()}")
    print(f"Outputs written to: {out.resolve()}")


if __name__ == "__main__":
    main()