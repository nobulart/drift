import numpy as np
import pandas as pd
from scipy.signal import savgol_filter

INPUT_FILE = "rolling_pca_analysis.csv"
OUTPUT_FILE = "axis_angular_velocity.csv"

WINDOW = 31
POLY_ORDER = 3
MAD_THRESHOLD = 5.0

MIN_DT = 1e-6  # ~0.03 seconds in years → prevents blowups


def robust_unwrap(theta_deg):
    theta_rad = np.deg2rad(theta_deg)
    return np.rad2deg(np.unwrap(theta_rad))


def clean_time(df):
    """Ensure strictly increasing time."""
    df = df.sort_values("date").reset_index(drop=True)

    t = pd.to_datetime(df["date"])
    t_years = (t - t.iloc[0]).dt.total_seconds() / (365.25 * 24 * 3600)

    # remove non-increasing points
    mask = np.diff(t_years, prepend=np.nan) > 0
    df = df[mask].reset_index(drop=True)

    t = pd.to_datetime(df["date"])
    t_years = (t - t.iloc[0]).dt.total_seconds() / (365.25 * 24 * 3600)

    return df, t_years.values


def compute_angular_velocity(theta, t_years):
    """Stable derivative using time vector (NOT dt)."""
    return np.gradient(theta, t_years)


def mad_filter(series, threshold=5.0):
    s = np.array(series, dtype=float)

    # remove inf early
    s[np.isinf(s)] = np.nan

    median = np.nanmedian(s)
    mad = np.nanmedian(np.abs(s - median))

    if mad == 0 or np.isnan(mad):
        return s

    z = 0.6745 * (s - median) / mad
    s[np.abs(z) > threshold] = np.nan

    return pd.Series(s).interpolate(limit_direction="both").values


def main():
    df = pd.read_csv(INPUT_FILE, parse_dates=["date"])

    # =========================================================
    # TIME CLEANING (CRITICAL FIX)
    # =========================================================
    df, t_years = clean_time(df)

    # ensure writable
    t_years = np.array(t_years, dtype=float).copy()

    # enforce minimum spacing
    dt = np.diff(t_years)
    dt[dt < MIN_DT] = MIN_DT

    t_years[1:] = t_years[0] + np.cumsum(dt)

    # =========================================================
    # ANGLE
    # =========================================================
    theta = df["principal_angle"].values
    theta_unwrapped = robust_unwrap(theta)

    # =========================================================
    # SMOOTHING
    # =========================================================
    window = min(WINDOW, len(theta_unwrapped) // 2 * 2 - 1)
    if window < POLY_ORDER + 2:
        window = POLY_ORDER + 3

    theta_smooth = savgol_filter(theta_unwrapped, window, POLY_ORDER, mode="interp")

    # =========================================================
    # DERIVATIVE (FIXED)
    # =========================================================
    omega_raw = compute_angular_velocity(theta_unwrapped, t_years)
    omega_smooth = compute_angular_velocity(theta_smooth, t_years)

    # =========================================================
    # CLEAN
    # =========================================================
    omega_filtered = mad_filter(omega_smooth, MAD_THRESHOLD)

    # =========================================================
    # OUTPUT
    # =========================================================
    out = pd.DataFrame({
        "date": df["date"],
        "theta_unwrapped": theta_unwrapped,
        "theta_smooth": theta_smooth,
        "omega_raw": omega_raw,
        "omega_smooth": omega_smooth,
        "omega_filtered": omega_filtered
    })

    out.to_csv(OUTPUT_FILE, index=False)

    # =========================================================
    # SUMMARY (SAFE)
    # =========================================================
    valid = np.isfinite(omega_filtered)

    print("=== ANGULAR VELOCITY (FIXED) ===")
    print(f"Mean ω: {np.mean(omega_filtered[valid]):.6f}")
    print(f"Std  ω: {np.std(omega_filtered[valid]):.6f}")
    print(f"Max  ω: {np.max(omega_filtered[valid]):.6f}")
    print(f"Min  ω: {np.min(omega_filtered[valid]):.6f}")

    print("\nSaved:", OUTPUT_FILE)


if __name__ == "__main__":
    main()