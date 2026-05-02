import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.cluster import KMeans

# =========================================================
# LOAD (FIXED)
# =========================================================
df = pd.read_csv("so3_trajectory_from_theta.csv", parse_dates=["date"])

required = {"x", "y", "z"}
assert required.issubset(df.columns), "Need x,y,z trajectory"

# enforce time order
df = df.sort_values("date").reset_index(drop=True)

print("\nColumns:", df.columns.tolist())

# =========================================================
# TIME (FIXED)
# =========================================================
t = pd.to_datetime(df["date"])
t_years = (t - t.iloc[0]).dt.total_seconds() / (365.25 * 24 * 3600)

t_years = np.array(t_years, dtype=float)

# =========================================================
# POSITION VECTORS
# =========================================================
r = df[["x", "y", "z"]].values

# normalize (safety)
norm_r = np.linalg.norm(r, axis=1, keepdims=True)
norm_r[norm_r == 0] = np.nan
r = r / norm_r

# =========================================================
# VELOCITY dr/dt (FIXED)
# =========================================================
dr = np.zeros_like(r)

for i in range(1, len(r)-1):
    dt = t_years[i+1] - t_years[i-1]
    if dt <= 0:
        continue
    dr[i] = (r[i+1] - r[i-1]) / dt

# forward/backward edges
dt0 = t_years[1] - t_years[0]
if dt0 > 0:
    dr[0] = (r[1] - r[0]) / dt0

dtn = t_years[-1] - t_years[-2]
if dtn > 0:
    dr[-1] = (r[-1] - r[-2]) / dtn

# =========================================================
# ANGULAR VELOCITY ω = r × dr/dt
# =========================================================
omega = np.cross(r, dr)

# =========================================================
# UNIT AXIS û(t)
# =========================================================
norm = np.linalg.norm(omega, axis=1)
norm[norm == 0] = np.nan

u = omega / norm[:, None]

valid = np.isfinite(u).all(axis=1)
u = u[valid]
df = df.iloc[valid].reset_index(drop=True)
t_years = t_years[valid]

# =========================================================
# CLUSTERING (2 STATES)
# =========================================================
kmeans = KMeans(n_clusters=2, random_state=42, n_init=20)
labels = kmeans.fit_predict(u)

centers = kmeans.cluster_centers_
centers /= np.linalg.norm(centers, axis=1)[:, None]

print("\nCluster centers:")
print(centers)

df["state"] = labels

# =========================================================
# PLANE OF MOTION (DATA-DERIVED ONLY)
# =========================================================
u1, u2 = centers

# =========================================================
# PLANE OF MOTION (DEGENERACY-AWARE)
# =========================================================
u1, u2 = centers

cross_vec = np.cross(u1, u2)
norm_cross = np.linalg.norm(cross_vec)

if norm_cross < 1e-6:
    plane_normal = np.array([np.nan, np.nan, np.nan])
    print("\nPlane normal undefined (degenerate axis: planar motion)")
else:
    plane_normal = cross_vec / norm_cross
    print("\nDerived plane normal:", plane_normal)
    
# =========================================================
# TRANSITIONS
# =========================================================
state = df["state"].values
transitions = np.where(np.diff(state) != 0)[0] + 1

print("\nTransitions:", len(transitions))

# =========================================================
# DWELL TIMES (FIXED)
# =========================================================
dwell = []
start = 0

for t_idx in transitions:
    dt_years = t_years[t_idx] - t_years[start]
    dwell.append(dt_years)
    start = t_idx

dt_years = t_years[-1] - t_years[start]
dwell.append(dt_years)

dwell = np.array(dwell)

print("\nDwell stats:")
print("Mean:", np.mean(dwell))
print("Std :", np.std(dwell))
print("Min :", np.min(dwell))
print("Max :", np.max(dwell))

# =========================================================
# PLOTS
# =========================================================

# --- axis scatter (XY)
plt.figure()
for s in [0,1]:
    m = df["state"] == s
    plt.scatter(u[m,0], u[m,1], s=5, label=f"State {s}")

plt.legend()
plt.title("Axis projection (XY)")
plt.grid()
plt.savefig("fig_40_axis_states_xy.png", dpi=300)
plt.close()

# --- state vs time
plt.figure()
plt.plot(df["date"], df["state"], drawstyle="steps-post")
plt.title("State transitions")
plt.grid()
plt.savefig("fig_41_state_timeseries.png", dpi=300)
plt.close()

# --- dwell histogram
plt.figure()
plt.hist(dwell, bins=20)
plt.title("Dwell time distribution")
plt.grid()
plt.savefig("fig_42_dwell_times.png", dpi=300)
plt.close()

# =========================================================
# SAVE
# =========================================================
df.to_csv("axis_states_timeseries.csv", index=False)

pd.DataFrame({"dwell_years": dwell}).to_csv("axis_dwell_times.csv", index=False)

pd.DataFrame({
    "plane_normal_x": [plane_normal[0]],
    "plane_normal_y": [plane_normal[1]],
    "plane_normal_z": [plane_normal[2]],
}).to_csv("axis_plane_summary.csv", index=False)

print("\nSaved:")
print("- axis_states_timeseries.csv")
print("- axis_dwell_times.csv")
print("- axis_plane_summary.csv")
print("- fig_40–42")