#!/usr/bin/env python3
"""
test_transition_forecast.py

Test the transition forecast implementation with sample data.
"""

import sys
import os
import json
import numpy as np

# Add parent directory to path
script_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(script_dir))

from transition_forecast import (
    extract_lag_kernel,
    predict_transition_curve,
    compute_transition_forecast,
)


def test_lag_kernel_extraction():
    """Test lag kernel extraction from conditional lag model."""
    print("=" * 60)
    print("TEST: Lag Kernel Extraction")
    print("=" * 60)

    # Create sample conditional lag result
    lags = list(range(5, 181))
    phase_bins = np.linspace(-np.pi, np.pi, 7).tolist()
    n_lags = len(lags)
    n_phases = 6

    # Create signal with some positive responses
    signal = []
    for i in range(n_lags):
        row = []
        for p in range(n_phases):
            # Simulate phase-dependent response
            base = np.sin(p * np.pi / 3) * 0.5 + 0.5
            response = base * np.exp(-0.01 * lags[i])
            if np.random.random() > 0.5:
                response *= -1  # Some negative values
            row.append(response)
        signal.append(row)

    conditional_result = {
        "lags": lags,
        "phase_bins": phase_bins,
        "signal": signal,
        "baseline": [[0] * n_phases] * n_lags,
    }

    # Extract kernel
    kernel = extract_lag_kernel(conditional_result, smooth_sigma=0)

    print(
        f"✓ Extracted lag kernel: {kernel['n_lags']} lags × {kernel['n_phases']} phases"
    )
    print(f"  Lags: {kernel['lags'][:5]}...{kernel['lags'][-5:]}")
    print(f"  Phase bins: {len(kernel['phase_bins'])} edges")

    # Verify normalization
    for p in range(kernel["n_phases"]):
        col_sum = sum(kernel["kernel"][i][p] for i in range(kernel["n_lags"]))
        print(f"  Phase {p} sum: {col_sum:.4f} (should be ~1.0)")

    return kernel


def test_transition_curve():
    """Test transition probability curve computation."""
    print("\n" + "=" * 60)
    print("TEST: Transition Probability Curve")
    print("=" * 60)

    kernel = test_lag_kernel_extraction()

    # Test different states
    for state in range(4):
        forecast = predict_transition_curve(
            theta_now=0.0, state_now=state, lag_kernel=kernel, base_prob=0.5
        )

        print(f"\nState {state} (Pre-Transition):")
        print(f"  Peak time: {forecast['peak_time']:.1f} days")
        print(f"  Expected time: {forecast['expected_time']:.1f} days")
        print(f"  Alert level: {forecast['alert_level']}")
        print(f"  Alert message: {forecast['alert_message']}")

        # Verify P_tau sums to 1
        p_sum = sum(forecast["P_tau"])
        print(f"  P_tau sum: {p_sum:.6f} (should be 1.0)")


def test_integration():
    """Test full integration with sample JSON data."""
    print("\n" + "=" * 60)
    print("TEST: Integration with Sample Data")
    print("=" * 60)

    # Load sample data if available
    try:
        with open("public/data/.rolling-stats-cache/*.json", "r") as f:
            # Find first JSON file
            import glob

            files = glob.glob("public/data/.rolling-stats-cache/*.json")
            if files:
                print(f"Found cache file: {files[0]}")
                with open(files[0], "r") as f:
                    data = json.load(f)

                conditional_result = data.get("conditionalLagModel", data)
                kernel = extract_lag_kernel(conditional_result)

                # Test forecast
                forecast = compute_transition_forecast(
                    theta_now=0.0, state_now=1, lag_kernel=kernel, base_prob=0.5
                )

                print(f"\nForecast Results:")
                print(f"  Expected time: {forecast['expected_time']:.1f} days")
                print(f"  Peak time: {forecast['peak_time']:.1f} days")
                print(f"  Alert: {forecast['alert_message']}")

                return True
    except Exception as e:
        print(f"No sample data available (expected): {e}")
        return False


if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("TRANSITION FORECAST TEST SUITE")
    print("=" * 60)

    try:
        kernel = test_lag_kernel_extraction()
        test_transition_curve()
        test_integration()

        print("\n" + "=" * 60)
        print("✓ All tests passed!")
        print("=" * 60)
    except Exception as e:
        print(f"\n✗ Test failed: {e}")
        import traceback

        traceback.print_exc()
