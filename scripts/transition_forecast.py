#!/usr/bin/env python3
"""
transition_forecast.py

Compute transition probability from conditional lag model:
- Extract positive lag kernel
- Normalize per phase bin
- Generate transition probability curves
- Calculate probability summary metrics
"""

import json
import numpy as np
from typing import Dict, Any, Tuple, Optional
from scipy.ndimage import gaussian_filter


def extract_lag_kernel(
    conditional_result: Dict[str, Any], smooth_sigma: float = 1.0
) -> Dict[str, Any]:
    """
    Extract and normalize lag kernel from conditional lag model result.

    Args:
        conditional_result: Output from compute_conditional_lag_model
        smooth_sigma: Gaussian smoothing sigma (0 = no smoothing)

    Returns:
        Dictionary with normalized lag kernel
    """
    lags = conditional_result.get("lags", [])
    signal = np.array(conditional_result.get("signal", []))
    phase_bins = conditional_result.get("phase_bins", [])

    if len(lags) == 0 or len(phase_bins) <= 1:
        return {
            "lags": [],
            "phase_bins": phase_bins,
            "kernel": [],
            "n_lags": 0,
            "n_phases": 0,
        }

    # Convert to positive kernel (only positive responses)
    lag_kernel = np.maximum(signal, 0)

    # Apply smoothing if requested
    if smooth_sigma > 0:
        lag_kernel = gaussian_filter(lag_kernel, sigma=smooth_sigma)

    # Normalize per phase bin (make each column sum to 1)
    n_lags, n_phases = lag_kernel.shape
    for p in range(n_phases):
        col_sum = np.sum(lag_kernel[:, p])
        if col_sum > 0:
            lag_kernel[:, p] /= col_sum
        else:
            # If all zeros, make uniform distribution
            lag_kernel[:, p] = 1.0 / n_lags

    return {
        "lags": lags,
        "phase_bins": phase_bins,
        "kernel": lag_kernel.tolist(),
        "n_lags": n_lags,
        "n_phases": n_phases,
    }


def compute_phase_bin(theta: float, phase_bins: list) -> int:
    """
    Determine which phase bin a angle falls into.

    Args:
        theta: Phase angle in radians
        phase_bins: Bin edges from -pi to +pi

    Returns:
        Bin index (0 to n_phases-1)
    """
    import numpy as np

    bins = np.array(phase_bins)
    idx = np.digitize(theta, bins) - 1
    idx = np.clip(idx, 0, len(bins) - 2)
    return int(idx)


def predict_transition_curve(
    theta_now: float, state_now: int, lag_kernel: Dict[str, Any], base_prob: float = 0.5
) -> Dict[str, Any]:
    """
    Predict transition probability curve for given state and phase.

    Args:
        theta_now: Current phase angle (radians)
        state_now: Current state (0=Stable, 1=Pre, 2=Transition, 3=Post)
        lag_kernel: Normalized lag kernel from extract_lag_kernel
        base_prob: Base transition probability P0 (0-1)

    Returns:
        Dictionary with probability curve and metrics
    """
    lags = lag_kernel.get("lags", [])
    kernel = np.array(lag_kernel.get("kernel", []))
    phase_bins = lag_kernel.get("phase_bins", [])

    if len(lags) == 0 or len(kernel) == 0:
        return {
            "lags": [],
            "P_tau": [],
            "expected_time": float("nan"),
            "peak_time": float("nan"),
            "cumulative": [],
            "probability_level": "UNKNOWN",
            "probability_message": "No lag kernel data available",
            "alert_level": "UNKNOWN",
            "alert_message": "No lag kernel data available",
        }

    # Get phase bin for current state
    # State determines which phase bin to use
    # We'll use the state to select a phase bin that对应s to that dynamical regime
    n_phases = lag_kernel.get("n_phases", 6)

    # Map state to phase bin
    # States 0-3 map to phase bins in a way that reflects dynamical regime
    phase_idx = min(state_now, n_phases - 1)

    # Get lag distribution for this phase
    L = kernel[:, phase_idx]

    # Combine with base probability
    P_tau = base_prob * L

    # Normalize to proper probability distribution
    total = np.sum(P_tau)
    if total > 0:
        P_tau = P_tau / total
    else:
        P_tau = np.ones(len(lags)) / len(lags)

    # Compute cumulative probability
    cumulative = np.cumsum(P_tau)

    # Compute metrics
    lags_array = np.array(lags)
    expected_time = float(np.sum(P_tau * lags_array))

    peak_idx = int(np.argmax(P_tau))
    peak_time = float(lags[peak_idx])

    # Summarize cumulative transition probability at 30 days.
    # Find index closest to 30 days
    closest_idx = min(range(len(lags)), key=lambda i: abs(lags[i] - 30))
    P_30d = float(cumulative[closest_idx])

    if P_30d > 0.6:
        alert_level = "HIGH"
        alert_message = f"HIGH TRANSITION PROBABILITY (30d): P={P_30d:.2%}"
    elif P_30d > 0.3:
        alert_level = "MODERATE"
        alert_message = f"MODERATE TRANSITION PROBABILITY (30d): P={P_30d:.2%}"
    else:
        alert_level = "LOW"
        alert_message = f"LOW TRANSITION PROBABILITY (30d): P={P_30d:.2%}"

    return {
        "lags": lags,
        "P_tau": P_tau.tolist(),
        "expected_time": expected_time,
        "peak_time": peak_time,
        "cumulative": cumulative.tolist(),
        "probability_level": alert_level,
        "probability_message": alert_message,
        "alert_level": alert_level,
        "alert_message": alert_message,
        "phase_bin": phase_idx,
        "base_prob": base_prob,
    }


