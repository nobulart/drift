#!/usr/bin/env python3
"""
compute_rolling_stats.py

Compute time-resolved state-space diagnostics for DRIFT dashboard:
- Rolling PCA for time-local principal axes
- Phase angle θ(t) and angular velocity ω(t)
- Turning point detection
- Orthogonal deviation ratio R(t)
- Dance segment extraction
"""

import json
import numpy as np
import sys
from typing import List, Tuple, Dict, Any
from scipy.signal import savgol_filter
from scipy.interpolate import interp1d
import pandas as pd
import random


def nan_to_none(obj: Any) -> Any:
    """Recursively replace NaN values with None for JSON serialization."""
    if isinstance(obj, dict):
        return {k: nan_to_none(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [nan_to_none(item) for item in obj]
    elif isinstance(obj, float) and np.isnan(obj):
        return None
    elif isinstance(obj, np.floating) and np.isnan(obj):
        return None
    return obj


def random_shuffle_indices(n: int) -> List[int]:
    """Shuffle indices from 0 to n-1."""
    indices = list(range(n))
    random.shuffle(indices)
    return indices


def detrend(x: np.ndarray, t: np.ndarray) -> np.ndarray:
    """Remove linear drift from x using polyfit."""
    coeffs = np.polyfit(t, x, 1)
    return x - np.polyval(coeffs, t)


def rolling_pca(
    x_res: np.ndarray, y_res: np.ndarray, t: np.ndarray, window_days: float = 365
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Compute time-local principal axes using sliding window.

    Returns:
        e1: Time series of principal eigenvectors [n, 2]
        e2: Time series of secondary eigenvectors [n, 2]
    """
    n = len(t)
    e1 = np.zeros((n, 2))
    e2 = np.zeros((n, 2))

    half_window = window_days / 2.0

    for i in range(n):
        # Select data within window
        mask = np.abs(t - t[i]) <= half_window
        x_window = x_res[mask]
        y_window = y_res[mask]

        if len(x_window) < 2:
            # Fallback to global if not enough points
            e1[i] = [1, 0]
            e2[i] = [0, 1]
            continue

        # Compute covariance matrix
        cov = np.cov(np.vstack([x_window, y_window]))

        # Eigen decomposition
        eigvals, eigvecs = np.linalg.eigh(cov)

        # Sort by eigenvalue (descending)
        idx = np.argsort(eigvals)[::-1]
        eigvecs = eigvecs[:, idx]

        e1[i] = eigvecs[:, 0]
        e2[i] = eigvecs[:, 1]

    return e1, e2


def compute_centers(
    x_res: np.ndarray,
    y_res: np.ndarray,
    t: np.ndarray,
    window_days: float = 60,
    step_days: float = 5,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Compute local centroids of motion using sliding window.

    Returns:
        cx: Center x coordinates at each timestep
        cy: Center y coordinates at each timestep
        center_times: Time values for centers
    """
    n = len(t)
    cx = np.zeros(n)
    cy = np.zeros(n)

    half_window = window_days / 2.0

    for i in range(n):
        mask = np.abs(t - t[i]) <= half_window
        cx[i] = np.mean(x_res[mask])
        cy[i] = np.mean(y_res[mask])

    return cx, cy, t.copy()


def compute_theta(cx: np.ndarray, cy: np.ndarray) -> np.ndarray:
    """Compute phase angle of loop centers with unwrapping and smoothing."""
    theta = np.arctan2(cy, cx)
    theta = np.unwrap(theta)
    theta = savgol_filter(theta, window_length=31, polyorder=3)
    return theta


def compute_omega(theta: np.ndarray, t: np.ndarray) -> np.ndarray:
    """Compute angular velocity as time derivative of theta."""
    dt = np.gradient(t)
    omega = np.gradient(theta) / dt
    omega = savgol_filter(omega, window_length=21, polyorder=3)
    return omega


def detect_turning_points(omega: np.ndarray, threshold: float = 0.05) -> np.ndarray:
    """
    Detect turning points where |omega| < threshold.
    Returns indices of turning point centers.
    """
    mask = np.abs(omega) < threshold

    if not np.any(mask):
        return np.array([], dtype=int)

    # Find contiguous regions
    # Convert to int for easier processing
    mask_int = mask.astype(int)

    # Find transitions
    diff = np.diff(mask_int, prepend=0, append=0)

    # Find start and end indices of True regions
    starts = np.where(diff == 1)[0]
    ends = np.where(diff == -1)[0]

    turning_points = []
    for start, end in zip(starts, ends):
        if end > start:
            # Center of the region
            center = (start + end) // 2
            turning_points.append(center)

    return np.array(turning_points, dtype=int)


def detect_states(
    omega: np.ndarray, theta: np.ndarray, turn_threshold: float = 0.05
) -> np.ndarray:
    """
    Detect dynamical states based on omega magnitude and theta phase.

    States:
    - 0: Stable (high |omega|, far from turning points)
    - 1: Pre-Transition (|omega| decreasing toward threshold)
    - 2: Transition (|omega| < threshold, actual turning point)
    - 3: Post-Transition (|omega| increasing away from threshold)

    Returns:
        state: Integer state label at each timestep [n]
    """
    n = len(omega)
    state = np.zeros(n, dtype=int)

    # Compute |omega| and identify regions near threshold
    omega_abs = np.abs(omega)
    near_tp = omega_abs < turn_threshold

    # Find contiguous turning point regions
    near_tp_int = near_tp.astype(int)
    diff = np.diff(near_tp_int, prepend=0, append=0)
    starts = np.where(diff == 1)[0]
    ends = np.where(diff == -1)[0]

    # Initialize state array
    # Default: 0 = Stable (high omega)
    state[:] = 0

    # Mark transition regions
    for start, end in zip(starts, ends):
        if end <= start:
            continue

        # Fill the entire region with state 2 (Transition)
        region_len = end - start
        if region_len >= 1:
            # Pre-transition: first half
            pre_end = start + region_len // 3
            state[start:pre_end] = 1

            # Transition: middle
            trans_start = pre_end
            trans_end = start + 2 * region_len // 3
            state[trans_start:trans_end] = 2

            # Post-transition: last half
            post_start = trans_end
            state[post_start:end] = 3

    # Also mark high-omega regions as stable (state 0 already set)
    # This ensures regions with |omega| > threshold are state 0
    state[omega_abs >= turn_threshold * 1.5] = 0

    return state


def extract_dance_segments(
    x_res: np.ndarray,
    y_res: np.ndarray,
    t: np.ndarray,
    turning_points: np.ndarray,
    window_days: float = 120,
) -> List[Dict[str, Any]]:
    """Extract trajectory segments around turning points."""
    segments = []
    half_window = window_days / 2.0

    for tp_idx in turning_points:
        tp_time = t[tp_idx]

        # Find indices within window
        mask = (t >= tp_time - half_window) & (t <= tp_time + half_window)
        x_seg = x_res[mask]
        y_seg = y_res[mask]

        if len(x_seg) < 3:
            continue

        # Compute polygon area
        area = polygon_area(x_seg, y_seg)

        # Compute R ratio
        cov = np.cov(np.vstack([x_seg, y_seg]))
        eigvals = np.linalg.eigvals(cov)
        r_ratio = np.min(np.abs(eigvals)) / np.max(np.abs(eigvals))

        segments.append(
            {
                "startIndex": int(np.where(mask)[0][0]),
                "endIndex": int(np.where(mask)[0][-1]),
                "centerTime": float(tp_time),
                "x": x_seg.tolist(),
                "y": y_seg.tolist(),
                "area": float(area),
                "rRatio": float(r_ratio),
            }
        )

    return segments


def polygon_area(x: np.ndarray, y: np.ndarray) -> float:
    """Compute area of polygon using shoelace formula."""
    return 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))


def compute_r_ratio(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Compute orthogonal deviation ratio R(t) at each timestep."""
    n = len(x)
    r_ratio = np.zeros(n)

    # Add padding for edge handling
    pad = 20
    r_ratio[:pad] = np.nan
    r_ratio[-pad:] = np.nan

    for i in range(pad, n - pad):
        # Use local window for R ratio
        window_size = min(365, i + 1)
        x_win = x[max(0, i - window_size + 1) : i + 1]
        y_win = y[max(0, i - window_size + 1) : i + 1]

        if len(x_win) < 2:
            r_ratio[i] = np.nan
            continue

        cov = np.cov(np.vstack([x_win, y_win]))
        eigvals = np.linalg.eigvals(cov)
        r_ratio[i] = np.min(np.abs(eigvals)) / np.max(np.abs(eigvals))

    # Interpolate to fill NaN edges
    r_ratio = pd.Series(r_ratio).interpolate().values

    # Forward-fill and backward-fill remaining NaNs (pandas compatible)
    r_ratio = pd.Series(r_ratio).ffill().bfill().values

    return r_ratio


def compute_drift_axis_rolling(
    x_res: np.ndarray,
    y_res: np.ndarray,
    t: np.ndarray,
    window_days: float = 1825.0,
) -> np.ndarray:
    """
    Compute rolling drift axis using PCA with sign stabilization.

    Args:
        x_res, y_res: Detrended coordinates
        t: Time array
        window_days: Rolling window size in days

    Returns:
        drift_axis: Time-varying drift axis [n, 3] where z=0 for 2D
    """
    n = len(t)
    drift = np.zeros((n, 2))

    half_window = window_days / 2.0

    for i in range(n):
        mask = np.abs(t - t[i]) <= half_window
        x_window = x_res[mask]
        y_window = y_res[mask]

        if len(x_window) < 2:
            drift[i] = [1, 0]
            continue

        cov = np.cov(np.vstack([x_window, y_window]))
        eigvals, eigvecs = np.linalg.eigh(cov)
        idx = np.argsort(eigvals)[::-1]
        eigvecs = eigvecs[:, idx]
        drift[i] = eigvecs[:, 0]

    # --- STEP 1: enforce vector sign continuity ---
    for i in range(1, len(drift)):
        if np.dot(drift[i], drift[i - 1]) < 0:
            drift[i] *= -1

    # Return drift as 2D unit vectors (no longitude conversion)
    drift_axis = np.zeros((n, 3))
    drift_axis[:, 0] = drift[:, 0]
    drift_axis[:, 1] = drift[:, 1]

    return drift_axis


def safe_unit(v):
    n = np.linalg.norm(v)
    if n < 1e-10:
        return None
    return v / n


def compute_lag_model(
    lon: np.ndarray,
    alignment: np.ndarray,
    R: np.ndarray,
    t: np.ndarray,
    turning_points: np.ndarray,
    H: int = 30,
    lag_max: int = 180,
) -> Dict[str, Any]:
    """
    Compute Turning Point → Response Lag Model.

    Quantifies whether Turning Points precede measurable system response.

    Args:
        lon: Drift longitude time series (degrees)
        alignment: Alignment angle time series (degrees)
        R: Orthogonal deviation ratio
        t: Time array (days)
        turning_points: Indices of turning points
        H: Horizon for response computation (days)
        lag_max: Maximum lag to test (days)

    Returns:
        Dictionary with lag analysis results
    """
    n = len(lon)

    # Convert lon to radians for continuity
    lon_rad = lon * np.pi / 180.0
    lon_rad = np.unwrap(lon_rad)
    lon_unwrapped = lon_rad * 180.0 / np.pi

    # Drift response: forward difference over horizon H (SIGNED)
    drift_response = np.full(n, np.nan)
    for i in range(n - H):
        drift_response[i] = lon_unwrapped[i + H] - lon_unwrapped[i]

    # Exclude contaminated 0-5 day lag region
    lag_min = 5
    lags = list(range(lag_min, lag_max + 1))

    # Compute conditional response at each lag (signal)
    lag_scores = []
    for lag in lags:
        values = []
        for idx in turning_points:
            j = idx + lag
            if j < n and not np.isnan(drift_response[j]):
                values.append(drift_response[j])
        if values:
            lag_scores.append(np.mean(values))
        else:
            lag_scores.append(np.nan)
    lag_scores = np.array(lag_scores)

    # Random baseline
    rand_indices = random_shuffle_indices(n)
    rand_indices = rand_indices[: len(turning_points)]

    baseline_scores = []
    for lag in lags:
        values = []
        for idx in rand_indices:
            j = idx + lag
            if j < n and not np.isnan(drift_response[j]):
                values.append(drift_response[j])
        if values:
            baseline_scores.append(np.mean(values))
        else:
            baseline_scores.append(np.nan)
    baseline_scores = np.array(baseline_scores)

    # Normalize signals
    def normalize(arr: np.ndarray) -> np.ndarray:
        valid = arr[~np.isnan(arr)]
        if len(valid) == 0:
            return arr
        mean = np.mean(valid)
        std = np.std(valid)
        return (arr - mean) / (std if std > 0 else 1)

    signal = normalize(lag_scores)
    baseline = normalize(baseline_scores)

    result = {
        "lags": lags,
        "signal": signal.tolist(),
        "baseline": baseline.tolist(),
        "raw_signal": lag_scores.tolist(),
        "raw_baseline": baseline_scores.tolist(),
        "drift_response": drift_response.tolist(),
    }

    return nan_to_none(result)


def compute_conditional_lag_model(
    lon: np.ndarray,
    theta: np.ndarray,
    omega: np.ndarray,
    R: np.ndarray,
    t: np.ndarray,
    turning_points: np.ndarray,
    state: np.ndarray,
    H: int = 30,
    lag_max: int = 180,
    n_phase_bins: int = 6,
    target_state: int = 1,
) -> Dict[str, Any]:
    """
    Compute Conditional Lag Response: P(response | turning point, state, phase)

    Isolates true dynamical response from background autocorrelation by conditioning
    on phase and dynamical state.

    Args:
        lon: Drift longitude time series (degrees)
        theta: Phase angle time series (radians)
        omega: Angular velocity time series
        R: Orthogonal deviation ratio
        t: Time array (days)
        turning_points: Indices of turning points
        state: State labels at each timestep [n]
        H: Horizon for response computation (days)
        lag_max: Maximum lag to test (days)
        n_phase_bins: Number of phase bins (-pi to +pi)
        target_state: State to condition on (0=Stable, 1=Pre, 2=Transition, 3=Post)

    Returns:
        Dictionary with conditional lag analysis results
    """
    n = len(lon)

    # Unwrap longitude for continuity
    lon_rad = lon * np.pi / 180.0
    lon_rad = np.unwrap(lon_rad)
    lon_unwrapped = lon_rad * 180.0 / np.pi

    # Response: signed forward difference
    response = np.full(n, np.nan)
    for i in range(n - H):
        response[i] = lon_unwrapped[i + H] - lon_unwrapped[i]

    # Phase binning
    phase_bins = np.linspace(-np.pi, np.pi, n_phase_bins + 1)
    phase_idx = np.digitize(theta, phase_bins) - 1
    phase_idx = np.clip(phase_idx, 0, n_phase_bins - 1)

    # Exclude contaminated 0-5 day lag region
    lag_min = 5
    lags = list(range(lag_min, lag_max + 1))

    # State filtering
    state_mask = state == target_state

    # Find turning points that also match target state
    tp_list = []
    for tp in turning_points:
        if tp < len(state) and state[tp] == target_state:
            tp_list.append(tp)
    tp_idx = np.array(tp_list, dtype=int)

    if len(tp_idx) == 0:
        # No qualifying turning points
        return {
            "lags": lags,
            "phase_bins": phase_bins.tolist(),
            "signal": [[np.nan] * n_phase_bins] * len(lags),
            "baseline": [[np.nan] * n_phase_bins] * len(lags),
        }

    # 3D structure: (lag × phase_bin)
    lag_phase_matrix = np.full((len(lags), n_phase_bins), np.nan)

    for i, lag in enumerate(lags):
        for p in range(n_phase_bins):
            values = []

            for idx in tp_idx:
                j = idx + lag
                if j >= len(response):
                    continue
                if phase_idx[idx] != p:
                    continue
                val = response[j]
                if not np.isnan(val):
                    values.append(val)

            if values:
                lag_phase_matrix[i, p] = np.mean(values)

    # Normalize per phase bin (z-score each column)
    for p in range(n_phase_bins):
        col = lag_phase_matrix[:, p]
        valid = col[~np.isnan(col)]
        if len(valid) > 0:
            mean = np.mean(valid)
            std = np.std(valid)
            lag_phase_matrix[:, p] = (col - mean) / (std if std > 0 else 1)

    # Baseline: random selection matching turning point count
    baseline_matrix = np.full_like(lag_phase_matrix, np.nan)

    rand_idx = np.random.choice(len(response), size=len(tp_idx), replace=False)

    for i, lag in enumerate(lags):
        for p in range(n_phase_bins):
            values = []

            for idx in rand_idx:
                j = idx + lag
                if j >= len(response):
                    continue
                if phase_idx[idx] != p:
                    continue
                val = response[j]
                if not np.isnan(val):
                    values.append(val)

            if values:
                baseline_matrix[i, p] = np.mean(values)

    # Normalize baseline per phase bin
    for p in range(n_phase_bins):
        col = baseline_matrix[:, p]
        valid = col[~np.isnan(col)]
        if len(valid) > 0:
            mean = np.mean(valid)
            std = np.std(valid)
            baseline_matrix[:, p] = (col - mean) / (std if std > 0 else 1)

    # === LAG KERNEL EXTRACTION ===
    # Convert to positive lag kernel (only positive responses)
    lag_kernel = np.maximum(lag_phase_matrix, 0)

    # Normalize per phase bin to sum = 1 (probability distribution)
    for p in range(n_phase_bins):
        col_sum = np.sum(lag_kernel[:, p])
        if col_sum > 0:
            lag_kernel[:, p] /= col_sum
        else:
            # Uniform distribution if all zeros
            lag_kernel[:, p] = 1.0 / len(lags)

    # Apply Gaussian smoothing (sigma=1.0)
    from scipy.ndimage import gaussian_filter

    lag_kernel = gaussian_filter(lag_kernel, sigma=1.0)

    # Normalize again after smoothing to maintain probability distribution
    for p in range(n_phase_bins):
        col_sum = np.sum(lag_kernel[:, p])
        if col_sum > 0:
            lag_kernel[:, p] /= col_sum

    return {
        "lags": lags,
        "phase_bins": phase_bins.tolist(),
        "signal": lag_phase_matrix.tolist(),
        "baseline": baseline_matrix.tolist(),
        "lagKernel": lag_kernel.tolist(),
    }


def compute_alignment_angle(
    drift_axis: np.ndarray,
    geomagnetic_axis: np.ndarray,
) -> np.ndarray:
    """
    Compute alignment angle between drift axis and geomagnetic axis.
    Uses arccos with NaN handling and interpolation.

    Args:
        drift_axis: Time-varying drift axis [n, 3]
        geomagnetic_axis: Time-varying geomagnetic axis [n, 3]

    Returns:
        alignment: Angle in degrees [n]
    """
    n = len(drift_axis)
    alignment = []

    for i in range(n):
        d = safe_unit(drift_axis[i])
        m = safe_unit(geomagnetic_axis[i])

        if d is None or m is None:
            alignment.append(np.nan)
            continue

        d_2d = d[:2]
        m_2d = m[:2]

        dot = np.dot(d_2d, m_2d)
        dot = np.clip(dot, -1.0, 1.0)
        alignment.append(np.arccos(dot))

    alignment = np.array(alignment)
    alignment = np.degrees(alignment)

    alignment = pd.Series(alignment).interpolate().values
    alignment = savgol_filter(alignment, 51, 3)

    return alignment


def compute_rolling_stats(
    xp: List[float],
    yp: List[float],
    t_days: List[float],
    window_size: float = 365.0,
    turn_threshold: float = 0.05,
    center_window: float = 60.0,
    center_step: float = 5.0,
    dance_window: float = 120.0,
    conditional_target_state: int = 2,
) -> Dict[str, Any]:
    """
    Main pipeline: compute all rolling statistics.

    Args:
        xp, yp: Polar motion coordinates (mas)
        t_days: Days since start
        window_size: Rolling PCA window size (days)
        turn_threshold: Threshold for turning point detection
        center_window: Window for loop center computation
        center_step: Step size for center computation
        dance_window: Window for dance segment extraction

    Returns:
        Dictionary with all computed quantities
    """
    xp = np.array(xp)
    yp = np.array(yp)
    t = np.array(t_days)

    # Step 1: Detrend
    x_detrended = detrend(xp, t)
    y_detrended = detrend(yp, t)

    # Initialize all arrays with zeros instead of NaN for safety
    x_detrended = np.nan_to_num(x_detrended, nan=0.0)
    y_detrended = np.nan_to_num(y_detrended, nan=0.0)

    # Step 2: Rolling PCA for e1, e2
    e1, e2 = rolling_pca(x_detrended, y_detrended, t, window_size)

    # Step 3: Loop centers
    cx, cy, center_times = compute_centers(
        x_detrended, y_detrended, t, center_window, center_step
    )

    # Step 4: Phase angle from loop centers
    theta = compute_theta(cx, cy)

    # Step 5: Angular velocity from continuous phase
    omega = compute_omega(theta, t)

    # Preserve a wrapped view for bounded phase-bin analysis and display.
    theta_wrapped = (theta + np.pi) % (2 * np.pi) - np.pi

    # Step 6: Turning points
    turning_points = detect_turning_points(omega, turn_threshold)

    # Step 6b: State detection
    state = detect_states(omega, theta_wrapped, turn_threshold)

    # Step 7: Dance segments
    dance_segments = extract_dance_segments(
        x_detrended, y_detrended, t, turning_points, dance_window
    )

    # Step 8: Orthogonal deviation ratio
    r_ratio = compute_r_ratio(x_detrended, y_detrended)

    # Step 9: Geomagnetic axis (from CHAOS model if available)
    geomagnetic_axis = compute_geomagnetic_axis(t, xp, yp)

    # Step 10: Rolling drift axis (CRITICAL - must use rolling window)
    drift_axis = compute_drift_axis_rolling(
        x_detrended, y_detrended, t, window_days=1825.0
    )

    # Step 11: Alignment angle between drift and geomagnetic axes
    if geomagnetic_axis is not None:
        alignment = compute_alignment_angle(drift_axis, geomagnetic_axis)
    else:
        alignment = np.zeros(len(t))

    # Step 12: Convert drift axis to longitude (degrees) for lag model
    drift_lon = np.array(
        [
            (np.arctan2(drift_axis[i, 1], drift_axis[i, 0]) * 180 / np.pi) + 90
            for i in range(len(t))
        ]
    )

    # Step 13: Compute lag model
    lag_result = compute_lag_model(
        lon=drift_lon,
        alignment=alignment,
        R=r_ratio,
        t=t,
        turning_points=turning_points,
        H=30,
        lag_max=180,
    )

    # Step 14: Compute conditional lag model
    conditional_lag_result = compute_conditional_lag_model(
        lon=drift_lon,
        theta=theta_wrapped,
        omega=omega,
        R=r_ratio,
        t=t,
        turning_points=turning_points,
        state=state,
        H=30,
        lag_max=180,
        n_phase_bins=6,
        target_state=conditional_target_state,
    )

    result = {
        "t": t.tolist(),
        "x_detrended": x_detrended.tolist(),
        "y_detrended": y_detrended.tolist(),
        "e1": [e1[i].tolist() for i in range(len(t))],
        "e2": [e2[i].tolist() for i in range(len(t))],
        "centers": [[cx[i], cy[i]] for i in range(len(t))],
        "theta": theta_wrapped.tolist(),
        "omega": omega.tolist(),
        "turningPoints": turning_points.tolist(),
        "state": state.tolist(),
        "danceSegments": dance_segments,
        "rRatio": r_ratio.tolist(),
        "driftAxis": [drift_axis[i].tolist() for i in range(len(t))],
        "geomagnetic_axis": geomagnetic_axis.tolist()
        if geomagnetic_axis is not None
        else None,
        "alignment": alignment.tolist(),
        "lagModel": lag_result,
        "conditionalLagModel": conditional_lag_result,
    }

    return nan_to_none(result)


def compute_geomagnetic_axis(t: np.ndarray, xp: np.ndarray, yp: np.ndarray):
    """Compute geomagnetic axis using CHAOS model if available."""
    try:
        import chaosmagpy as cp
        import pandas as pd
        from datetime import datetime

        # Try to load CHAOS model
        try:
            import os

            possible_paths = [
                "CHAOS-7.mat",
                "data/CHAOS-7.mat",
                "/usr/local/data/CHAOS-7.mat",
            ]

            chaos_model_path = None
            for path in possible_paths:
                if os.path.exists(path):
                    chaos_model_path = path
                    break

            if chaos_model_path is None:
                print("CHAOS model not found; omitting geomagnetic axis")
                return None

            model = cp.load_CHAOS_matfile(chaos_model_path)

            start_date = datetime.fromisoformat("1978-01-01")

            decimal_years = []
            for td in t:
                target_date = start_date + pd.Timedelta(days=int(td))
                year = target_date.year
                start_y = pd.Timestamp(year=year, month=1, day=1)
                end_y = pd.Timestamp(year=year + 1, month=1, day=1)
                dec_year = (
                    year
                    + (target_date - start_y).total_seconds()
                    / (end_y - start_y).total_seconds()
                )
                decimal_years.append(dec_year)

            decimal_years = np.array(decimal_years)

            coeffs = model.synth_coeffs(decimal_years, nmax=1)

            g10 = coeffs[:, 0]
            g11 = coeffs[:, 1]
            h11 = coeffs[:, 2]

            mx = -g11
            my = -h11
            mz = -g10

            m = np.vstack([mx, my, mz]).T
            norm = np.linalg.norm(m, axis=1, keepdims=True)
            m_unit = m / norm

            return m_unit

        except ImportError as e:
            print(f"Import error: {e}")
            return None
        except Exception as e:
            print(f"CHAOS model loading failed: {e}")
            return None

    except ImportError:
        print("chaosmagpy not installed; omitting geomagnetic axis")
        return None
    except Exception as e:
        print(f"Geomagnetic axis computation failed: {e}")
        return None


def main():
    """Main entry point: read EOP data and compute rolling stats."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Compute rolling state-space statistics"
    )
    parser.add_argument("--input", "-i", required=True, help="Input EOP JSON file")
    parser.add_argument("--output", "-o", required=True, help="Output stats JSON file")
    parser.add_argument(
        "--window-size", type=float, default=365.0, help="Rolling PCA window (days)"
    )
    parser.add_argument(
        "--turn-threshold", type=float, default=0.05, help="Turning point threshold"
    )
    parser.add_argument(
        "--center-window", type=float, default=60.0, help="Center computation window"
    )
    parser.add_argument(
        "--center-step", type=float, default=5.0, help="Center computation step"
    )
    parser.add_argument(
        "--dance-window", type=float, default=120.0, help="Dance segment window"
    )
    parser.add_argument(
        "--conditional-target-state",
        type=int,
        default=2,
        help="State used for conditional lag model (0=Stable, 1=Pre, 2=Transition, 3=Post)",
    )

    args = parser.parse_args()

    # Load EOP data
    with open(args.input, "r") as f:
        eop_data = json.load(f)

    # Extract xp, yp, and compute t_days
    xp = []
    yp = []
    dates = []

    for entry in eop_data:
        xp.append(entry["xp"])
        yp.append(entry["yp"])
        dates.append(entry["t"])

    # Compute days since start
    from datetime import datetime
    import pandas as pd

    start_date = datetime.fromisoformat(dates[0].replace("Z", "+00:00").split("T")[0])
    t_days = []
    for d in dates:
        date = datetime.fromisoformat(d.replace("Z", "+00:00").split("T")[0])
        delta = (date - start_date).days
        t_days.append(float(delta))

    # Convert to numpy arrays
    xp = np.array(xp)
    yp = np.array(yp)
    t = np.array(t_days)

    # Compute statistics
    stats = compute_rolling_stats(
        xp,
        yp,
        t,
        window_size=args.window_size,
        turn_threshold=args.turn_threshold,
        center_window=args.center_window,
        center_step=args.center_step,
        dance_window=args.dance_window,
        conditional_target_state=args.conditional_target_state,
    )

    # Add metadata
    stats["metadata"] = {
        "input_file": args.input,
        "window_size_days": args.window_size,
        "turn_threshold": args.turn_threshold,
        "center_window_days": args.center_window,
        "dance_window_days": args.dance_window,
        "conditional_target_state": args.conditional_target_state,
        "n_points": len(xp),
        "date_range": [dates[0], dates[-1]],
    }

    # Save output
    with open(args.output, "w") as f:
        json.dump(stats, f, indent=2)

    print(f"Saved {len(stats['t'])} data points to {args.output}")


if __name__ == "__main__":
    main()
