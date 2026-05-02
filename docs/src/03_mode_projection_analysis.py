import numpy as np
import pandas as pd
from scipy.signal import butter, filtfilt

# =========================================================
# CONFIG
# =========================================================
INPUT_FILE = "filtered_series.csv"
OUTPUT_FILE = "mode_projection_analysis_filtered.csv"

AXES = {
    "zach_75W": 255.0,
    "adhikari_100W": 260.0,
    "observed_326": 326.0
}

DAYS_PER_YEAR = 365.25


# =========================================================
# UTILITIES
# =========================================================
def unit_vec(theta_deg):
    th = np.deg2rad(theta_deg)
    return np.array([np.cos(th), np.sin(th)])


def safe_gradient(arr, dt=1.0):
    arr = np.asarray(arr, dtype=np.float64)

    # Fill NaNs safely
    nans = np.isnan(arr)
    if np.any(nans):
        arr[nans] = np.interp(
            np.flatnonzero(nans),
            np.flatnonzero(~nans),
            arr[~nans]
        )

    grad = np.gradient(arr, dt)
    return np.nan_to_num(grad, nan=0.0, posinf=0.0, neginf=0.0)


def circular_mean_deg(theta_deg):
    theta_rad = np.deg2rad(theta_deg)
    mean_vec = np.mean(np.exp(1j * theta_rad))
    return (np.degrees(np.angle(mean_vec)) + 360) % 360


def circular_std_deg(theta_deg):
    theta_rad = np.deg2rad(theta_deg)
    R = np.abs(np.mean(np.exp(1j * theta_rad)))
    return np.degrees(np.sqrt(-2 * np.log(R + 1e-12)))


# =========================================================
# LOW-PASS FILTER (CRITICAL)
# =========================================================
def lowpass(data, cutoff_days=365*5, order=4):
    """
    cutoff_days = period threshold (e.g. 5 years)
    Removes Chandler (~433d) + annual + higher freq
    """
    data = np.asarray(data, dtype=np.float64)

    # Fill NaNs before filtering
    nans = np.isnan(data)
    if np.any(nans):
        data[nans] = np.interp(
            np.flatnonzero(nans),
            np.flatnonzero(~nans),
            data[~nans]
        )

    fs = 1.0  # samples per day
    nyq = 0.5 * fs

    cutoff = 1.0 / cutoff_days  # cycles per day
    normal_cutoff = cutoff / nyq

    b, a = butter(order, normal_cutoff, btype='low', analog=False)
    return filtfilt(b, a, data)


# =========================================================
# LOAD DATA
# =========================================================
df = pd.read_csv(INPUT_FILE, parse_dates=["date"])

if not {"x", "y"}.issubset(df.columns):
    raise ValueError("Input must contain 'x' and 'y' columns (mas).")

x = df["x"].astype(float).values
y = df["y"].astype(float).values


# =========================================================
# FILTER FIRST (THIS FIXES YOUR ISSUE)
# =========================================================
x_f = lowpass(x, cutoff_days=365*5)
y_f = lowpass(y, cutoff_days=365*5)


# =========================================================
# VELOCITY (AFTER FILTERING)
# =========================================================
vx = safe_gradient(x_f)
vy = safe_gradient(y_f)

vx *= DAYS_PER_YEAR
vy *= DAYS_PER_YEAR


# =========================================================
# PROJECTIONS
# =========================================================
out = pd.DataFrame({
    "date": df["date"],
    "vx": vx,
    "vy": vy
})

for name, theta in AXES.items():
    e = unit_vec(theta)
    e_perp = unit_vec(theta + 90.0)

    out[f"{name}_parallel"] = vx * e[0] + vy * e[1]
    out[f"{name}_perp"] = vx * e_perp[0] + vy * e_perp[1]


# =========================================================
# MAGNITUDE + DIRECTION
# =========================================================
mag = np.sqrt(vx**2 + vy**2)
direction = (np.degrees(np.arctan2(vy, vx)) + 360) % 360

out["v_mag"] = mag
out["direction_deg"] = direction


# =========================================================
# SUMMARY
# =========================================================
print("\n=== MODE PROJECTIONS (mas/yr) ===\n")

for name in AXES.keys():
    par = out[f"{name}_parallel"]
    perp = out[f"{name}_perp"]

    print(f"{name}:")
    print(f"  mean_parallel : {np.mean(par):.3f}")
    print(f"  std_parallel  : {np.std(par):.3f}")
    print(f"  mean_perp     : {np.mean(perp):.3f}")
    print(f"  std_perp      : {np.std(perp):.3f}")
    print()

print("=== DIRECTION STABILITY ===\n")
print(f"Circular mean (deg): {circular_mean_deg(direction):.2f}")
print(f"Circular std  (deg): {circular_std_deg(direction):.2f}")

print("\n=== MAGNITUDE ===\n")
print(f"Mean |v| (mas/yr): {np.mean(mag):.3f}")
print(f"Std  |v| (mas/yr): {np.std(mag):.3f}")


# =========================================================
# SAVE
# =========================================================
out.to_csv(OUTPUT_FILE, index=False)

print(f"\nSaved: {OUTPUT_FILE}")