import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib

# =========================
# LOAD
# =========================
df = pd.read_csv("axis_angular_velocity.csv", parse_dates=["date"])

# enforce time ordering (CRITICAL)
df = df.sort_values("date").reset_index(drop=True)

# --- angular velocity ---
if "omega_filtered" in df.columns:
    omega = df["omega_filtered"].values
else:
    omega = df["omega_smooth"].values  # corrected fallback

# =========================
# REQUIRED FIELD
# =========================
assert "theta_unwrapped" in df.columns, "theta_unwrapped required"

theta = df["theta_unwrapped"].values
dates = pd.to_datetime(df["date"])

# =========================
# CLEAN (CONSISTENT MASK)
# =========================
theta = np.array(theta, dtype=float)
omega = np.array(omega, dtype=float)

# remove inf
theta[np.isinf(theta)] = np.nan
omega[np.isinf(omega)] = np.nan

mask = np.isfinite(theta) & np.isfinite(omega)

theta = theta[mask]
omega = omega[mask]
dates = dates[mask]

# convert to radians AFTER cleaning
theta_rad = np.deg2rad(theta)

# =========================
# TRAJECTORY (SO(2) EMBEDDING)
# =========================
x = np.cos(theta_rad)
y = np.sin(theta_rad)
z = np.zeros_like(x)

traj = np.column_stack([x, y, z])

# =========================
# SAVE TRAJECTORY
# =========================
out = pd.DataFrame({
    "date": dates,
    "x": traj[:, 0],
    "y": traj[:, 1],
    "z": traj[:, 2],
})
out.to_csv("so3_trajectory_from_theta.csv", index=False)

# =========================
# 1) XY TRAJECTORY (TIME-COLORED)
# =========================
fig, ax = plt.subplots(figsize=(8, 8))

USE_SEGMENTS = True
N_segments = 16
marker_interval = 150

if USE_SEGMENTS:

    indices = np.linspace(0, len(traj), N_segments + 1, dtype=int)
    cmap = matplotlib.colormaps.get_cmap("viridis").resampled(N_segments)

    for i in range(N_segments):
        i0, i1 = indices[i], indices[i+1]

        x_seg = traj[i0:i1, 0]
        y_seg = traj[i0:i1, 1]

        ax.plot(x_seg, y_seg, color=cmap(i), linewidth=1.5)

        if marker_interval is not None:
            marker_idx = np.arange(i0, i1, marker_interval)
            ax.scatter(
                traj[marker_idx, 0],
                traj[marker_idx, 1],
                color=cmap(i),
                s=8,
                alpha=0.6
            )

    sm = plt.cm.ScalarMappable(cmap=cmap)
    sm.set_array([])
    cbar = fig.colorbar(sm, ax=ax)
    cbar.set_label("Time segments (early → late)")

else:
    t_norm = np.linspace(0, 1, len(traj))

    sc = ax.scatter(
        traj[:, 0],
        traj[:, 1],
        c=t_norm,
        cmap="viridis",
        s=2
    )

    cbar = fig.colorbar(sc, ax=ax)
    cbar.set_label("Time progression")

ax.set_title("Pole Trajectory (XY projection, time-colored)")
ax.set_xlabel("X")
ax.set_ylabel("Y")
ax.axis("equal")

fig.savefig("fig_31_xy_traj_time_colored.png", dpi=200)
plt.close(fig)

# =========================
# 2) THETA TIME SERIES
# =========================
fig, ax = plt.subplots()

ax.plot(dates, theta)
ax.set_title("Theta (unwrapped) vs time")
ax.set_ylabel("Degrees")

fig.savefig("fig_theta_timeseries.png", dpi=200)
plt.close(fig)

print("\nSaved:")
print("- so3_trajectory_from_theta.csv")
print("- fig_31_xy_traj_time_colored.png")
print("- fig_theta_timeseries.png")