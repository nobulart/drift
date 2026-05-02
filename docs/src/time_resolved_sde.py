#!/usr/bin/env python3
"""
Sliding-window SDE inference
"""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy.ndimage import gaussian_filter1d
from scipy.integrate import cumulative_trapezoid

# -------------------------------
# CONFIG
# -------------------------------

INPUT_FILE = "sn_dynamics_v2.csv"

WINDOW = 3000
STEP = 500
NBINS = 60
SMOOTH = 2.0

# -------------------------------
# LOAD
# -------------------------------

df = pd.read_csv(INPUT_FILE)

s = df["s"].values
dsdt = df["ds_dt"].values

t = np.arange(len(s))

# -------------------------------
# STORAGE
# -------------------------------

results = []

# -------------------------------
# LOOP
# -------------------------------

for start in range(0, len(s) - WINDOW, STEP):

    end = start + WINDOW

    s_w = s[start:end]
    v_w = dsdt[start:end]

    bins = np.linspace(np.min(s_w), np.max(s_w), NBINS)
    centers = 0.5 * (bins[:-1] + bins[1:])

    f = np.zeros_like(centers)
    D = np.zeros_like(centers)
    counts = np.zeros_like(centers)

    for i in range(len(s_w)-1):
        idx = np.searchsorted(bins, s_w[i]) - 1
        if 0 <= idx < len(centers):
            f[idx] += v_w[i]
            counts[idx] += 1

    mask = counts > 10
    f[mask] /= counts[mask]
    f[~mask] = np.nan

    for i in range(len(s_w)-1):
        idx = np.searchsorted(bins, s_w[i]) - 1
        if 0 <= idx < len(centers):
            ds = s_w[i+1] - s_w[i]
            D[idx] += ds**2

    D[mask] /= counts[mask]
    D[~mask] = np.nan

    f_s = gaussian_filter1d(np.nan_to_num(f), SMOOTH)
    D_s = gaussian_filter1d(np.nan_to_num(D), SMOOTH)

    V = -cumulative_trapezoid(f_s, centers, initial=0)

    # summarize each window
    results.append({
        "t_center": (start + end) / 2,
        "mean_f": np.nanmean(np.abs(f_s)),
        "mean_D": np.nanmean(D_s),
        "V_range": np.nanmax(V) - np.nanmin(V)
    })

# -------------------------------
# RESULTS
# -------------------------------

res = pd.DataFrame(results)

print("\n--- TIME-RESOLVED SDE ---")
print(res.describe())

# -------------------------------
# PLOTS
# -------------------------------

plt.figure()
plt.plot(res["t_center"], res["mean_f"])
plt.title("Drift magnitude over time")
plt.grid()

plt.figure()
plt.plot(res["t_center"], res["mean_D"])
plt.title("Diffusion over time")
plt.grid()

plt.figure()
plt.plot(res["t_center"], res["V_range"])
plt.title("Potential depth over time")
plt.grid()

plt.show()

# save
res.to_csv("time_resolved_sde.csv", index=False)