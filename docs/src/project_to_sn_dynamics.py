#!/usr/bin/env python3

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy.spatial import cKDTree

# -------------------------------
# LOAD DATA
# -------------------------------

# original time series
df = pd.read_csv("filtered_series.csv")
x = df["x_filt"].values
y = df["y_filt"].values

# manifold geometry
man = pd.read_csv("manifold_geometry_v4.csv")

mx = man["x"].values
my = man["y"].values
s_man = man["s"].values
tx = man["tx"].values
ty = man["ty"].values
nx = man["nx"].values
ny = man["ny"].values

# -------------------------------
# BUILD KD-TREE FOR PROJECTION
# -------------------------------

tree = cKDTree(np.column_stack((mx, my)))

# -------------------------------
# PROJECT POINTS → (s, n)
# -------------------------------

s_vals = []
n_vals = []

for xi, yi in zip(x, y):
    dist, idx = tree.query([xi, yi])
    
    # manifold point
    xm = mx[idx]
    ym = my[idx]
    
    # normal vector
    nx_i = nx[idx]
    ny_i = ny[idx]
    
    # displacement vector
    dx = xi - xm
    dy = yi - ym
    
    # signed normal coordinate
    n = dx * nx_i + dy * ny_i
    
    s_vals.append(s_man[idx])
    n_vals.append(n)

s_vals = np.array(s_vals)
n_vals = np.array(n_vals)

# -------------------------------
# TIME DERIVATIVES
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
}).to_csv("sn_dynamics.csv", index=False)

# -------------------------------
# PLOTS
# -------------------------------

# 1. s(t)
plt.figure()
plt.plot(s_vals)
plt.title("s(t) — Drift along manifold")
plt.grid()
plt.show()

# 2. n(t)
plt.figure()
plt.plot(n_vals)
plt.title("n(t) — Deviation from manifold")
plt.grid()
plt.show()

# 3. phase portrait in (n, dn/dt)
plt.figure()
plt.scatter(n_vals, dn_dt, s=2)
plt.title("Normal dynamics: (n, dn/dt)")
plt.xlabel("n")
plt.ylabel("dn/dt")
plt.grid()
plt.show()

# 4. drift dynamics
plt.figure()
plt.scatter(s_vals, ds_dt, s=2)
plt.title("Drift dynamics: (s, ds/dt)")
plt.xlabel("s")
plt.ylabel("ds/dt")
plt.grid()
plt.show()

# -------------------------------
# DIAGNOSTICS
# -------------------------------

print("\n--- DYNAMICS SUMMARY ---")
print("n std:", np.std(n_vals))
print("ds/dt mean:", np.mean(ds_dt))
print("ds/dt std:", np.std(ds_dt))
print("dn/dt std:", np.std(dn_dt))