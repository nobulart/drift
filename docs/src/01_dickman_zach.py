import pandas as pd
import numpy as np
from scipy.stats import linregress
from multiprocessing import get_context

# =========================
# CONFIG
# =========================
DATA_FILE = "finals.all.csv"
WINDOW_DAYS = 365 * 10  # 10-year window

# =========================
# ATTRACTOR (~75°W)
# =========================
# Geographic bearing (clockwise from North)
theta = np.deg2rad(285)

# Convert to IERS frame:
# x → Greenwich, y → 90°W
# Geographic North corresponds to -y
d_hat = np.array([
    np.sin(theta),   # x component
    -np.cos(theta)   # y component
])

# =========================
# LOAD DATA
# =========================
df = pd.read_csv(DATA_FILE, sep=';')

df['date'] = pd.to_datetime(df[['Year', 'Month', 'Day']])

# arcsec → mas
df['x'] = df['x_pole'] * 1000.0
df['y'] = df['y_pole'] * 1000.0

df = df.sort_values('date').reset_index(drop=True)

# =========================
# 1. INSTANTANEOUS VELOCITY
# =========================
dx = np.diff(df['x'])
dy = np.diff(df['y'])

dt = np.diff(df['date'].values).astype('timedelta64[D]').astype(float)

vx = dx / dt
vy = dy / dt

v_mag = np.sqrt(vx**2 + vy**2)

# Projection onto attractor
v_parallel = vx * d_hat[0] + vy * d_hat[1]

df['v_mag'] = np.nan
df['v_parallel'] = np.nan
df.loc[1:, 'v_mag'] = v_mag
df.loc[1:, 'v_parallel'] = v_parallel

# =========================
# 2. ROLLING SECULAR DRIFT
# =========================
def compute_window(i):
    start = i
    end = i + WINDOW_DAYS
    if end >= len(df):
        return None

    sub = df.iloc[start:end]
    t = (sub['date'] - sub['date'].iloc[0]).dt.days.values

    slope_x, _, _, _, _ = linregress(t, sub['x'])
    slope_y, _, _, _, _ = linregress(t, sub['y'])

    # magnitude
    mag = np.sqrt(slope_x**2 + slope_y**2)
    mag_yr = mag * 365.25

    # ✅ CORRECT geographic direction
    direction = np.rad2deg(np.arctan2(slope_x, -slope_y)) % 360

    # projection onto attractor
    v_par = slope_x * d_hat[0] + slope_y * d_hat[1]
    v_par_yr = v_par * 365.25

    return (
        sub['date'].iloc[WINDOW_DAYS // 2],
        mag_yr,
        direction,
        v_par_yr
    )

# =========================
# RUN (macOS-safe)
# =========================
if __name__ == "__main__":
    ctx = get_context("spawn")

    with ctx.Pool() as pool:
        results = pool.map(compute_window, range(len(df) - WINDOW_DAYS))

    results = [r for r in results if r is not None]

    drift_df = pd.DataFrame(results, columns=[
        'date',
        'drift_mas_per_year',
        'direction_deg',
        'parallel_mas_per_year'
    ])

    # =========================
    # CIRCULAR MEAN (CRITICAL)
    # =========================
    angles = np.deg2rad(drift_df['direction_deg'])

    mean_angle = np.arctan2(
        np.mean(np.sin(angles)),
        np.mean(np.cos(angles))
    )

    mean_direction = np.rad2deg(mean_angle) % 360

    # =========================
    # DIAGNOSTICS
    # =========================
    print("\n=== INSTANTANEOUS VELOCITY ===")
    print(f"Mean |v| (mas/day): {np.nanmean(df['v_mag']):.3f}")
    print(f"Max |v| (mas/day): {np.nanmax(df['v_mag']):.3f}")

    print("\n=== SECULAR DRIFT ===")
    print(f"Mean drift (mas/yr): {drift_df['drift_mas_per_year'].mean():.3f}")
    print(f"Std drift (mas/yr): {drift_df['drift_mas_per_year'].std():.3f}")

    print("\n=== DIRECTION (geographic) ===")
    print(f"Circular mean direction (deg): {mean_direction:.2f}")

    print("\n=== ALIGNMENT WITH ~75°W ===")
    print(f"Mean parallel (mas/yr): {drift_df['parallel_mas_per_year'].mean():.3f}")

    # =========================
    # SAVE
    # =========================
    drift_df.to_csv("rolling_drift_analysis.csv", index=False)
    df.to_csv("instantaneous_velocity.csv", index=False)

    print("\nSaved:")
    print("- rolling_drift_analysis.csv")
    print("- instantaneous_velocity.csv")