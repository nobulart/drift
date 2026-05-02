#!/usr/bin/env python3
"""
Robust manifold extraction (v4)

Key changes:
- NO phase assumptions
- Uses sliding window centroid extraction
- Guaranteed sufficient points
- Stable manifold reconstruction
"""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy.interpolate import splprep, splev

# -------------------------------
# CONFIG
# -------------------------------

INPUT_FILE = "filtered_series.csv"
X_COL = "x_filt"
Y_COL = "y_filt"

WINDOW = 200        # samples per window (tune 100–500)
STRIDE = 50         # overlap step
SMOOTHING_S = 5.0
ARC_RESOLUTION = 800

# -------------------------------
# LOAD DATA
# -------------------------------

df = pd.read_csv(INPUT_FILE)
x = df[X_COL].values
y = df[Y_COL].values

# -------------------------------
# STEP 1: SLIDING WINDOW CENTERS
# -------------------------------

centers = []

for i in range(0, len(x) - WINDOW, STRIDE):
    xs = x[i:i+WINDOW]
    ys = y[i:i+WINDOW]
    
    # reject near-empty windows
    if len(xs) < 10:
        continue
    
    cx = np.mean(xs)
    cy = np.mean(ys)
    
    centers.append([cx, cy])

centers = np.array(centers)

if len(centers) < 5:
    raise ValueError("Still too few centers — increase WINDOW or reduce STRIDE.")

centers_x = centers[:,0]
centers_y = centers[:,1]

print("Center count:", len(centers_x))

# -------------------------------
# STEP 2: LIGHT OUTLIER FILTER
# -------------------------------

mx, my = np.mean(centers_x), np.mean(centers_y)
dx = centers_x - mx
dy = centers_y - my
r = np.sqrt(dx**2 + dy**2)

mask = np.abs(r - np.median(r)) < 4 * np.std(r)

centers_x = centers_x[mask]
centers_y = centers_y[mask]

print("Post-filter count:", len(centers_x))

# -------------------------------
# STEP 3: ORDERING (NN)
# -------------------------------

def order_points_nn(x, y):
    pts = np.column_stack((x, y))
    N = len(pts)
    
    visited = np.zeros(N, dtype=bool)
    order = [0]
    visited[0] = True
    
    for _ in range(N - 1):
        last = order[-1]
        dists = np.linalg.norm(pts - pts[last], axis=1)
        dists[visited] = np.inf
        next_idx = np.argmin(dists)
        order.append(next_idx)
        visited[next_idx] = True
    
    return np.array(order)

order = order_points_nn(centers_x, centers_y)

centers_x = centers_x[order]
centers_y = centers_y[order]

# -------------------------------
# STEP 4: SPLINE (SAFE)
# -------------------------------

m = len(centers_x)
k = min(3, m - 1)

print("Spline degree:", k)

tck, u = splprep([centers_x, centers_y], s=SMOOTHING_S, k=k)

u_fine = np.linspace(0, 1, ARC_RESOLUTION)
x_s, y_s = splev(u_fine, tck)

dx, dy = splev(u_fine, tck, der=1)
ddx, ddy = splev(u_fine, tck, der=2)

# -------------------------------
# STEP 5: ARC LENGTH
# -------------------------------

ds = np.sqrt(dx**2 + dy**2) + 1e-8
s = np.cumsum(ds)
s -= s[0]

# -------------------------------
# STEP 6: TANGENT / NORMAL
# -------------------------------

theta = np.arctan2(dy, dx)

tx = dx / ds
ty = dy / ds

nx = -ty
ny = tx

# -------------------------------
# STEP 7: CURVATURE
# -------------------------------

curvature = (dx * ddy - dy * ddx) / (ds**3)

# smooth curvature
curvature = pd.Series(curvature).rolling(21, center=True).mean().values

# -------------------------------
# SAVE
# -------------------------------

pd.DataFrame({
    "x_center": centers_x,
    "y_center": centers_y
}).to_csv("manifold_centers_v4.csv", index=False)

pd.DataFrame({
    "s": s,
    "x": x_s,
    "y": y_s,
    "theta": theta,
    "curvature": curvature,
    "tx": tx,
    "ty": ty,
    "nx": nx,
    "ny": ny
}).to_csv("manifold_geometry_v4.csv", index=False)

# -------------------------------
# PLOTS
# -------------------------------

plt.figure()
plt.plot(x, y, alpha=0.15)
plt.scatter(centers_x, centers_y, s=10)
plt.plot(x_s, y_s, linewidth=2)
plt.title("Manifold Extraction (v4)")
plt.grid()
plt.show()

plt.figure()
plt.plot(s, theta)
plt.title("Tangent Angle")
plt.grid()
plt.show()

plt.figure()
plt.plot(s, curvature)
plt.title("Curvature")
plt.grid()
plt.show()

# -------------------------------
# SUMMARY
# -------------------------------

# Circular mean and variance

sin_mean = np.nanmean(np.sin(theta))
cos_mean = np.nanmean(np.cos(theta))

mean_angle = np.arctan2(sin_mean, cos_mean)
mean_angle_deg = np.degrees(mean_angle)

# Circular spread (0 = perfect alignment, 1 = random)
R = np.sqrt(sin_mean**2 + cos_mean**2)
circular_std = np.sqrt(-2 * np.log(R))
circular_std_deg = np.degrees(circular_std)

print("\n--- CIRCULAR STATISTICS ---")
print("Mean direction (deg):", mean_angle_deg)
print("Circular std (deg):", circular_std_deg)
print("Resultant length R:", R)