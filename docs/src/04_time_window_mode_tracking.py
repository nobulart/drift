import numpy as np
import pandas as pd

# =========================================================
# CONFIG
# =========================================================
INPUT_FILE = "mode_projection_analysis_filtered.csv"
OUTPUT_FILE = "time_window_mode_tracking.csv"

WINDOW_DAYS = 365 * 10   # 10-year window
STEP_DAYS = 30           # monthly stepping

AXES = {
    "zach_75W": 255.0,
    "adhikari_100W": 260.0,
    "greenland_45": 45.0
}


# =========================================================
# UTILITIES
# =========================================================
def circular_mean(theta_deg):
    theta = np.deg2rad(theta_deg)
    mean_vec = np.mean(np.exp(1j * theta))
    return (np.degrees(np.angle(mean_vec)) + 360) % 360


def circular_std(theta_deg):
    theta = np.deg2rad(theta_deg)
    R = np.abs(np.mean(np.exp(1j * theta)))
    return np.degrees(np.sqrt(-2 * np.log(R + 1e-12)))


def unit_vec(theta_deg):
    th = np.deg2rad(theta_deg)
    return np.array([np.cos(th), np.sin(th)])


# =========================================================
# LOAD
# =========================================================
df = pd.read_csv(INPUT_FILE, parse_dates=["date"])

dates = df["date"].values
vx = df["vx"].values
vy = df["vy"].values

direction = df["direction_deg"].values


# =========================================================
# WINDOW ANALYSIS
# =========================================================
results = []

n = len(df)

for start in range(0, n - WINDOW_DAYS, STEP_DAYS):
    end = start + WINDOW_DAYS

    sub_dir = direction[start:end]
    sub_vx = vx[start:end]
    sub_vy = vy[start:end]

    # Direction stats
    mean_dir = circular_mean(sub_dir)
    std_dir = circular_std(sub_dir)

    # Magnitude
    mag = np.sqrt(sub_vx**2 + sub_vy**2)
    mean_mag = np.mean(mag)

    # Axis projections
    projections = {}

    for name, theta in AXES.items():
        e = unit_vec(theta)
        v_par = sub_vx * e[0] + sub_vy * e[1]
        projections[f"{name}_parallel"] = np.mean(v_par)

    results.append({
        "date": df["date"].iloc[start + WINDOW_DAYS // 2],
        "mean_direction": mean_dir,
        "direction_std": std_dir,
        "mean_magnitude": mean_mag,
        **projections
    })


# =========================================================
# OUTPUT
# =========================================================
out = pd.DataFrame(results)

print("\n=== TIME WINDOW ANALYSIS ===\n")

print("Overall mean direction:", np.mean(out["mean_direction"]))
print("Direction variability:", np.std(out["mean_direction"]))

print("\nAxis dominance (mean projection):")
for name in AXES.keys():
    print(f"{name}: {out[f'{name}_parallel'].mean():.3f}")

out.to_csv(OUTPUT_FILE, index=False)

print(f"\nSaved: {OUTPUT_FILE}")