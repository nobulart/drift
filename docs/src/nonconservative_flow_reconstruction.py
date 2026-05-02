#!/usr/bin/env python3
"""
Non-conservative force extraction + phase flow reconstruction
"""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy.ndimage import gaussian_filter1d
from scipy.interpolate import interp1d

# -------------------------------
# CONFIG
# -------------------------------

SN_FILE = "sn_dynamics_v2.csv"

NBINS = 80
SMOOTH_SIGMA = 2.0
MIN_COUNT = 20

DT = 1.0
SIM_STEPS = 20000

# -------------------------------
# LOAD
# -------------------------------

df = pd.read_csv(SN_FILE)

s = df["s"].values
t = df["t"].values if "t" in df.columns else np.arange(len(s))

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

valid = ~np.isnan(F)

s_c = centers[valid]
F = F[valid]
D = D[valid]

# -------------------------------
# PROBABILITY + POTENTIAL
# -------------------------------

hist, _ = np.histogram(s, bins=bins, density=True)
P = hist[valid]

F_s = gaussian_filter1d(F, SMOOTH_SIGMA)
D_s = gaussian_filter1d(D, SMOOTH_SIGMA)
P_s = gaussian_filter1d(P, SMOOTH_SIGMA)

eps = 1e-12
V = -np.log(P_s + eps)
dV_ds = np.gradient(V, s_c)

# -------------------------------
# CURRENT + NON-CONSERVATIVE FORCE
# -------------------------------

d_DP_ds = np.gradient(D_s * P_s, s_c)
J = F_s * P_s - d_DP_ds

# two equivalent definitions
F_nc_1 = F_s + dV_ds
F_nc_2 = J / (P_s + eps)

# -------------------------------
# INTERPOLATORS (for simulation)
# -------------------------------

F_interp = interp1d(s_c, F_s, fill_value="extrapolate")
D_interp = interp1d(s_c, D_s, fill_value="extrapolate")

# -------------------------------
# SIMULATION (Euler–Maruyama)
# -------------------------------

s_sim = np.zeros(SIM_STEPS)
s_sim[0] = np.mean(s)

rng = np.random.default_rng(42)

for i in range(SIM_STEPS - 1):
    s_i = s_sim[i]

    drift = F_interp(s_i)
    diffusion = np.sqrt(2 * max(D_interp(s_i), 1e-8))

    noise = rng.normal()

    s_sim[i+1] = s_i + drift * DT + diffusion * np.sqrt(DT) * noise

# -------------------------------
# COMPARISON
# -------------------------------

# histogram comparison
hist_sim, bins_sim = np.histogram(s_sim, bins=50, density=True)
cent_sim = 0.5 * (bins_sim[:-1] + bins_sim[1:])

plt.figure()
plt.plot(s_c, P_s, label="data")
plt.plot(cent_sim, hist_sim, label="simulation")
plt.title("Probability density comparison")
plt.xlabel("s")
plt.ylabel("P(s)")
plt.legend()
plt.grid()
plt.show()

# drift comparison
plt.figure()
plt.plot(s_c, F_s, label="F(s)")
plt.plot(s_c, -dV_ds, label="-dV/ds")
plt.plot(s_c, F_nc_1, label="F_nc (F + dV/ds)")
plt.title("Force decomposition")
plt.xlabel("s")
plt.ylabel("value")
plt.legend()
plt.grid()
plt.show()

# current
plt.figure()
plt.plot(s_c, J)
plt.title("Probability current J(s)")
plt.xlabel("s")
plt.ylabel("J")
plt.grid()
plt.show()

# non-conservative consistency
plt.figure()
plt.plot(s_c, F_nc_1, label="F_nc (direct)")
plt.plot(s_c, F_nc_2, '--', label="F_nc (J/P)")
plt.title("Non-conservative force consistency")
plt.legend()
plt.grid()
plt.show()

# trajectory comparison
plt.figure()
plt.plot(s[:2000], label="data")
plt.plot(s_sim[:2000], label="simulation")
plt.title("Trajectory comparison")
plt.legend()
plt.grid()
plt.show()

# -------------------------------
# DIAGNOSTICS
# -------------------------------

corr = np.corrcoef(F_s, -dV_ds)[0,1]

print("\n--- FINAL SYSTEM DECOMPOSITION ---")
print("Correlation (F vs -dV/ds):", corr)

print("\nNon-conservative magnitude:")
print("Mean |F_nc|:", np.mean(np.abs(F_nc_1)))

print("\nCurrent magnitude:")
print("Mean |J|:", np.mean(np.abs(J)))

print("\nDiffusion:")
print("Mean D:", np.mean(D_s))