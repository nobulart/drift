import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

# =========================
# LOAD
# =========================
df = pd.read_csv("axis_angular_velocity.csv", parse_dates=["date"])

# --- angular velocity ---
if "omega_filtered" in df.columns:
    omega = df["omega_filtered"].values
else:
    omega = df["omega_deg_per_year"].values

dates = df["date"].values

# --- pole coordinates (REQUIRED) ---
# expected columns: x, y (in arcseconds or radians)
assert {"x", "y"}.issubset(df.columns), "Pole coordinates x,y required"

x = df["x"].values
y = df["y"].values

# remove NaNs
mask = ~np.isnan(omega) & ~np.isnan(x) & ~np.isnan(y)
omega = omega[mask]
x = x[mask]
y = y[mask]
dates = dates[mask]

# =========================
# BUILD UNIT POSITION VECTOR r(t)
# =========================
# convert small-angle pole coords to unit sphere
# assumes x,y are small (arcsec or radians)
# z ≈ sqrt(1 - x^2 - y^2)

r = np.zeros((len(x), 3))
r[:, 0] = x
r[:, 1] = y
r[:, 2] = np.sqrt(np.maximum(1 - x**2 - y**2, 1e-12))

# normalize (important)
r = r / np.linalg.norm(r, axis=1, keepdims=True)

# =========================
# COMPUTE VELOCITY dr/dt
# =========================
# finite difference (central where possible)

dt = 1.0  # assume daily sampling

dr = np.zeros_like(r)
dr[1:-1] = (r[2:] - r[:-2]) / (2 * dt)
dr[0] = (r[1] - r[0]) / dt
dr[-1] = (r[-1] - r[-2]) / dt

# =========================
# INSTANTANEOUS ROTATION AXIS
# =========================
# u ∝ r × dr/dt

u = np.cross(r, dr)

# normalize
norms = np.linalg.norm(u, axis=1, keepdims=True)
valid = norms[:, 0] > 1e-12
u[valid] /= norms[valid]

# fallback for degenerate points
u[~valid] = np.array([0, 0, 1])

# =========================
# DIAGNOSTIC: AXIS VARIATION
# =========================
print("\nAxis variation (std):", np.std(u, axis=0))

# =========================
# CONVERT ω TO RAD/DAY
# =========================
omega_rad = np.deg2rad(omega) / 365.25

# =========================
# SKEW MATRIX
# =========================
def skew(v):
    return np.array([
        [0, -v[2], v[1]],
        [v[2], 0, -v[0]],
        [-v[1], v[0], 0]
    ])

# =========================
# EXPONENTIAL MAP (Rodrigues)
# =========================
def exp_so3(w):
    theta = np.linalg.norm(w)
    if theta < 1e-12:
        return np.eye(3)

    k = w / theta
    K = skew(k)

    return (
        np.eye(3)
        + np.sin(theta) * K
        + (1 - np.cos(theta)) * (K @ K)
    )

# =========================
# INTEGRATE ORIENTATION
# =========================
R = np.eye(3)
R_series = []

for i in range(len(omega_rad)):
    w_vec = omega_rad[i] * u[i]
    dR = exp_so3(w_vec)
    R = R @ dR
    R_series.append(R.copy())

R_series = np.array(R_series)

# =========================
# TRACK POLE TRAJECTORY
# =========================
z0 = np.array([0, 0, 1])
traj = np.array([R @ z0 for R in R_series])

# =========================
# DEFINE PLANES
# =========================
def normal_from_lon(lon_deg):
    lon = np.deg2rad(lon_deg)
    return np.array([np.cos(lon), np.sin(lon), 0])

n_170 = normal_from_lon(170)
n_31  = normal_from_lon(31)

n_170 /= np.linalg.norm(n_170)
n_31  /= np.linalg.norm(n_31)

# =========================
# ANGULAR DISTANCE TO PLANES
# =========================
def angle_to_plane(v, n):
    return np.degrees(np.arcsin(np.abs(v @ n)))

angle_170 = np.array([angle_to_plane(v, n_170) for v in traj])
angle_31  = np.array([angle_to_plane(v, n_31) for v in traj])

# =========================
# SAVE
# =========================
out = pd.DataFrame({
    "date": dates,
    "x": traj[:,0],
    "y": traj[:,1],
    "z": traj[:,2],
    "angle_170": angle_170,
    "angle_31": angle_31
})

out.to_csv("so3_trajectory_corrected.csv", index=False)

# =========================
# PLOTS
# =========================

# =========================
# 1) XY TRAJECTORY (TIME-SEGMENTED)
# =========================

import matplotlib.cm as cm

plt.figure(figsize=(8, 8))

# ---- CONFIG ----
N_segments = 12          # number of time segments
marker_interval = 200    # plot marker every N points (set None to disable)

# ---- split indices ----
N = len(traj)
indices = np.linspace(0, N, N_segments + 1, dtype=int)

# ---- colormap ----
cmap = cm.get_cmap("viridis", N_segments)

for i in range(N_segments):
    i0, i1 = indices[i], indices[i + 1]

    x_seg = traj[i0:i1, 0]
    y_seg = traj[i0:i1, 1]

    plt.plot(
        x_seg,
        y_seg,
        color=cmap(i),
        linewidth=1.5,
        label=f"{dates[i0].astype('datetime64[Y]')}"
    )

    # ---- optional markers ----
    if marker_interval is not None:
        marker_idx = np.arange(i0, i1, marker_interval)
        plt.scatter(
            traj[marker_idx, 0],
            traj[marker_idx, 1],
            color=cmap(i),
            s=10,
            alpha=0.6
        )

# ---- formatting ----
plt.title("Pole Trajectory (XY projection, time-segmented)")
plt.xlabel("X")
plt.ylabel("Y")
plt.axis("equal")

# optional legend (can be crowded)
# plt.legend(loc="upper right", fontsize=8)

# ---- colorbar for time ----
sm = plt.cm.ScalarMappable(cmap=cmap)
sm.set_array([])
cbar = plt.colorbar(sm)
cbar.set_label("Time progression (early → late)")

plt.savefig("fig_31_xy_traj_segmented.png", dpi=200)
plt.close()

# 1) XY trajectory
plt.figure()
plt.plot(traj[:,0], traj[:,1])
plt.title("Pole Trajectory (XY projection)")
plt.xlabel("X")
plt.ylabel("Y")
plt.axis("equal")
plt.savefig("fig_31_xy_traj_corrected.png", dpi=200)
plt.close()

# 2) Z tilt
plt.figure()
plt.plot(dates, traj[:,2])
plt.title("Z-component (tilt)")
plt.savefig("fig_32_z_tilt_corrected.png", dpi=200)
plt.close()

# 3) plane alignment
plt.figure()
plt.plot(dates, angle_170, label="170E")
plt.plot(dates, angle_31, label="31E")
plt.legend()
plt.ylabel("deg")
plt.title("SO(3) Plane Alignment")
plt.savefig("fig_33_so3_planes_corrected.png", dpi=200)
plt.close()

# 4) histogram
plt.figure()
plt.hist(angle_170, bins=100, alpha=0.5, label="170E")
plt.hist(angle_31, bins=100, alpha=0.5, label="31E")
plt.legend()
plt.title("SO(3) Alignment Distribution")
plt.savefig("fig_34_so3_hist_corrected.png", dpi=200)
plt.close()

print("\nSaved:")
print("- so3_trajectory_corrected.csv")
print("- fig_31–34 (corrected)")