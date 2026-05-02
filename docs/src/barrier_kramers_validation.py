#!/usr/bin/env python3
"""
Barrier heights + Kramers fitting + statistical validation + excursion comparison
"""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy.optimize import curve_fit

# -------------------------------
# CONFIG
# -------------------------------

POTENTIAL_FILE = "potential.csv"
STATES_FILE = "states.csv"
TRANSITIONS_FILE = "transitions.csv"
SN_FILE = "sn_dynamics_v2.csv"

N_BOOT = 500
DT = 1.0  # adjust if you know sampling interval

# -------------------------------
# LOAD
# -------------------------------

pot = pd.read_csv(POTENTIAL_FILE)
states = pd.read_csv(STATES_FILE)
trans = pd.read_csv(TRANSITIONS_FILE)
sn = pd.read_csv(SN_FILE)

s_grid = pot["s"].values
V = pot["V"].values

state_s = states["s_position"].values
state_ids = states["state_id"].values

# -------------------------------
# STEP 1: BARRIER HEIGHTS
# -------------------------------

def barrier_height(i, j):
    s1 = state_s[i]
    s2 = state_s[j]

    s_min = min(s1, s2)
    s_max = max(s1, s2)

    mask = (s_grid >= s_min) & (s_grid <= s_max)

    V_barrier = np.max(V[mask])
    V_well = min(V[np.argmin(np.abs(s_grid - s1))],
                 V[np.argmin(np.abs(s_grid - s2))])

    return V_barrier - V_well

pairs = []
for i in range(len(state_s) - 1):
    j = i + 1
    dV = barrier_height(i, j)
    pairs.append((i, j, dV))

pairs = pd.DataFrame(pairs, columns=["i", "j", "dV"])

# -------------------------------
# STEP 2: TRANSITION RATES
# -------------------------------

# compute dwell time per state
dwell = trans.groupby("from")["dwell_time"].mean()

rates = []
for _, row in pairs.iterrows():
    i, j, dV = int(row.i), int(row.j), row.dV
    
    if i in dwell:
        tau = dwell[i] * DT
        k = 1.0 / tau
    else:
        k = np.nan

    rates.append((i, j, dV, k))

rates = pd.DataFrame(rates, columns=["i", "j", "dV", "k"])

# drop invalid
rates = rates.dropna()

# -------------------------------
# STEP 3: KRAMERS FIT
# -------------------------------

def kramers(dV, A, D):
    return A * np.exp(-dV / D)

dV_vals = rates["dV"].values
k_vals = rates["k"].values

params, _ = curve_fit(kramers, dV_vals, k_vals, p0=[1.0, 1.0])
A_fit, D_fit = params

# -------------------------------
# STEP 4: BOOTSTRAP CONFIDENCE
# -------------------------------

boot_A = []
boot_D = []

rng = np.random.default_rng(42)

for _ in range(N_BOOT):
    sample = rates.sample(frac=1.0, replace=True)
    
    try:
        p, _ = curve_fit(kramers,
                         sample["dV"].values,
                         sample["k"].values,
                         p0=[1.0, 1.0],
                         maxfev=5000)
        boot_A.append(p[0])
        boot_D.append(p[1])
    except:
        continue

boot_A = np.array(boot_A)
boot_D = np.array(boot_D)

def conf(x):
    return np.percentile(x, [5, 50, 95])

A_ci = conf(boot_A)
D_ci = conf(boot_D)

# -------------------------------
# STEP 5: PLOT KRAMERS FIT
# -------------------------------

dV_plot = np.linspace(min(dV_vals), max(dV_vals), 100)
k_fit = kramers(dV_plot, A_fit, D_fit)

plt.figure()
plt.scatter(dV_vals, k_vals, label="data")
plt.plot(dV_plot, k_fit, label="Kramers fit")
plt.xlabel("Barrier height ΔV")
plt.ylabel("Transition rate k")
plt.title("Kramers Rate Fit")
plt.legend()
plt.grid()
plt.show()

# -------------------------------
# STEP 6: EXCURSION COMPARISON
# -------------------------------

# Identify "excursions" as large jumps in s
s_vals = sn["s"].values
ds = np.abs(np.diff(s_vals))

threshold = np.percentile(ds, 95)
excursions = np.where(ds > threshold)[0]

# convert to intervals
intervals = np.diff(excursions) * DT

plt.figure()
plt.hist(intervals, bins=30)
plt.title("Excursion interval distribution")
plt.xlabel("Δt")
plt.ylabel("count")
plt.grid()
plt.show()

# -------------------------------
# OUTPUT
# -------------------------------

print("\n--- BARRIER HEIGHTS ---")
print(pairs)

print("\n--- TRANSITION RATES ---")
print(rates)

print("\n--- KRAMERS FIT ---")
print("A =", A_fit)
print("D =", D_fit)

print("\n--- CONFIDENCE INTERVALS ---")
print("A (5,50,95):", A_ci)
print("D (5,50,95):", D_ci)

print("\n--- EXCURSION STATS ---")
print("Mean interval:", np.mean(intervals))
print("Std interval:", np.std(intervals))