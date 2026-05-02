#!/usr/bin/env python3
"""
Reduced SDE inference along manifold coordinate s

Outputs:
- drift f(s)
- diffusion D(s)
- potential V(s)
- diagnostics
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
NBINS = 80
SMOOTH = 2.0

# -------------------------------
# LOAD
# -------------------------------

df = pd.read_csv(INPUT_FILE)

s = df["s"].values
dsdt = df["ds_dt"].values

# estimate dt from index
t = np.arange(len(s))
dt = np.mean(np.diff(t))

# -------------------------------
# BINNING
# -------------------------------

bins = np.linspace(np.min(s), np.max(s), NBINS)
centers = 0.5 * (bins[:-1] + bins[1:])

f = np.zeros_like(centers)
D = np.zeros_like(centers)
counts = np.zeros_like(centers)

for i in range(len(s)-1):
    si = s[i]
    vi = dsdt[i]

    idx = np.searchsorted(bins, si) - 1
    if 0 <= idx < len(centers):
        f[idx] += vi
        counts[idx] += 1

# mean drift
mask = counts > 20
f[mask] /= counts[mask]
f[~mask] = np.nan

# diffusion (variance of increments)
for i in range(len(s)-1):
    si = s[i]
    dsi = s[i+1] - s[i]

    idx = np.searchsorted(bins, si) - 1
    if 0 <= idx < len(centers):
        D[idx] += (dsi**2) / (2 * dt)

D[mask] /= counts[mask]
D[~mask] = np.nan

# -------------------------------
# SMOOTH
# -------------------------------

f_s = gaussian_filter1d(np.nan_to_num(f), SMOOTH)
D_s = gaussian_filter1d(np.nan_to_num(D), SMOOTH)

# -------------------------------
# POTENTIAL
# -------------------------------

V = -cumulative_trapezoid(f_s, centers, initial=0)
V -= np.nanmin(V)

# -------------------------------
# PLOTS
# -------------------------------

plt.figure()
plt.plot(centers, f_s)
plt.title("Drift f(s)")
plt.grid()

plt.figure()
plt.plot(centers, D_s)
plt.title("Diffusion D(s)")
plt.grid()

plt.figure()
plt.plot(centers, V)
plt.title("Potential V(s)")
plt.grid()

# -------------------------------
# DIAGNOSTICS
# -------------------------------

print("\n--- SDE SUMMARY ---")
print("Mean |f|:", np.nanmean(np.abs(f_s)))
print("Mean D:", np.nanmean(D_s))

# save
pd.DataFrame({
    "s": centers,
    "f": f_s,
    "D": D_s,
    "V": V
}).to_csv("sde_inferred.csv", index=False)

plt.show()