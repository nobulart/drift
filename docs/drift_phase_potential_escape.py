#!/usr/bin/env python3
"""
DRIFT Phase Potential and Escape Analysis

Purpose:
  Estimate whether DRIFT residual phase occupies metastable wells and whether
  high-R transition events correspond to escape-like phase slips.

  Solar phase is removed first:
      theta_res = wrap(theta - phi_sun)

  Then the script:
    1. estimates empirical phase potential V(theta) = -log P(theta)
    2. identifies stable wells and barriers
    3. detects escape events from well changes
    4. tests whether planetary composite phase misalignment modulates escape risk

Usage:
  python drift_phase_potential_escape.py \
    --csv drift.csv \
    --out outputs/phase_potential_escape
"""

from __future__ import annotations

import argparse
from pathlib import Path
from dataclasses import dataclass

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy.signal import hilbert, savgol_filter, find_peaks
from scipy.ndimage import gaussian_filter1d
from scipy.stats import mannwhitneyu


DATE_COL = "date"
THETA_COL = "θ (Phase) raw"
R_COL = "R(t) normalized"
SUN = "Sun"

DEFAULT_R_Q = 95.0
DEFAULT_SMOOTH_DAYS = 31
DEFAULT_BINS = 72
DEFAULT_DENSITY_SMOOTH = 2.0
DEFAULT_ESCAPE_WINDOW = 45
DEFAULT_MIN_WELL_DWELL = 20
EPS = 1e-12


COMPOSITES = {
    "Venus_Mars": {"Venus": 1.0, "Mars": 1.0},
    "Mercury_Venus_Mars": {"Mercury": 1.0, "Venus": 1.0, "Mars": 1.0},
    "Venus_Mars_Jupiter": {"Venus": 1.0, "Mars": 1.0, "Jupiter": 1.0},
    "All_NonSolar_Major": {
        "Mercury": 1.0, "Venus": 1.0, "Mars": 1.0,
        "Jupiter": 1.0, "Saturn": 1.0, "Uranus": 1.0,
        "Neptune": 1.0, "Moon": 1.0,
    },
}


@dataclass
class EscapeCompositeResult:
    composite: str
    bodies: str
    escape_days: int
    nonescape_days: int
    mean_alignment_escape: float
    mean_alignment_nonescape: float
    median_alignment_escape: float
    median_alignment_nonescape: float
    mannwhitney_p: float
    escape_alignment_enrichment: float


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


