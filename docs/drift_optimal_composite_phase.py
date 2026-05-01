#!/usr/bin/env python3
"""
DRIFT Optimal Composite Planetary Phase Index

Purpose:
  Build an optimized non-solar composite planetary phase index:

      Phi(t) = arg(sum_i w_i exp(i phi_i(t)))

  Then compare phase misalignment:

      Δphi(t) = wrap(theta_residual(t) - Phi(t))

  during high-R and background states.

Usage:
  python drift_optimal_composite_phase.py \
    --csv drift.csv \
    --out outputs/optimal_composite_phase
"""

from __future__ import annotations

import argparse
import itertools
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy.signal import hilbert, savgol_filter
from scipy.optimize import differential_evolution


DATE_COL = "date"
THETA_COL = "θ (Phase) raw"
R_COL = "R(t) normalized"

SUN = "Sun"

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

DEFAULT_R_Q = 95.0
DEFAULT_SMOOTH_DAYS = 31
DEFAULT_SURROGATES = 3000
DEFAULT_MAX_BODIES = 4
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
    return wrap_phase(np.angle(hilbert(y)))


def phase_locking_value(a: np.ndarray, b: np.ndarray, mask: np.ndarray) -> float:
    valid = np.isfinite(a) & np.isfinite(b) & mask
    if valid.sum() < 10:
        return np.nan
    return float(np.abs(np.mean(np.exp(1j * wrap_phase(a[valid] - b[valid])))))


def composite_phase(phase_matrix: np.ndarray, weights: np.ndarray) -> np.ndarray:
    """
    phase_matrix shape: (n_bodies, n_time)
    """
    weights = np.asarray(weights, dtype=float)
    z = np.sum(weights[:, None] * np.exp(1j * phase_matrix), axis=0)
    return wrap_phase(np.angle(z))


def circular_shift_p(
    theta_res: np.ndarray,
    phi: np.ndarray,
    mask: np.ndarray,
    observed: float,
    n_surrogates: int,
    rng: np.random.Generator,
) -> float:
    n = len(phi)
    vals = []

    for _ in range(n_surrogates):
        shift = int(rng.integers(1, n - 1))
        shifted = np.roll(phi, shift)
        vals.append(phase_locking_value(theta_res, shifted, mask))

    vals = np.asarray(vals, dtype=float)
    vals = vals[np.isfinite(vals)]

    if len(vals) == 0:
        return np.nan

    return float((np.sum(vals >= observed) + 1) / (len(vals) + 1))


def resultant_length(delta: np.ndarray, mask: np.ndarray) -> float:
    valid = np.isfinite(delta) & mask
    if valid.sum() < 10:
        return np.nan
    return float(np.abs(np.mean(np.exp(1j * delta[valid]))))


def circular_concentration_contrast(theta_res: np.ndarray, phi: np.ndarray, high_R: np.ndarray) -> tuple[float, float, float]:
    delta = wrap_phase(theta_res - phi)
    high = resultant_length(delta, high_R)
    bg = resultant_length(delta, ~high_R & np.isfinite(theta_res))
    contrast = high - bg
    return high, bg, contrast


def optimize_weights(
    theta_res: np.ndarray,
    phase_matrix: np.ndarray,
    high_R: np.ndarray,
    penalty: float = 0.02,
) -> tuple[np.ndarray, float]:
    """
    Optimize weights to maximize high-R phase locking while penalizing
    background coherence and excessive weight complexity.

    Objective:
      maximize PLV_high - PLV_background - penalty * L2(weights)
    """

    n_bodies = phase_matrix.shape[0]

    def objective(w: np.ndarray) -> float:
        norm = np.linalg.norm(w)
        if norm == 0:
            return 1e6
        w = w / norm

        phi = composite_phase(phase_matrix, w)
        high, bg, contrast = circular_concentration_contrast(theta_res, phi, high_R)

        if not np.isfinite(contrast):
            return 1e6

        score = contrast - penalty * np.mean(w ** 2)
        return -score

    bounds = [(-2.0, 2.0)] * n_bodies

    result = differential_evolution(
        objective,
        bounds=bounds,
        seed=RNG_SEED,
        maxiter=800,
        popsize=20,
        polish=True,
        updating="immediate",
        workers=1,
        tol=1e-7,
    )

    w = result.x
    w = w / np.linalg.norm(w)

    return w, -float(result.fun)


def split_train_test(n: int, train_fraction: float = 0.65) -> tuple[np.ndarray, np.ndarray]:
    idx = np.arange(n)
    split = int(n * train_fraction)
    train = np.zeros(n, dtype=bool)
    test = np.zeros(n, dtype=bool)
    train[idx[:split]] = True
    test[idx[split:]] = True
    return train, test


