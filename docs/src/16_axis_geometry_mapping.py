import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

# =========================
# LOAD DATA
# =========================
states = pd.read_csv("axis_states_timeseries.csv")
plane  = pd.read_csv("axis_plane_summary.csv")
dwell  = pd.read_csv("axis_dwell_times.csv")

states["date"] = pd.to_datetime(states["date"])

X = states["x"].values
Y = states["y"].values
Z = states["z"].values
S = states["state"].values

V = np.column_stack([X, Y, Z])

# =========================
# PLANE NORMAL (DEGENERACY-SAFE)
# =========================
normal = plane[["plane_normal_x","plane_normal_y","plane_normal_z"]].values[0]
normal = np.array(normal, dtype=float)

valid_plane = np.all(np.isfinite(normal)) and np.linalg.norm(normal) > 1e-6

if valid_plane:
    normal = normal / np.linalg.norm(normal)
else:
    normal = np.array([0.0, 0.0, 1.0])  # fallback (known planar system)
    print("\nPlane undefined → using canonical Z normal (planar phase system)")

# =========================
# BASIS OF PLANE (SAFE)
# =========================
def orthonormal_basis(n):
    n = n / np.linalg.norm(n)
    if abs(n[0]) < 0.9:
        a = np.array([1,0,0])
    else:
        a = np.array([0,1,0])
    v1 = np.cross(n, a)
    v1 /= np.linalg.norm(v1)
    v2 = np.cross(n, v1)
    return v1, v2

v1, v2 = orthonormal_basis(normal)

# =========================
# REFERENCE AXES (OPTIONAL DIAGNOSTIC ONLY)
# =========================
def sph_to_cart(lat_deg, lon_deg):
    lat = np.radians(lat_deg)
    lon = np.radians(lon_deg)
    return np.array([
        np.cos(lat)*np.cos(lon),
        np.cos(lat)*np.sin(lon),
        np.sin(lat)
    ])

axes = {
    "10W":  sph_to_cart(0, -10),
    "149W": sph_to_cart(0, -149),
    "75W":  sph_to_cart(0, -75),
    "45W":  sph_to_cart(0, -45)
}

# =========================
# SIGNED PROJECTIONS (DIAGNOSTIC)
# =========================
projections = {}
for name, axis in axes.items():
    projections[name] = V @ axis

# =========================
# PHASE IN PLANE (PRIMARY RESULT)
# =========================
p1 = V @ v1
p2 = V @ v2

theta = np.degrees(np.arctan2(p2, p1))
theta_unwrapped = np.degrees(np.unwrap(np.radians(theta)))

# =========================
# 1. XY STATE SPACE
# =========================
plt.figure(figsize=(6,6))
for s in np.unique(S):
    mask = S == s
    plt.scatter(X[mask], Y[mask], s=2, label=f"State {s}")

plt.legend()
plt.title("Phase States (XY)")
plt.grid(True)
plt.savefig("fig_50_states_xy_clustered.png", dpi=200)
plt.close()

# =========================
# 2. STATE TIME SERIES
# =========================
plt.figure(figsize=(10,3))
plt.plot(states["date"], S, lw=0.8)
plt.title("State Transitions Over Time")
plt.grid(True)
plt.savefig("fig_51_state_timeseries.png", dpi=200)
plt.close()

# =========================
# 3. TRAJECTORY (2D TRUE REPRESENTATION)
# =========================
plt.figure(figsize=(6,6))
plt.plot(X, Y, lw=0.5, alpha=0.6)
plt.title("Phase Trajectory (Unit Circle)")
plt.axis("equal")
plt.grid(True)
plt.savefig("fig_52_phase_trajectory.png", dpi=200)
plt.close()

# =========================
# 4. PLANE PROJECTION (INTRINSIC)
# =========================
plt.figure(figsize=(6,6))
plt.scatter(p1, p2, s=1)
plt.xlabel("v1")
plt.ylabel("v2")
plt.title("Intrinsic Phase Coordinates")
plt.grid(True)
plt.savefig("fig_53_plane_intrinsic.png", dpi=200)
plt.close()

# =========================
# 5. MODE PROJECTIONS (SECONDARY)
# =========================
plt.figure(figsize=(10,4))
for name, proj in projections.items():
    plt.plot(states["date"], proj, label=name)

plt.title("Axis Projections (Diagnostic Only)")
plt.ylabel("Projection")
plt.legend()
plt.grid(True)
plt.savefig("fig_54_mode_projections.png", dpi=200)
plt.close()

# =========================
# 6. PHASE EVOLUTION (KEY RESULT)
# =========================
plt.figure(figsize=(10,4))
plt.plot(states["date"], theta_unwrapped)
plt.title("Phase θ(t)")
plt.ylabel("deg (unwrapped)")
plt.grid(True)
plt.savefig("fig_56_phase_theta.png", dpi=200)
plt.close()

# =========================
# 7. DWELL TIMES
# =========================
plt.figure(figsize=(6,4))
plt.hist(dwell["dwell_years"], bins=20)
plt.title("Dwell Time Distribution")
plt.grid(True)
plt.savefig("fig_57_dwell_hist.png", dpi=200)
plt.close()

# =========================
print("\nSaved updated figures (phase-consistent, degeneracy-safe)")