import numpy as np
import pandas as pd
from tqdm import tqdm

# ================================
# CONFIG
# ================================
INPUT_FILE = "filtered_series.csv"
WINDOW_DAYS = 365
STEP_DAYS   = 30

# ================================
# LOAD DATA
# ================================
df = pd.read_csv(INPUT_FILE)
df["date"] = pd.to_datetime(df["date"])

df = df.sort_values("date").reset_index(drop=True)

x = df["x_filt"].values
y = df["y_filt"].values
t = df["date"]

# ================================
# VELOCITY (ROBUST)
# ================================
vx = np.gradient(x)
vy = np.gradient(y)

mask = np.isfinite(vx) & np.isfinite(vy)
vx = vx[mask]
vy = vy[mask]
t = t[mask]

mag = np.sqrt(vx**2 + vy**2)
valid = mag > 0

vx = vx[valid] / mag[valid]
vy = vy[valid] / mag[valid]
t = t[valid]

vectors = np.stack([vx, vy, np.zeros_like(vx)], axis=1)

# ================================
# TIME-BASED WINDOWING
# ================================
results = []

prev_axis = None

print("Tracking quadrupole over time...")

start_time = t.iloc[0]
end_time   = t.iloc[-1]

current_time = start_time

while current_time + pd.Timedelta(days=WINDOW_DAYS) <= end_time:

    window_end = current_time + pd.Timedelta(days=WINDOW_DAYS)

    mask = (t >= current_time) & (t < window_end)

    v_win = vectors[mask]

    if len(v_win) < 50:
        current_time += pd.Timedelta(days=STEP_DAYS)
        continue

    # ================================
    # DIPOLE
    # ================================
    dip = np.mean(v_win, axis=0)
    dip_mag = np.linalg.norm(dip)

    # ================================
    # QUADRUPOLE (VECTORISED)
    # ================================
    Q = (v_win.T @ v_win) / len(v_win)
    Q -= np.eye(3) / 3.0

    eigvals, eigvecs = np.linalg.eigh(Q)

    idx = np.argsort(eigvals)[::-1]
    eigvals = eigvals[idx]
    eigvecs = eigvecs[:, idx]

    axis = eigvecs[:, 0]

    # ================================
    # SIGN CONTINUITY (CRITICAL)
    # ================================
    if prev_axis is not None:
        if np.dot(axis, prev_axis) < 0:
            axis = -axis

    prev_axis = axis.copy()

    # ================================
    # ANGLES
    # ================================
    theta = np.degrees(np.arccos(np.clip(axis[2], -1, 1)))
    phi   = np.degrees(np.arctan2(axis[1], axis[0])) % 360

    # ================================
    # ANISOTROPY (INVARIANT)
    # ================================
    P2 = np.sum(eigvals**2)

    results.append({
        "date": current_time,
        "phi_deg": phi,
        "theta_deg": theta,
        "quadrupole_power": P2,
        "dipole_magnitude": dip_mag,
        "lambda1": eigvals[0],
        "lambda2": eigvals[1],
        "lambda3": eigvals[2]
    })

    current_time += pd.Timedelta(days=STEP_DAYS)

results_df = pd.DataFrame(results)

# ================================
# ANGLE UNWRAPPING (ROBUST)
# ================================
phi = np.radians(results_df["phi_deg"].values)

# unwrap in continuous sense
phi_unwrapped = np.unwrap(phi)

results_df["phi_unwrapped_deg"] = np.degrees(phi_unwrapped)

# ================================
# SAVE
# ================================
results_df.to_csv("quadrupole_time_tracking.csv", index=False)

print("\nSaved: quadrupole_time_tracking.csv")
print("\nSummary:")
print(results_df.head())