def scan_body_combinations(
    theta_res: np.ndarray,
    phase_map: dict[str, np.ndarray],
    high_R: np.ndarray,
    bodies: list[str],
    max_bodies: int,
) -> pd.DataFrame:
    rows = []

    train_mask, test_mask = split_train_test(len(theta_res))

    for k in range(2, max_bodies + 1):
        for combo in itertools.combinations(bodies, k):
            phase_matrix = np.vstack([phase_map[b] for b in combo])

            high_train = high_R & train_mask
            high_test = high_R & test_mask

            try:
                weights, train_score = optimize_weights(
                    theta_res=theta_res,
                    phase_matrix=phase_matrix,
                    high_R=high_train,
                )
            except Exception:
                continue

            phi = composite_phase(phase_matrix, weights)

            raw_high, raw_bg, raw_contrast = circular_concentration_contrast(theta_res, phi, high_R)
            train_high, train_bg, train_contrast = circular_concentration_contrast(theta_res, phi, high_train)
            test_high, test_bg, test_contrast = circular_concentration_contrast(theta_res, phi, high_test)

            rows.append({
                "combo": "+".join(combo),
                "n_bodies": k,
                "weights": ";".join(f"{b}:{w:.6f}" for b, w in zip(combo, weights)),
                "all_high_plv": raw_high,
                "all_background_plv": raw_bg,
                "all_contrast": raw_contrast,
                "train_high_plv": train_high,
                "train_background_plv": train_bg,
                "train_contrast": train_contrast,
                "test_high_plv": test_high,
                "test_background_plv": test_bg,
                "test_contrast": test_contrast,
                "train_score": train_score,
            })

    out = pd.DataFrame(rows)

    if len(out):
        out = out.sort_values(
            ["test_contrast", "all_contrast"],
            ascending=[False, False],
            na_position="last",
        )

    return out


def parse_weights(weight_string: str) -> tuple[list[str], np.ndarray]:
    bodies = []
    weights = []

    for part in weight_string.split(";"):
        b, w = part.split(":")
        bodies.append(b)
        weights.append(float(w))

    return bodies, np.asarray(weights, dtype=float)


def phase_histogram_plot(delta: np.ndarray, high_R: np.ndarray, figdir: Path, label: str) -> None:
    plt.figure(figsize=(10, 5))
    plt.hist(delta[~high_R], bins=36, density=True, alpha=0.5, label="background")
    plt.hist(delta[high_R], bins=36, density=True, alpha=0.75, label="high-R")
    plt.xlabel("Phase misalignment Δφ = θ_res - Φ_composite")
    plt.ylabel("Density")
    plt.title(f"Phase misalignment distribution: {label}")
    plt.legend()
    plt.tight_layout()
    plt.savefig(figdir / "phase_misalignment_histogram.png", dpi=200)
    plt.close()


def time_series_plot(
    dates: pd.Series,
    theta_res: np.ndarray,
    phi: np.ndarray,
    R: np.ndarray,
    high_R: np.ndarray,
    figdir: Path,
) -> None:
    delta = wrap_phase(theta_res - phi)

    plt.figure(figsize=(14, 6))
    plt.plot(dates, delta, linewidth=0.8, label="Δφ residual misalignment")
    plt.scatter(dates[high_R], delta[high_R], s=14, label="high-R states")
    plt.axhline(0.0, linestyle="--", linewidth=1)
    plt.ylabel("Δφ radians")
    plt.xlabel("Date")
    plt.title("Composite phase misalignment through time")
    plt.legend()
    plt.tight_layout()
    plt.savefig(figdir / "phase_misalignment_timeseries.png", dpi=200)
    plt.close()

    plt.figure(figsize=(14, 6))
    plt.plot(dates, R, linewidth=0.8)
    plt.scatter(dates[high_R], R[high_R], s=14)
    plt.xlabel("Date")
    plt.ylabel("R(t) normalized")
    plt.title("High-R states used for composite phase optimization")
    plt.tight_layout()
    plt.savefig(figdir / "high_R_states_timeseries.png", dpi=200)
    plt.close()


def polar_phase_plot(delta: np.ndarray, high_R: np.ndarray, figdir: Path) -> None:
    plt.figure(figsize=(7, 7))
    ax = plt.subplot(111, projection="polar")

    bg = delta[~high_R & np.isfinite(delta)]
    hi = delta[high_R & np.isfinite(delta)]

    ax.scatter(bg, np.ones_like(bg), s=4, alpha=0.12, label="background")
    ax.scatter(hi, np.ones_like(hi) * 1.08, s=16, alpha=0.8, label="high-R")
    ax.set_title("Circular phase misalignment: background vs high-R")
    ax.set_yticklabels([])
    ax.legend(loc="upper right")

    plt.tight_layout()
    plt.savefig(figdir / "phase_misalignment_polar.png", dpi=200)
    plt.close()


