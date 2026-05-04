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


def resolve_turn_threshold(
    omega: np.ndarray,
    requested_threshold: float = 0.05,
    max_near_fraction: float = 0.35,
    fallback_quantile: float = 0.10,
) -> float:
    """
    Use the requested threshold unless it collapses most of the series into
    a single near-turning-point regime. In that case, fall back to a data-scale
    threshold based on the lower tail of |omega|.
    """
    omega_abs = np.abs(omega[np.isfinite(omega)])
    if len(omega_abs) == 0:
        return requested_threshold

    requested_threshold = float(requested_threshold)
    near_fraction = float(np.mean(omega_abs < requested_threshold))

    if near_fraction <= max_near_fraction:
        return requested_threshold

    adaptive_threshold = float(np.quantile(omega_abs, fallback_quantile))
    if adaptive_threshold <= 0:
        positive = omega_abs[omega_abs > 0]
        adaptive_threshold = float(np.min(positive)) if len(positive) else requested_threshold

    return min(requested_threshold, adaptive_threshold)


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
    n = len(omega)
    for start, end in zip(starts, ends):
        if start == 0 or end == n:
            continue
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
    n = len(omega)
    for start, end in zip(starts, ends):
        if start == 0 or end == n:
            continue
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
    r_ratio = np.full(n, np.nan)
    min_window = 20

    for i in range(n):
        # Use trailing local windows so the latest samples update as new data
        # arrives instead of being forward-filled from an artificial tail pad.
        window_size = min(365, i + 1)
        x_win = x[max(0, i - window_size + 1) : i + 1]
        y_win = y[max(0, i - window_size + 1) : i + 1]

        if len(x_win) < min_window:
            r_ratio[i] = np.nan
            continue

        cov = np.cov(np.vstack([x_win, y_win]))
        eigvals = np.linalg.eigvals(cov)
        max_eig = np.max(np.abs(eigvals))
        r_ratio[i] = np.min(np.abs(eigvals)) / max_eig if max_eig > 0 else np.nan

    # Interpolate to fill short gaps and leading warm-up values.
    r_ratio = pd.Series(r_ratio).interpolate().values

    # Forward-fill and backward-fill any remaining NaNs (pandas compatible).
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
    # Use one representative anchor per contiguous region in the target state.
    # Filtering turning-point centers by state makes non-transition states
    # structurally impossible because those centers are state 2 by definition.
    state_mask = state == target_state
    state_mask_int = state_mask.astype(int)
    state_diff = np.diff(state_mask_int, prepend=0, append=0)
    starts = np.where(state_diff == 1)[0]
    ends = np.where(state_diff == -1)[0]
    tp_idx = np.array([(start + end) // 2 for start, end in zip(starts, ends) if end > start], dtype=int)
    tp_phase_counts = np.zeros(n_phase_bins, dtype=int)
    for tp in tp_idx:
        tp_phase_counts[phase_idx[tp]] += 1

    if len(tp_idx) == 0:
        # No qualifying turning points
        return {
            "lags": lags,
            "phase_bins": phase_bins.tolist(),
            "signal": [[np.nan] * n_phase_bins] * len(lags),
            "baseline": [[np.nan] * n_phase_bins] * len(lags),
            "lagKernel": [[0.0] * n_phase_bins] * len(lags),
            "targetState": target_state,
            "qualifyingTurningPoints": 0,
            "phaseEventCounts": tp_phase_counts.tolist(),
            "sufficientSamples": False,
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
    finite_signal = np.where(np.isfinite(lag_phase_matrix), lag_phase_matrix, 0.0)
    lag_kernel = np.maximum(finite_signal, 0.0)

    # Normalize per phase bin to sum = 1 (probability distribution)
    for p in range(n_phase_bins):
        col_sum = np.sum(lag_kernel[:, p])
        if col_sum > 0:
            lag_kernel[:, p] /= col_sum

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
        "targetState": target_state,
        "qualifyingTurningPoints": int(len(tp_idx)),
        "phaseEventCounts": tp_phase_counts.tolist(),
        "sufficientSamples": bool(len(tp_idx) >= 3),
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


def stabilize_vectors(vectors: np.ndarray) -> np.ndarray:
    """
    Stabilize vector orientations by detecting flip points and ensuring continuity.
    
    Args:
        vectors: Time-varying vectors [n, 3]
        
    Returns:
        stabilized: Stabilized vectors with consistent orientation [n, 3]
    """
    if len(vectors) < 2:
        return vectors.copy()
    
    stabilized = vectors.copy()
    
    for i in range(1, len(stabilized)):
        prev = stabilized[i - 1]
        curr = stabilized[i]
        
        if np.dot(prev, curr) < 0:
            stabilized[i] = -curr
    
    return stabilized


def unwrap_longitudes(longitudes: np.ndarray) -> np.ndarray:
    """
    Unwrap longitude values to remove 360° jumps.
    
    Args:
        longitudes: Longitude values in degrees [n]
        
    Returns:
        unwrapped: Longitude values without jumps [n]
    """
    if len(longitudes) < 2:
        return longitudes.copy()
    
    unwrapped = longitudes.copy()
    
    for i in range(1, len(unwrapped)):
        diff = unwrapped[i] - unwrapped[i - 1]
        
        if diff > 180:
            unwrapped[i] -= 360
        elif diff < -180:
            unwrapped[i] += 360
    
    return unwrapped


def build_slerp_path(points: np.ndarray, steps: int = 8) -> np.ndarray:
    """
    Build interpolated path using spherical linear interpolation (SLERP).
    
    Args:
        points: Unit vectors [n, 3]
        steps: Interpolation steps between points
        
    Returns:
        interpolated: SLERP-interpolated path [n * steps, 3]
    """
    if len(points) < 2:
        return points.copy()
    
    interpolated = []
    
    for i in range(len(points) - 1):
        a = points[i]
        b = points[i + 1]
        
        dot = np.clip(np.dot(a, b), -1.0, 1.0)
        omega = np.arccos(dot)
        
        if omega < 1e-6:
            for j in range(steps):
                t = j / steps
                interpolated.append(a * (1 - t) + b * t)
            continue
        
        sin_omega = np.sin(omega)
        
        for j in range(steps):
            t = j / steps
            s1 = np.sin((1 - t) * omega) / sin_omega
            s2 = np.sin(t * omega) / sin_omega
            pt = a * s1 + b * s2
            pt = pt / np.linalg.norm(pt)
            interpolated.append(pt)
    
    interpolated.append(points[-1])
    
    return np.array(interpolated)


def filter_jumps(vectors: np.ndarray, max_angle_deg: float = 20.0) -> np.ndarray:
    """
    Filter out large angular jumps in vector series.
    
    Args:
        vectors: Vector series [n, 3]
        max_angle_deg: Maximum allowed angle change in degrees
        
    Returns:
        filtered: Vectors with jumps removed or interpolated
    """
    if len(vectors) < 2:
        return vectors.copy()
    
    max_angle = np.deg2rad(max_angle_deg)
    filtered = [vectors[0]]
    
    for i in range(1, len(vectors)):
        prev = filtered[-1] / np.linalg.norm(filtered[-1])
        curr = vectors[i] / np.linalg.norm(vectors[i])
        
        dot = np.clip(np.dot(prev, curr), -1.0, 1.0)
        angle = np.arccos(dot)
        
        if angle <= max_angle:
            filtered.append(vectors[i])
        else:
            interp = prev * 0.5 + curr / np.linalg.norm(curr) * 0.5
            interp = interp / np.linalg.norm(interp)
            filtered.append(interp)
    
    return np.array(filtered)


def resample_path(
    vectors: np.ndarray, 
    times: np.ndarray,
    target_points: int = 30
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Resample path to uniform time spacing.
    
    Args:
        vectors: Vector series [n, 3]
        times: Time values [n]
        target_points: Target number of points
        
    Returns:
        resampled_vectors: Resampled vectors
        resampled_times: Resampled time values
    """
    if len(vectors) <= 1:
        return vectors.copy(), times.copy()
    
    start_time = times[0]
    end_time = times[-1]
    
    if not np.isfinite(start_time) or not np.isfinite(end_time) or end_time <= start_time:
        return vectors.copy(), times.copy()
    
    dt = (end_time - start_time) / max(target_points - 1, 1)
    resampled_times = np.arange(start_time, end_time, dt)
    resampled_times = np.append(resampled_times, end_time)
    
    resampled_vectors = np.zeros((len(resampled_times), 3))
    
    for i, t in enumerate(resampled_times):
        if t <= times[0]:
            resampled_vectors[i] = vectors[0]
        elif t >= times[-1]:
            resampled_vectors[i] = vectors[-1]
        else:
            idx = np.searchsorted(times, t)
            if idx > 0:
                idx -= 1
            idx = min(idx, len(vectors) - 2)
            
            a = vectors[idx]
            b = vectors[idx + 1]
            ta = times[idx]
            tb = times[idx + 1]
            
            span = tb - ta
            ratio = 0.0 if span < 1e-6 else (t - ta) / span
            
            ratio = np.clip(ratio, 0.0, 1.0)
            
            a_norm = a / np.linalg.norm(a)
            b_norm = b / np.linalg.norm(b)
            
            dot = np.clip(np.dot(a_norm, b_norm), -1.0, 1.0)
            omega = np.arccos(dot)
            
            if omega < 1e-6:
                resampled = a_norm * (1 - ratio) + b_norm * ratio
            else:
                sin_omega = np.sin(omega)
                s1 = np.sin((1 - ratio) * omega) / sin_omega
                s2 = np.sin(ratio * omega) / sin_omega
                resampled = a_norm * s1 + b_norm * s2
            
            resampled_vectors[i] = resampled / np.linalg.norm(resampled)
    
    return resampled_vectors, resampled_times


def compute_path_samples(
    vectors: np.ndarray,
    times: np.ndarray,
    target_points: int = 30,
    max_angle_deg: float = 20.0,
    allow_flip: bool = True,
    slerp_steps: int = 6
) -> Dict[str, Any]:
    """
    Compute normalized path samples for 3D visualization.
    
    Args:
        vectors: Raw vector series [n, 3]
        times: Time values [n]
        target_points: Target resampling resolution
        max_angle_deg: Maximum allowed angular jump
        allow_flip: Whether to allow vector orientation flips
        slerp_steps: SLERP interpolation steps
        
    Returns:
        Dictionary with path data for visualization
    """
    if len(vectors) < 2:
        return {
            "times": times.tolist() if len(times) > 0 else [],
            "vectors": [vectors[0].tolist()] if len(vectors) > 0 else [],
            "points": []
        }
    
    result = {}
    
    if allow_flip:
        stabilized = stabilize_vectors(vectors)
    else:
        stabilized = vectors.copy()
    
    result["stabilized"] = stabilized
    
    if len(stabilized) < 2:
        result["points"] = [{
            "t": float(times[i]),
            "vector": stabilized[i].tolist()
        } for i in range(len(stabilized))]
        return result
    
    times_arr = np.array(times) if not isinstance(times, np.ndarray) else times
    vectors_arr = np.array(stabilized) if not isinstance(stabilized, np.ndarray) else stabilized
    
    resampled_vectors, resampled_times = resample_path(
        vectors_arr, times_arr, target_points
    )
    
    filtered_vectors = filter_jumps(resampled_vectors, max_angle_deg)
    
    result["resampled_times"] = resampled_times
    result["resampled_vectors"] = resampled_vectors
    result["filtered_vectors"] = filtered_vectors
    
    slerp_path = build_slerp_path(
        filtered_vectors / np.linalg.norm(filtered_vectors, axis=1, keepdims=True),
        slerp_steps
    )
    
    result["points"] = [{
        "t": float(resampled_times[i]) if i < len(resampled_times) else float(times[-1]),
        "vector": slerp_path[i].tolist()
    } for i in range(min(len(slerp_path), len(resampled_times)))]
    
    return result


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
    path_points: int = 60,
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
        path_points: Number of points for precomputed vector paths

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
    effective_turn_threshold = resolve_turn_threshold(omega, turn_threshold)
    turning_points = detect_turning_points(omega, effective_turn_threshold)

    # Step 6b: State detection
    state = detect_states(omega, theta_wrapped, effective_turn_threshold)

    # Step 7: Dance segments
    dance_segments = extract_dance_segments(
        x_detrended, y_detrended, t, turning_points, dance_window
    )

    # Step 8: Orthogonal deviation ratio
    r_ratio = compute_r_ratio(x_detrended, y_detrended)

    # Step 9: Rolling drift axis (CRITICAL - must use rolling window)
    drift_axis = compute_drift_axis_rolling(
        x_detrended, y_detrended, t, window_days=1825.0
    )

    # Step 10: Alignment disabled - geomagnetic not currently used
    alignment = np.zeros(len(t))

    # Geomagnetic axis disabled - not currently used in the pipeline
    geomagnetic_axis = None

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

    path_max_angle = 22 if path_points >= 60 else 30
    
    # Step 15: Precompute 3D vector paths for visualization
    paths = {}
    
    # Precompute e1 path (3D from 2D)
    e1_3d = np.zeros((len(t), 3))
    e1_3d[:, :2] = e1
    e1_path = compute_path_samples(
        e1_3d, t, target_points=path_points, max_angle_deg=path_max_angle, allow_flip=True, slerp_steps=6
    )
    paths["e1"] = e1_path["points"]
    
    # Precompute e2 path (3D from 2D)
    e2_3d = np.zeros((len(t), 3))
    e2_3d[:, :2] = e2
    e2_path = compute_path_samples(
        e2_3d, t, target_points=path_points, max_angle_deg=path_max_angle, allow_flip=True, slerp_steps=6
    )
    paths["e2"] = e2_path["points"]
    
    # Precompute e3 path (fixed z-axis)
    e3_3d = np.zeros((len(t), 3))
    e3_3d[:, 2] = 1.0
    e3_path = compute_path_samples(
        e3_3d, t, target_points=path_points, max_angle_deg=path_max_angle, allow_flip=False, slerp_steps=6
    )
    paths["e3"] = e3_path["points"]
    
    # Precompute drift axis path
    drift_path = compute_path_samples(
        drift_axis, t, target_points=path_points, max_angle_deg=path_max_angle, allow_flip=True, slerp_steps=6
    )
    paths["drift"] = drift_path["points"]
    
    # Geomagnetic paths disabled - not currently used in the pipeline
    paths["geomagnetic"] = []

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
        "effectiveTurnThreshold": float(effective_turn_threshold),
        "danceSegments": dance_segments,
        "rRatio": r_ratio.tolist(),
        "driftAxis": [drift_axis[i].tolist() for i in range(len(t))],
        # geomagnetic_axis disabled - not currently used in the pipeline
        "geomagnetic_axis": None,
        # alignment disabled - not currently used in the pipeline
        "alignment": None,
        "lagModel": lag_result,
        "conditionalLagModel": conditional_lag_result,
        "paths": paths,
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
    parser.add_argument(
        "--path-resolution",
        type=str,
        default="medium",
        choices=["low", "medium", "high"],
        help="Path resolution for 3D vector trails (low=30, medium=60, high=120 points)",
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
    path_resolution_map = {
        "low": 30,
        "medium": 60,
        "high": 120,
    }
    path_points = path_resolution_map[args.path_resolution]

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
        path_points=path_points,
    )

    # Add metadata
    stats["metadata"] = {
        "input_file": args.input,
        "window_size_days": args.window_size,
        "turn_threshold": args.turn_threshold,
        "effective_turn_threshold": stats.get("effectiveTurnThreshold", args.turn_threshold),
        "center_window_days": args.center_window,
        "dance_window_days": args.dance_window,
        "conditional_target_state": args.conditional_target_state,
        "n_points": len(xp),
        "date_range": [dates[0], dates[-1]],
    }

    stats["metadata"]["path_points"] = path_points

    # Save output
    with open(args.output, "w") as f:
        json.dump(stats, f, indent=2)

    print(f"Saved {len(stats['t'])} data points to {args.output}")


if __name__ == "__main__":
    main()