def compute_transition_forecast(
    theta_now: float, state_now: int, lag_kernel: Dict[str, Any], base_prob: float = 0.5
) -> Dict[str, Any]:
    """
    Complete transition probability pipeline.

    This is the main function to call from external code.

    Args:
        theta_now: Current phase angle (radians, -pi to +pi)
        state_now: Current dynamical state (0-3)
        lag_kernel: Normalized lag kernel
        base_prob: Base transition probability (typically 0.3-0.7)

    Returns:
        Full probability summary with all metrics
    """
    return predict_transition_curve(
        theta_now=theta_now,
        state_now=state_now,
        lag_kernel=lag_kernel,
        base_prob=base_prob,
    )


def load_lag_kernel_from_json(json_path: str) -> Dict[str, Any]:
    """Load conditional lag result and extract normalized kernel."""
    with open(json_path, "r") as f:
        data = json.load(f)

    conditional_result = data.get("conditionalLagModel", data)
    return extract_lag_kernel(conditional_result)


def save_lag_kernel(lag_kernel: Dict[str, Any], output_path: str):
    """Save lag kernel to JSON file."""
    with open(output_path, "w") as f:
        json.dump(lag_kernel, f, indent=2)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Compute transition probability from conditional lag model"
    )
    parser.add_argument("--input", "-i", required=True, help="Input stats JSON file")
    parser.add_argument("--output", "-o", required=True, help="Output lag kernel JSON")
    parser.add_argument(
        "--smooth", type=float, default=1.0, help="Gaussian smoothing sigma"
    )
    parser.add_argument(
        "--base-prob", type=float, default=0.5, help="Base transition probability"
    )

    args = parser.parse_args()

    # Load and extract lag kernel
    print(f"Loading conditional lag model from {args.input}...")
    kernel = load_lag_kernel_from_json(args.input)

    # Apply smoothing
    if args.smooth > 0:
        print(f"Applying Gaussian smoothing (sigma={args.smooth})...")
        kernel["kernel"] = gaussian_filter(
            np.array(kernel["kernel"]), sigma=args.smooth
        ).tolist()

    # Save normalized kernel
    print(f"Saving lag kernel to {args.output}...")
    save_lag_kernel(kernel, args.output)

    print(f"✓ Saved {kernel['n_lags']} lags × {kernel['n_phases']} phases")
    print(f"  Phase bins: {kernel['phase_bins']}")

    # Demo probability summary
    print("\nDemo probability summary:")
    for state in range(4):
        forecast = compute_transition_forecast(
            theta_now=0.0, state_now=state, lag_kernel=kernel, base_prob=args.base_prob
        )
        print(
            f"  State {state}: Peak={forecast['peak_time']:.1f}d, "
            f"Expected={forecast['expected_time']:.1f}d, "
            f"{forecast['probability_message']}"
        )
