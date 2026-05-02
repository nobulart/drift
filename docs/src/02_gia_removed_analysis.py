import pandas as pd
import numpy as np
from scipy.stats import linregress
from multiprocessing import get_context

# =========================
# CONFIG
# =========================
DATA_FILE = "finals.all.csv"
WINDOW_DAYS = 365 * 5

# =========================
# ATTRACTOR (~75°W)
# =========================
theta = np.deg2rad(285)
d_hat = np.array([
    np.sin(theta),
    -np.cos(theta)
])

# =========================
# LOAD + CLEAN DATA
# =========================
df = pd.read_csv(DATA_FILE, sep=';')

# Keep only final solutions
df = df[df['Type'] == 'final'].copy()

# Drop NaNs explicitly
df = df.dropna(subset=['x_pole', 'y_pole'])

# Time
df['date'] = pd.to_datetime(df[['Year', 'Month', 'Day']])

# Convert to mas
df['x'] = df['x_pole'] * 1000.0
df['y'] = df['y_pole'] * 1000.0

df = df.sort_values('date').reset_index(drop=True)

# Time vector AFTER cleaning
t_full = (df['date'] - df['date'].iloc[0]).dt.days.values

# =========================
# 1. GLOBAL SECULAR (GIA)
# =========================
slope_x, _, _, _, _ = linregress(t_full, df['x'])
slope_y, _, _, _, _ = linregress(t_full, df['y'])

mag = np.sqrt(slope_x**2 + slope_y**2) * 365.25
direction = np.rad2deg(np.arctan2(slope_x, -slope_y)) % 360

print("\n=== GLOBAL SECULAR (GIA) ===")
print(f"Magnitude (mas/yr): {mag:.3f}")
print(f"Direction (deg): {direction:.2f}")

# =========================
# 2. REMOVE SECULAR
# =========================
df['x_res'] = df['x'] - (slope_x * t_full)
df['y_res'] = df['y'] - (slope_y * t_full)

# =========================
# 3. INSTANTANEOUS (RESIDUAL)
# =========================
dx = np.diff(df['x_res'])
dy = np.diff(df['y_res'])

dt = np.diff(df['date'].values).astype('timedelta64[D]').astype(float)

vx = dx / dt
vy = dy / dt

v_mag = np.sqrt(vx**2 + vy**2)
v_parallel = vx * d_hat[0] + vy * d_hat[1]

df['v_res_mag'] = np.nan
df['v_res_parallel'] = np.nan
df.loc[1:, 'v_res_mag'] = v_mag
df.loc[1:, 'v_res_parallel'] = v_parallel

# =========================
# 4. ROLLING RESIDUAL DRIFT
# =========================
def compute_window(i):
    start = i
    end = i + WINDOW_DAYS
    if end >= len(df):
        return None

    sub = df.iloc[start:end]

    # Ensure no NaNs in window
    if sub[['x_res', 'y_res']].isna().any().any():
        return None

    t = (sub['date'] - sub['date'].iloc[0]).dt.days.values

    slope_x, _, _, _, _ = linregress(t, sub['x_res'])
    slope_y, _, _, _, _ = linregress(t, sub['y_res'])

    mag = np.sqrt(slope_x**2 + slope_y**2) * 365.25
    direction = np.rad2deg(np.arctan2(slope_x, -slope_y)) % 360

    v_par = (slope_x * d_hat[0] + slope_y * d_hat[1]) * 365.25

    return (
        sub['date'].iloc[WINDOW_DAYS // 2],
        mag,
        direction,
        v_par
    )

# =========================
# RUN
# =========================
if __name__ == "__main__":
    ctx = get_context("spawn")

    with ctx.Pool() as pool:
        results = pool.map(compute_window, range(len(df) - WINDOW_DAYS))

    results = [r for r in results if r is not None]

    drift_df = pd.DataFrame(results, columns=[
        'date',
        'residual_drift_mas_per_year',
        'direction_deg',
        'parallel_mas_per_year'
    ])

    # =========================
    # CIRCULAR MEAN
    # =========================
    angles = np.deg2rad(drift_df['direction_deg'])

    mean_angle = np.arctan2(
        np.mean(np.sin(angles)),
        np.mean(np.cos(angles))
    )

    mean_direction = np.rad2deg(mean_angle) % 360

    # =========================
    # OUTPUT
    # =========================
    print("\n=== RESIDUAL (GIA REMOVED) ===")
    print(f"Mean drift (mas/yr): {drift_df['residual_drift_mas_per_year'].mean():.3f}")
    print(f"Std drift (mas/yr): {drift_df['residual_drift_mas_per_year'].std():.3f}")
    print(f"Mean direction (deg): {mean_direction:.2f}")
    print(f"Mean parallel (mas/yr): {drift_df['parallel_mas_per_year'].mean():.3f}")

    print("\n=== RESIDUAL INSTANTANEOUS ===")
    print(f"Mean |v| (mas/day): {np.nanmean(df['v_res_mag']):.3f}")
    print(f"Mean parallel (mas/day): {np.nanmean(df['v_res_parallel']):.3f}")

    # Save
    drift_df.to_csv("residual_drift_analysis.csv", index=False)
    df.to_csv("residual_velocity.csv", index=False)

    print("\nSaved:")
    print("- residual_drift_analysis.csv")
    print("- residual_velocity.csv")