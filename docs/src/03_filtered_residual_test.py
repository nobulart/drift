import pandas as pd
import numpy as np
from scipy.signal import butter, filtfilt
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
# LOAD + CLEAN
# =========================
df = pd.read_csv(DATA_FILE, sep=';')
df = df[df['Type'] == 'final'].copy()
df = df.dropna(subset=['x_pole', 'y_pole'])

df['date'] = pd.to_datetime(df[['Year', 'Month', 'Day']])
df['x'] = df['x_pole'] * 1000.0
df['y'] = df['y_pole'] * 1000.0

df = df.sort_values('date').reset_index(drop=True)

t_full = (df['date'] - df['date'].iloc[0]).dt.days.values

# =========================
# 1. REMOVE GIA (linear)
# =========================
sx, _, _, _, _ = linregress(t_full, df['x'])
sy, _, _, _, _ = linregress(t_full, df['y'])

df['x_detrend'] = df['x'] - sx * t_full
df['y_detrend'] = df['y'] - sy * t_full

# =========================
# 2. BAND-STOP FILTERS
# =========================
from scipy.signal import butter, filtfilt

def lowpass(data, cutoff_days=1000, fs=1.0, order=4):
    cutoff = 1.0 / cutoff_days  # cycles/day
    nyq = 0.5 * fs
    cutoff /= nyq

    b, a = butter(order, cutoff, btype='low')
    return filtfilt(b, a, data)

# Apply low-pass
df['x_filt'] = lowpass(df['x_detrend'].values)
df['y_filt'] = lowpass(df['y_detrend'].values)

# =========================
# 3. INSTANTANEOUS (filtered)
# =========================
dx = np.diff(df['x_filt'])
dy = np.diff(df['y_filt'])

dt = np.diff(df['date'].values).astype('timedelta64[D]').astype(float)

vx = dx / dt
vy = dy / dt

v_parallel = vx * d_hat[0] + vy * d_hat[1]

df['v_filt_parallel'] = np.nan
df.loc[1:, 'v_filt_parallel'] = v_parallel

# =========================
# 4. ROLLING DRIFT
# =========================
def compute_window(i):
    start = i
    end = i + WINDOW_DAYS
    if end >= len(df):
        return None

    sub = df.iloc[start:end]

    if sub[['x_filt', 'y_filt']].isna().any().any():
        return None

    t = (sub['date'] - sub['date'].iloc[0]).dt.days.values

    sx, _, _, _, _ = linregress(t, sub['x_filt'])
    sy, _, _, _, _ = linregress(t, sub['y_filt'])

    mag = np.sqrt(sx**2 + sy**2) * 365.25
    direction = np.rad2deg(np.arctan2(sx, -sy)) % 360

    v_par = (sx * d_hat[0] + sy * d_hat[1]) * 365.25

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
        'filtered_drift_mas_per_year',
        'direction_deg',
        'parallel_mas_per_year'
    ])

    # Circular mean
    angles = np.deg2rad(drift_df['direction_deg'])
    mean_angle = np.arctan2(np.mean(np.sin(angles)), np.mean(np.cos(angles)))
    mean_direction = np.rad2deg(mean_angle) % 360

    # =========================
    # OUTPUT
    # =========================
    print("\n=== FILTERED LOW-FREQUENCY TEST ===")
    print(f"Mean drift (mas/yr): {drift_df['filtered_drift_mas_per_year'].mean():.3f}")
    print(f"Std drift (mas/yr): {drift_df['filtered_drift_mas_per_year'].std():.3f}")
    print(f"Mean direction (deg): {mean_direction:.2f}")
    print(f"Mean parallel (mas/yr): {drift_df['parallel_mas_per_year'].mean():.3f}")

    print("\n=== INSTANTANEOUS (FILTERED) ===")
    print(f"Mean parallel (mas/day): {np.nanmean(df['v_filt_parallel']):.3f}")

    drift_df.to_csv("filtered_drift_analysis.csv", index=False)
    df.to_csv("filtered_series.csv", index=False)

    print("\nSaved:")
    print("- filtered_drift_analysis.csv")
    print("- filtered_series.csv")