import numpy as np
import pandas as pd
from scipy.signal import savgol_filter

INPUT_FILE = "rolling_pca_analysis.csv"
OUTPUT_FILE = "axis_angular_velocity.csv"

# --- PARAMETERS (must be reported in paper) ---
WINDOW = 31          # odd number, ~monthly smoothing
POLY_ORDER = 3       # preserves curvature
MAD_THRESHOLD = 5.0  # outlier rejection threshold


def robust_unwrap(theta_deg):
    """Unwrap angle in degrees safely."""
    theta_rad = np.deg2rad(theta_deg)
    unwrapped = np.unwrap(theta_rad)
    return np.rad2deg(unwrapped)


def compute_angular_velocity(theta_deg, dt_years):
    """Central difference derivative."""
    dtheta = np.gradient(theta_deg, dt_years)
    return dtheta


def mad_filter(series, threshold=5.0):
    """Remove extreme spikes using Median Absolute Deviation."""
    median = np.median(series)
    mad = np.median(np.abs(series - median))
    if mad == 0:
        return series
    z = 0.6745 * (series - median) / mad
    filtered = np.where(np.abs(z) > threshold, np.nan, series)
    return pd.Series(filtered).interpolate()


def main():
    df = pd.read_csv(INPUT_FILE)

    # --- Time axis ---
    dt_days = 1.0
    dt_years = dt_days / 365.25

    # --- Principal axis angle ---
    theta = df["principal_angle"].values

    # --- Step 1: unwrap ---
    theta_unwrapped = robust_unwrap(theta)

    # --- Step 2: raw derivative ---
    omega_raw = compute_angular_velocity(theta_unwrapped, dt_years)

    # --- Step 3: smoothing BEFORE derivative (key fix) ---
    theta_smooth = savgol_filter(theta_unwrapped, WINDOW, POLY_ORDER)

    omega_smooth = compute_angular_velocity(theta_smooth, dt_years)

    # --- Step 4: outlier rejection ---
    omega_clean = mad_filter(omega_smooth, MAD_THRESHOLD)

    # --- Save ---
    out = pd.DataFrame({
        "date": df["date"],
        "theta_unwrapped": theta_unwrapped,
        "theta_smooth": theta_smooth,
        "omega_raw": omega_raw,
        "omega_smooth": omega_smooth,
        "omega_filtered": omega_clean
    })

    out.to_csv(OUTPUT_FILE, index=False)

    print("=== ANGULAR VELOCITY (CLEANED) ===")
    print(f"Mean ω: {np.nanmean(omega_clean)}")
    print(f"Std  ω: {np.nanstd(omega_clean)}")
    print(f"Max  ω: {np.nanmax(omega_clean)}")
    print(f"Min  ω: {np.nanmin(omega_clean)}")

    print("\nSaved:", OUTPUT_FILE)


if __name__ == "__main__":
    main()