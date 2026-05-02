import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy.stats import gaussian_kde

# =========================
# LOAD
# =========================
df = pd.read_csv("axis_states_timeseries.csv")
df["date"] = pd.to_datetime(df["date"])

# =========================
# SORT + CLEAN
# =========================
df = df.sort_values("date")
df = df.drop_duplicates(subset="date", keep="first").reset_index(drop=True)

# =========================
# TIME (years)
# =========================
t = df["date"]
t_years = (t - t.iloc[0]).dt.total_seconds() / (365.25 * 24 * 3600)

mask = np.diff(t_years, prepend=np.nan) > 0
df = df[mask].reset_index(drop=True)
t_years = t_years[mask]

# =========================
# TRAJECTORY
# =========================
V = df[["x","y","z"]].values

# =========================
# MEAN CENTER (CRITICAL)
# =========================
V = V - np.mean(V, axis=0)

# =========================
# PLANE NORMAL
# =========================
plane = pd.read_csv("axis_plane_summary.csv")
n = plane[["plane_normal_x","plane_normal_y","plane_normal_z"]].values[0]
n = n / np.linalg.norm(n)

# =========================
# BASIS
# =========================
def basis(n):
    if abs(n[0]) < 0.9:
        a = np.array([1,0,0])
    else:
        a = np.array([0,1,0])
    v1 = np.cross(n, a); v1 /= np.linalg.norm(v1)
    v2 = np.cross(n, v1)
    return v1, v2

v1, v2 = basis(n)

# =========================
# PHASE
# =========================
p1 = V @ v1
p2 = V @ v2

theta = np.unwrap(np.arctan2(p2, p1))
theta_deg = np.degrees(theta)

# =========================
# DERIVATIVE (SAFE)
# =========================
dt = np.diff(t_years)
dtheta = np.diff(theta_deg)

valid = dt > 0
dt = dt[valid]
dtheta = dtheta[valid]

omega_theta = dtheta / dt
t_mid = t_years.iloc[1:].values[valid]

# =========================
# PLOT ωθ(t)
# =========================
plt.figure(figsize=(10,4))
plt.plot(t_mid, omega_theta)
plt.title("Angular Velocity ωθ(t)")
plt.ylabel("deg/year")
plt.grid(True)
plt.savefig("fig_61_omega_theta.png", dpi=200)

# =========================
# PHASE TIME SERIES
# =========================
plt.figure(figsize=(10,4))
plt.plot(t_years, theta_deg)
plt.title("Phase θ(t)")
plt.grid(True)
plt.savefig("fig_60_theta_time.png", dpi=200)

# =========================
# ω(θ)
# =========================
theta_mid = theta_deg[1:][valid]

bins = np.linspace(theta_mid.min(), theta_mid.max(), 40)
digitized = np.digitize(theta_mid, bins)

theta_c = []
omega_m = []

for i in range(1, len(bins)):
    m = digitized == i
    if np.sum(m) > 5:
        theta_c.append(theta_mid[m].mean())
        omega_m.append(omega_theta[m].mean())

theta_c = np.array(theta_c)
omega_m = np.array(omega_m)

idx = np.argsort(theta_c)
theta_c = theta_c[idx]
omega_m = omega_m[idx]

# =========================
# PLOT ω(θ)
# =========================
plt.figure(figsize=(6,4))
plt.plot(theta_c, omega_m, '-o')
plt.title("ω(θ)")
plt.grid(True)
plt.savefig("fig_63_omega_theta_phase.png", dpi=200)

# =========================
# 2D POTENTIAL V(x,y) (CRITICAL FIX)
# =========================
x = V[:,0]
y = V[:,1]

xy = np.vstack([x, y])
kde = gaussian_kde(xy)

grid_x, grid_y = np.mgrid[
    x.min():x.max():200j,
    y.min():y.max():200j
]

positions = np.vstack([grid_x.ravel(), grid_y.ravel()])
density = kde(positions).reshape(grid_x.shape)

V_xy = -np.log(density + 1e-12)
V_xy -= np.min(V_xy)

plt.figure(figsize=(6,5))
plt.contourf(grid_x, grid_y, V_xy, levels=50)
plt.colorbar(label="V(x,y)")
plt.title("2D Effective Potential")
plt.savefig("fig_64_potential_2D.png", dpi=200)

# =========================
# SAVE
# =========================
out = pd.DataFrame({
    "theta": theta_c,
    "omega": omega_m
})
out.to_csv("theta_dynamics_summary.csv", index=False)

print("\nDONE (geometry-consistent solution)")