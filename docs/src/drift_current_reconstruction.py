#!/usr/bin/env python3
"""
Drift field + probability current reconstruction
"""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy.ndimage import gaussian_filter1d

# -------------------------------
# CONFIG
# -------------------------------

SN_FILE = "sn_dynamics_v2.csv"

NBINS = 80
SMOOTH_SIGMA = 2.0
MIN_COUNT = 20   # minimum samples per bin

# -------------------------------
# LOAD
# -------------------------------

df = pd.read_csv(SN_FILE)

s = df["s"].values
t = df["t"].values if "t" in df.columns else np.arange(len(s))

# compute ds/dt
ds = np.gradient(s, t)

# -------------------------------
# BINNING
# -------------------------------

bins = np.linspace(np.min(s), np.max(s), NBINS + 1)
centers = 0.5 * (bins[:-1] + bins[1:])
digitized = np.digitize(s, bins) - 1

F = np.zeros(NBINS)
D = np.zeros(NBINS)
counts = np.zeros(NBINS)

for i in range(NBINS):
    mask = digitized == i
    counts[i] = np.sum(mask)

    if counts[i] > MIN_COUNT:
        ds_bin = ds[mask]

        F[i] = np.mean(ds_bin)
        D[i] = 0.5 * np.var(ds_bin)
    else:
        F[i] = np.nan
        D[i] = np.nan

# mask invalid
valid = ~np.isnan(F)
s_c = centers[valid]
F = F[valid]
D = D[valid]
counts = counts[valid]

# -------------------------------
# PROBABILITY DENSITY
# -------------------------------

hist, _ = np.histogram(s, bins=bins, density=True)
P = hist[valid]

# smooth everything
F_s = gaussian_filter1d(F, SMOOTH_SIGMA)
D_s = gaussian_filter1d(D, SMOOTH_SIGMA)
P_s = gaussian_filter1d(P, SMOOTH_SIGMA)

# -------------------------------
# POTENTIAL (from P)
# -------------------------------

eps = 1e-12
V = -np.log(P_s + eps)

# gradient of V
dV_ds = np.gradient(V, s_c)

# -------------------------------
# PROBABILITY CURRENT
# -------------------------------

# derivative term
d_DP_ds = np.gradient(D_s * P_s, s_c)

J = F_s * P_s - d_DP_ds

# -------------------------------
# PLOTS
# -------------------------------

plt.figure()
plt.plot(s_c, F_s, label="F(s) = <ds/dt|s>")
plt.plot(s_c, -dV_ds, label="-dV/ds")
plt.title("Drift vs Potential Gradient")
plt.xlabel("s")
plt.ylabel("value")
plt.legend()
plt.grid()
plt.show()

plt.figure()
plt.plot(s_c, D_s)
plt.title("Diffusion D(s)")
plt.xlabel("s")
plt.ylabel("D")
plt.grid()
plt.show()

plt.figure()
plt.plot(s_c, P_s)
plt.title("Probability density P(s)")
plt.xlabel("s")
plt.ylabel("P")
plt.grid()
plt.show()

plt.figure()
plt.plot(s_c, J)
plt.title("Probability current J(s)")
plt.xlabel("s")
plt.ylabel("J")
plt.grid()
plt.show()

# -------------------------------
# DIAGNOSTICS
# -------------------------------

# equilibrium test
alignment = np.corrcoef(F_s, -dV_ds)[0, 1]

print("\n--- DRIFT / EQUILIBRIUM TEST ---")
print("Correlation F vs -dV/ds:", alignment)

print("\n--- CURRENT STATS ---")
print("Mean |J|:", np.mean(np.abs(J)))
print("Max |J|:", np.max(np.abs(J)))

print("\n--- DIFFUSION ---")
print("Mean D:", np.mean(D_s))
print("Std D:", np.std(D_s))