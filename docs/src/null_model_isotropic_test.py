#!/usr/bin/env python3
"""
Null model: isotropic stochastic process

Tests whether observed anisotropy could arise by chance
"""

import numpy as np
import matplotlib.pyplot as plt

# -------------------------------
# CONFIG
# -------------------------------

N = 20000
DT = 1.0
SIGMA = 1.0
N_RUNS = 200

AXIS_DEG = 137.9

# -------------------------------
# FUNCTION: simulate isotropic RW
# -------------------------------

def simulate():
    x = np.zeros(N)
    y = np.zeros(N)

    for i in range(1, N):
        dx = np.random.normal(0, SIGMA)
        dy = np.random.normal(0, SIGMA)

        x[i] = x[i-1] + dx
        y[i] = y[i-1] + dy

    return x, y

# -------------------------------
# METRIC: axis alignment
# -------------------------------

def axis_ratio(x, y):
    dx = np.gradient(x)
    dy = np.gradient(y)

    theta = np.deg2rad(AXIS_DEG)
    axis = np.array([np.cos(theta), np.sin(theta)])
    orth = np.array([-np.sin(theta), np.cos(theta)])

    Fp = dx * axis[0] + dy * axis[1]
    Fo = dx * orth[0] + dy * orth[1]

    return np.mean(np.abs(Fp)) / (np.mean(np.abs(Fo)) + 1e-12)

# -------------------------------
# RUN MONTE CARLO
# -------------------------------

ratios = []

for i in range(N_RUNS):
    x, y = simulate()
    r = axis_ratio(x, y)
    ratios.append(r)

ratios = np.array(ratios)

# -------------------------------
# COMPARE
# -------------------------------

OBSERVED = 8.37459680867902  # your value

p_value = np.mean(ratios >= OBSERVED)

print("\n--- NULL MODEL ---")
print("Mean ratio:", np.mean(ratios))
print("Std:", np.std(ratios))
print("Observed:", OBSERVED)
print("p-value:", p_value)

# -------------------------------
# PLOT
# -------------------------------

plt.figure()
plt.hist(ratios, bins=40)
plt.axvline(OBSERVED)
plt.title("Null distribution of anisotropy ratio")
plt.grid()
plt.show()