def write_model_report(
    out: Path,
    best_row: pd.Series,
    p_value: float,
    high_plv: float,
    bg_plv: float,
    contrast: float,
) -> None:
    text = f"""# DRIFT Optimal Composite Phase Result

Best composite:
{best_row['combo']}

Weights:
{best_row['weights']}

All-data high-R PLV:
{high_plv:.6f}

All-data background PLV:
{bg_plv:.6f}

Contrast:
{contrast:.6f}

Circular-shift p:
{p_value:.6f}

Train contrast:
{best_row['train_contrast']:.6f}

Test contrast:
{best_row['test_contrast']:.6f}

Interpretive constraint:
The diagnostic is strongest if the test contrast remains positive and the
background PLV remains small. This indicates that phase locking is localized
to high-R instability states rather than being a continuous background
coherence.
"""
    (out / "model_report.md").write_text(text)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", required=True)
    parser.add_argument("--out", default="outputs/optimal_composite_phase")
    parser.add_argument("--r-q", type=float, default=DEFAULT_R_Q)
    parser.add_argument("--smooth-days", type=int, default=DEFAULT_SMOOTH_DAYS)
    parser.add_argument("--surrogates", type=int, default=DEFAULT_SURROGATES)
    parser.add_argument("--max-bodies", type=int, default=DEFAULT_MAX_BODIES)
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

    available = [b for b in BODIES if proxy_col(b) in df.columns]

    phase_map = {}
    for body in available:
        phase_map[body] = analytic_phase(
            pd.to_numeric(df[proxy_col(body)], errors="coerce").to_numpy(dtype=float),
            args.smooth_days,
        )

    print(f"Available non-solar bodies: {', '.join(available)}")
    print(f"High-R threshold: q={args.r_q}, value={R_thr:.6g}")
    print(f"High-R days: {high_R.sum()} / {len(high_R)}")

    scan = scan_body_combinations(
        theta_res=theta_res,
        phase_map=phase_map,
        high_R=high_R,
        bodies=available,
        max_bodies=args.max_bodies,
    )

    if len(scan) == 0:
        raise RuntimeError("No valid body combinations were optimized.")

    scan.to_csv(out / "optimized_composite_scan.csv", index=False)

    best = scan.iloc[0]
    best_bodies, best_weights = parse_weights(best["weights"])

    phase_matrix = np.vstack([phase_map[b] for b in best_bodies])
    phi_best = composite_phase(phase_matrix, best_weights)

    high_plv, bg_plv, contrast = circular_concentration_contrast(theta_res, phi_best, high_R)
    p_value = circular_shift_p(
        theta_res,
        phi_best,
        high_R,
        high_plv,
        args.surrogates,
        rng,
    )

    delta = wrap_phase(theta_res - phi_best)

    out_ts = pd.DataFrame({
        "date": df[DATE_COL],
        "theta_residual_minus_sun_rad": theta_res,
        "optimal_composite_phase_rad": phi_best,
        "phase_misalignment_rad": delta,
        "R": R,
        "high_R": high_R,
    })

    out_ts.to_csv(out / "optimal_composite_timeseries.csv", index=False)

    phase_histogram_plot(delta, high_R, figdir, best["combo"])
    polar_phase_plot(delta, high_R, figdir)
    time_series_plot(df[DATE_COL], theta_res, phi_best, R, high_R, figdir)

    top = scan.head(30).copy()

    plt.figure(figsize=(16, 7))
    plt.bar(top["combo"], top["test_contrast"])
    plt.ylabel("Out-of-sample test contrast")
    plt.xlabel("Composite")
    plt.title("Optimized non-solar composite phase index: test contrast")
    plt.xticks(rotation=70, ha="right")
    plt.tight_layout()
    plt.savefig(figdir / "optimized_composite_test_contrast.png", dpi=200)
    plt.close()

    write_model_report(out, best, p_value, high_plv, bg_plv, contrast)

    print("\n=== BEST COMPOSITE ===")
    print(best.to_string())

    print("\n=== FINAL DIAGNOSTIC ===")
    print(f"High-R PLV:       {high_plv:.6f}")
    print(f"Background PLV:   {bg_plv:.6f}")
    print(f"Contrast:         {contrast:.6f}")
    print(f"Circular-shift p: {p_value:.6f}")

    print(f"\nOutputs written to: {out.resolve()}")


if __name__ == "__main__":
    main()