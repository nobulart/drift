#!/usr/bin/env python3
"""
Projection to (s, n) with continuity-constrained tracking

Fixes:
- Eliminates KD-tree branch switching
- Enforces local continuity in s(t)
- Produces valid ds/dt

Requires:
- filtered_series.csv
- manifold_geometry_v4.csv
"""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

# -------------------------------
# CONFIG
# -------------------------------

INPUT_SERIES = "filtered_series.csv"
INPUT_MANIFOLD = "manifold_geometry_v4.csv"

X_COL = "x_filt"
Y_COL = "y_filt"

# continuity window (in manifold index space)
WINDOW = 50          # search radius around previous index (tune 20–100)
MAX_JUMP = 100       # hard cap to prevent pathological jumps

# -------------------------------
# LOAD
# -------------------------------

df = pd.read_csv(INPUT_SERIES)
x = df[X_COL].values
y = df[Y_COL].values

man = pd.read_csv(INPUT_MANIFOLD)

mx = man["x"].values
my = man["y"].values
s_man = man["s"].values
nx = man["nx"].values
ny = man["ny"].values

N = len(mx)

# -------------------------------
# INITIALIZATION
# -------------------------------

# brute force for first point
d0 = (mx - x[0])**2 + (my - y[0])**2
idx_prev = np.argmin(d0)

indices = [idx_prev]

# -------------------------------
# CONTINUITY-CONSTRAINED TRACKING
# -------------------------------

for i in range(1, len(x)):
    xi, yi = x[i], y[i]

    # define local search window
    i_min = max(0, idx_prev - WINDOW)
    i_max = min(N, idx_prev + WINDOW)

    # compute distances in local window
    dx = mx[i_min:i_max] - xi
    dy = my[i_min:i_max] - yi
    dist2 = dx**2 + dy**2

    local_idx = np.argmin(dist2)
    idx = i_min + local_idx

    # safety: prevent large jumps
    if abs(idx - idx_prev) > MAX_JUMP:
        idx = idx_prev  # freeze instead of jumping

    indices.append(idx)
    idx_prev = idx

indices = np.array(indices)

# -------------------------------
# PROJECT TO (s, n)
# -------------------------------

s_vals = s_man[indices]

# signed normal distance
dx = x - mx[indices]
dy = y - my[indices]

n_vals = dx * nx[indices] + dy * ny[indices]

# -------------------------------
# DERIVATIVES
# -------------------------------

dt = 1.0  # adjust if known

ds_dt = np.gradient(s_vals, dt)
dn_dt = np.gradient(n_vals, dt)

# -------------------------------
# SAVE
# -------------------------------

pd.DataFrame({
    "s": s_vals,
    "n": n_vals,
    "ds_dt": ds_dt,
    "dn_dt": dn_dt
}).to_csv("sn_dynamics_v2.csv", index=False)

# -------------------------------
# PLOTS
# -------------------------------

plt.figure()
plt.plot(s_vals)
plt.title("s(t) — continuous manifold coordinate")
plt.grid()
plt.show()

plt.figure()
plt.plot(n_vals)
plt.title("n(t) — deviation from manifold")
plt.grid()
plt.show()

plt.figure()
plt.scatter(n_vals, dn_dt, s=2)
plt.title("(n, dn/dt) — transverse dynamics")
plt.xlabel("n")
plt.ylabel("dn/dt")
plt.grid()
plt.show()

plt.figure()
plt.scatter(s_vals, ds_dt, s=2)
plt.title("(s, ds/dt) — drift dynamics")
plt.xlabel("s")
plt.ylabel("ds/dt")
plt.grid()
plt.show()

# -------------------------------
# DIAGNOSTICS
# -------------------------------

print("\n--- DYNAMICS SUMMARY (v2) ---")
print("n std:", np.std(n_vals))
print("ds/dt mean:", np.mean(ds_dt))
print("ds/dt std:", np.std(ds_dt))
print("dn/dt std:", np.std(dn_dt))