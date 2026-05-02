#!/usr/bin/env python3
"""
Axis optimization + bootstrap uncertainty
"""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

# -------------------------------
# CONFIG
# -------------------------------

INPUT_FILE = "manifold_geometry_v4.csv"
N_BOOT = 300
ANGLE_RES = 0.5  # degrees

# -------------------------------
# LOAD
# -------------------------------

df = pd.read_csv(INPUT_FILE)

# robust column handling
x = df["x"].values
y = df["y"].values

# derivatives
dx = np.gradient(x)
dy = np.gradient(y)

# -------------------------------
# FUNCTION
# -------------------------------

def axis_ratio(theta_deg, dx, dy):
    theta = np.deg2rad(theta_deg)
    axis = np.array([np.cos(theta), np.sin(theta)])
    orth = np.array([-np.sin(theta), np.cos(theta)])

    Fp = dx * axis[0] + dy * axis[1]
    Fo = dx * orth[0] + dy * orth[1]

    return np.mean(np.abs(Fp)) / (np.mean(np.abs(Fo)) + 1e-12)

# -------------------------------
# GLOBAL SWEEP
# -------------------------------

angles = np.arange(0, 180, ANGLE_RES)
ratios = np.array([axis_ratio(a, dx, dy) for a in angles])

theta_star = angles[np.argmax(ratios)]

print("\n--- AXIS OPTIMIZATION ---")
print("Best angle (deg):", theta_star)
print("Max ratio:", np.max(ratios))

# -------------------------------
# BOOTSTRAP
# -------------------------------

boot_angles = []

N = len(dx)

for _ in range(N_BOOT):
    idx = np.random.choice(N, N, replace=True)

    dx_b = dx[idx]
    dy_b = dy[idx]

    ratios_b = [axis_ratio(a, dx_b, dy_b) for a in angles]
    boot_angles.append(angles[np.argmax(ratios_b)])

boot_angles = np.array(boot_angles)

# confidence intervals
ci_5, ci_50, ci_95 = np.percentile(boot_angles, [5, 50, 95])

print("\n--- BOOTSTRAP ---")
print("Median angle:", ci_50)
print("5–95% CI:", ci_5, "-", ci_95)

# -------------------------------
# PLOT
# -------------------------------

plt.figure()
plt.plot(angles, ratios)
plt.axvline(theta_star)
plt.title("Axis optimization curve")
plt.xlabel("angle (deg)")
plt.ylabel("anisotropy ratio")
plt.grid()

plt.figure()
plt.hist(boot_angles, bins=30)
plt.title("Bootstrap axis distribution")
plt.xlabel("angle (deg)")
plt.grid()

plt.show()