def circular_distance(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return np.abs(wrap_phase(a - b))


def circular_alignment(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """
    Alignment score in [0, 1].
      1 = same phase
      0 = opposite phase
    """
    return 0.5 * (1.0 + np.cos(wrap_phase(a - b)))


def estimate_phase_potential(theta: np.ndarray, bins: int, smooth_sigma: float) -> pd.DataFrame:
    valid = np.isfinite(theta)
    edges = np.linspace(-np.pi, np.pi, bins + 1)
    counts, _ = np.histogram(theta[valid], bins=edges)

    density = counts.astype(float) + EPS
    density = density / density.sum()

    # Circular smoothing by wrap mode
    density_s = gaussian_filter1d(density, sigma=smooth_sigma, mode="wrap")
    density_s = density_s / density_s.sum()

    V = -np.log(density_s + EPS)
    V = V - np.nanmin(V)

    centers = 0.5 * (edges[:-1] + edges[1:])

    return pd.DataFrame({
        "theta_center_rad": centers,
        "theta_center_deg": np.degrees(centers),
        "density": density_s,
        "potential": V,
    })


def identify_wells_and_barriers(potential_df: pd.DataFrame) -> pd.DataFrame:
    V = potential_df["potential"].to_numpy()
    theta = potential_df["theta_center_rad"].to_numpy()

    # Wells are minima of V = peaks of -V
    wells, _ = find_peaks(-V, distance=3)
    barriers, _ = find_peaks(V, distance=3)

    rows = []

    for wi in wells:
        # nearest barrier clockwise and counterclockwise
        left_candidates = barriers[barriers < wi]
        right_candidates = barriers[barriers > wi]

        left = left_candidates[-1] if len(left_candidates) else barriers[-1] if len(barriers) else np.nan
        right = right_candidates[0] if len(right_candidates) else barriers[0] if len(barriers) else np.nan

        left_barrier = V[int(left)] if np.isfinite(left) else np.nan
        right_barrier = V[int(right)] if np.isfinite(right) else np.nan
        well_depth = V[wi]

        barrier_height = np.nanmin([left_barrier, right_barrier]) - well_depth

        rows.append({
            "well_index": int(wi),
            "well_theta_rad": float(theta[wi]),
            "well_theta_deg": float(np.degrees(theta[wi])),
            "well_potential": float(well_depth),
            "left_barrier_index": int(left) if np.isfinite(left) else -1,
            "right_barrier_index": int(right) if np.isfinite(right) else -1,
            "left_barrier_potential": float(left_barrier),
            "right_barrier_potential": float(right_barrier),
            "barrier_height_min": float(barrier_height),
        })

    return pd.DataFrame(rows).sort_values("barrier_height_min", ascending=False)


def assign_well(theta: np.ndarray, wells_df: pd.DataFrame) -> np.ndarray:
    wells = wells_df["well_theta_rad"].to_numpy(dtype=float)
    assigned = np.full(len(theta), -1, dtype=int)

    for i, th in enumerate(theta):
        if not np.isfinite(th) or len(wells) == 0:
            continue
        distances = np.abs(wrap_phase(th - wells))
        assigned[i] = int(np.argmin(distances))

    return assigned


def detect_escape_events(
    well_id: np.ndarray,
    R: np.ndarray,
    r_q: float,
    min_well_dwell: int,
    escape_window: int,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Escape event = persistent change in assigned well near elevated R.

    Returns:
      escape_points: exact change-point days
      escape_window_mask: ±escape_window around escape points
    """
    valid_R = np.isfinite(R)
    r_thr = np.nanpercentile(R[valid_R], r_q)

    escape_points = np.zeros(len(well_id), dtype=bool)

    last_well = well_id[0]
    dwell = 0

    for i in range(1, len(well_id)):
        if well_id[i] == last_well:
            dwell += 1
            continue

        if well_id[i] >= 0 and last_well >= 0 and dwell >= min_well_dwell:
            # Require elevated R near the well change
            lo = max(0, i - escape_window)
            hi = min(len(well_id), i + escape_window + 1)
            if np.nanmax(R[lo:hi]) >= r_thr:
                escape_points[i] = True

        last_well = well_id[i]
        dwell = 0

    escape_mask = np.zeros(len(well_id), dtype=bool)
    idx = np.where(escape_points)[0]

    for i in idx:
        lo = max(0, i - escape_window)
        hi = min(len(well_id), i + escape_window + 1)
        escape_mask[lo:hi] = True

    return escape_points, escape_mask


def plot_potential(potential_df: pd.DataFrame, wells_df: pd.DataFrame, figdir: Path) -> None:
    plt.figure(figsize=(10, 5))
    plt.plot(potential_df["theta_center_deg"], potential_df["potential"], linewidth=1.5)

    for _, row in wells_df.iterrows():
        plt.scatter(row["well_theta_deg"], row["well_potential"], s=50)
        plt.text(row["well_theta_deg"], row["well_potential"], f"W{int(row['well_index'])}", fontsize=8)

    plt.xlabel("Residual phase θ_res, degrees")
    plt.ylabel("Empirical potential V(θ) = -log P(θ)")
    plt.title("DRIFT residual phase potential")
    plt.tight_layout()
    plt.savefig(figdir / "phase_potential.png", dpi=200)
    plt.close()


def plot_well_timeline(dates: pd.Series, well_id: np.ndarray, R: np.ndarray, escape_points: np.ndarray, figdir: Path) -> None:
    plt.figure(figsize=(14, 6))
    plt.plot(dates, well_id, linewidth=0.8, label="assigned well")
    plt.scatter(dates[escape_points], well_id[escape_points], s=35, label="escape events")
    plt.xlabel("Date")
    plt.ylabel("Well ID")
    plt.title("Assigned phase-potential well through time")
    plt.legend()
    plt.tight_layout()
    plt.savefig(figdir / "well_assignment_timeline.png", dpi=200)
    plt.close()

    plt.figure(figsize=(14, 6))
    plt.plot(dates, R, linewidth=0.8, label="R(t)")
    plt.scatter(dates[escape_points], R[escape_points], s=35, label="escape events")
    plt.xlabel("Date")
    plt.ylabel("R(t) normalized")
    plt.title("Escape events over R(t)")
    plt.legend()
    plt.tight_layout()
    plt.savefig(figdir / "escape_events_over_R.png", dpi=200)
    plt.close()


def plot_alignment_hist(name: str, alignment: np.ndarray, escape_mask: np.ndarray, figdir: Path) -> None:
    plt.figure(figsize=(9, 5))
    plt.hist(alignment[~escape_mask & np.isfinite(alignment)], bins=40, density=True, alpha=0.5, label="non-escape")
    plt.hist(alignment[escape_mask & np.isfinite(alignment)], bins=40, density=True, alpha=0.75, label="escape-window")
    plt.xlabel("Planetary composite alignment score")
    plt.ylabel("Density")
    plt.title(f"Escape-window alignment: {name}")
    plt.legend()
    plt.tight_layout()
    plt.savefig(figdir / f"escape_alignment_{name}.png", dpi=200)
    plt.close()


def plot_summary(summary: pd.DataFrame, figdir: Path) -> None:
    s = summary.sort_values("escape_alignment_enrichment", ascending=False)

    plt.figure(figsize=(11, 6))
    plt.bar(s["composite"], s["escape_alignment_enrichment"])
    plt.axhline(1.0, linestyle="--", linewidth=1)
    plt.ylabel("Mean escape alignment / non-escape alignment")
    plt.xlabel("Composite")
    plt.title("Planetary alignment enrichment during escape windows")
    plt.xticks(rotation=60, ha="right")
    plt.tight_layout()
    plt.savefig(figdir / "escape_alignment_enrichment.png", dpi=200)
    plt.close()

    s2 = summary.sort_values("mannwhitney_p", ascending=True)

    plt.figure(figsize=(11, 6))
    plt.bar(s2["composite"], -np.log10(s2["mannwhitney_p"].clip(lower=1e-12)))
    plt.ylabel("-log10 Mann-Whitney p")
    plt.xlabel("Composite")
    plt.title("Escape vs non-escape alignment significance")
    plt.xticks(rotation=60, ha="right")
    plt.tight_layout()
    plt.savefig(figdir / "escape_alignment_significance.png", dpi=200)
    plt.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", required=True)
    parser.add_argument("--out", default="outputs/phase_potential_escape")
    parser.add_argument("--r-q", type=float, default=DEFAULT_R_Q)
    parser.add_argument("--smooth-days", type=int, default=DEFAULT_SMOOTH_DAYS)
    parser.add_argument("--bins", type=int, default=DEFAULT_BINS)
    parser.add_argument("--density-smooth", type=float, default=DEFAULT_DENSITY_SMOOTH)
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

    potential_df = estimate_phase_potential(theta_res, args.bins, args.density_smooth)
    wells_df = identify_wells_and_barriers(potential_df)

    well_id = assign_well(theta_res, wells_df)
    escape_points, escape_mask = detect_escape_events(
        well_id=well_id,
        R=R,
        r_q=args.r_q,
        min_well_dwell=args.min_well_dwell,
        escape_window=args.escape_window,
    )

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

    rows = []

    for name, weights in COMPOSITES.items():
        if not all(b in phase_map for b in weights):
            print(f"Skipping {name}: missing body")
            continue

        phi = composite_phase(phase_map, weights)
        alignment = circular_alignment(theta_res, phi)

        esc = alignment[escape_mask & np.isfinite(alignment)]
        non = alignment[~escape_mask & np.isfinite(alignment)]

        if len(esc) > 10 and len(non) > 10:
            _, p = mannwhitneyu(esc, non, alternative="two-sided")
        else:
            p = np.nan

        mean_esc = float(np.mean(esc)) if len(esc) else np.nan
        mean_non = float(np.mean(non)) if len(non) else np.nan

        enrichment = mean_esc / mean_non if mean_non and np.isfinite(mean_non) else np.nan

        rows.append(EscapeCompositeResult(
            composite=name,
            bodies="+".join(weights.keys()),
            escape_days=int(escape_mask.sum()),
            nonescape_days=int((~escape_mask).sum()),
            mean_alignment_escape=mean_esc,
            mean_alignment_nonescape=mean_non,
            median_alignment_escape=float(np.median(esc)) if len(esc) else np.nan,
            median_alignment_nonescape=float(np.median(non)) if len(non) else np.nan,
            mannwhitney_p=float(p),
            escape_alignment_enrichment=float(enrichment),
        ).__dict__)

        plot_alignment_hist(name, alignment, escape_mask, figdir)

    summary = pd.DataFrame(rows).sort_values(
        ["mannwhitney_p", "escape_alignment_enrichment"],
        ascending=[True, False],
        na_position="last",
    )

    potential_df.to_csv(out / "phase_potential.csv", index=False)
    wells_df.to_csv(out / "phase_wells_and_barriers.csv", index=False)
    summary.to_csv(out / "escape_alignment_summary.csv", index=False)

    ts = pd.DataFrame({
        "date": df[DATE_COL],
        "theta_residual_minus_sun_rad": theta_res,
        "R": R,
        "well_id": well_id,
        "escape_point": escape_points,
        "escape_window": escape_mask,
    })
    ts.to_csv(out / "escape_timeseries.csv", index=False)

    plot_potential(potential_df, wells_df, figdir)
    plot_well_timeline(df[DATE_COL], well_id, R, escape_points, figdir)
    plot_summary(summary, figdir)

    print("\n=== PHASE WELLS AND BARRIERS ===")
    print(wells_df.to_string(index=False))

    print("\n=== ESCAPE ALIGNMENT SUMMARY ===")
    print(summary.to_string(index=False))

    print(f"\nEscape event points: {escape_points.sum()}")
    print(f"Escape-window days: {escape_mask.sum()}")
    print(f"Outputs written to: {out.resolve()}")


if __name__ == "__main__":
    main()