#!/usr/bin/env python3
"""
2D vector field reconstruction + curl + streamlines (robust version)
"""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy.ndimage import gaussian_filter
from scipy.interpolate import griddata

# -------------------------------
# CONFIG
# -------------------------------

INPUT_FILE = "manifold_geometry.csv"
NBINS = 60
MIN_COUNT = 10
SMOOTH_SIGMA = 1.5

# your axis (degrees)
AXIS_DEG = 137.9

# -------------------------------
# LOAD DATA (ROBUST)
# -------------------------------

df = pd.read_csv(INPUT_FILE)

# auto-detect columns
if "x_res" in df.columns:
    x = df["x_res"].values
    y = df["y_res"].values
elif "x" in df.columns:
    x = df["x"].values
    y = df["y"].values
else:
    raise ValueError(f"Available columns: {df.columns.tolist()}")

t = df["t"].values if "t" in df.columns else np.arange(len(x))

# derivatives
dx = np.gradient(x, t)
dy = np.gradient(y, t)

# -------------------------------
# GRID
# -------------------------------

x_bins = np.linspace(np.min(x), np.max(x), NBINS)
y_bins = np.linspace(np.min(y), np.max(y), NBINS)

x_centers = 0.5 * (x_bins[:-1] + x_bins[1:])
y_centers = 0.5 * (y_bins[:-1] + y_bins[1:])

Xc, Yc = np.meshgrid(x_centers, y_centers)

Fx = np.zeros_like(Xc)
Fy = np.zeros_like(Yc)
counts = np.zeros_like(Xc)

# -------------------------------
# BINNING
# -------------------------------

for i in range(len(x)):
    ix = np.searchsorted(x_bins, x[i]) - 1
    iy = np.searchsorted(y_bins, y[i]) - 1

    if 0 <= ix < NBINS-1 and 0 <= iy < NBINS-1:
        Fx[iy, ix] += dx[i]
        Fy[iy, ix] += dy[i]
        counts[iy, ix] += 1

mask = counts > MIN_COUNT

Fx[mask] /= counts[mask]
Fy[mask] /= counts[mask]

Fx[~mask] = np.nan
Fy[~mask] = np.nan

# -------------------------------
# SMOOTH (CRITICAL)
# -------------------------------

Fx_s = gaussian_filter(np.nan_to_num(Fx), SMOOTH_SIGMA)
Fy_s = gaussian_filter(np.nan_to_num(Fy), SMOOTH_SIGMA)

# -------------------------------
# CURL
# -------------------------------

dx_grid = x_centers[1] - x_centers[0]
dy_grid = y_centers[1] - y_centers[0]

dFy_dx = np.gradient(Fy_s, dx_grid, axis=1)
dFx_dy = np.gradient(Fx_s, dy_grid, axis=0)

curl = dFy_dx - dFx_dy

# -------------------------------
# INTERPOLATION (SAFE)
# -------------------------------

points = np.column_stack((Xc.flatten(), Yc.flatten()))
Fx_flat = Fx_s.flatten()
Fy_flat = Fy_s.flatten()

valid = ~np.isnan(Fx_flat)

points_valid = points[valid]
Fx_valid = Fx_flat[valid]
Fy_valid = Fy_flat[valid]

# fallback to linear if cubic fails
method = "linear"

Xi = np.linspace(np.min(x), np.max(x), 200)
Yi = np.linspace(np.min(y), np.max(y), 200)
Xi, Yi = np.meshgrid(Xi, Yi)

Fx_i = griddata(points_valid, Fx_valid, (Xi, Yi), method=method)
Fy_i = griddata(points_valid, Fy_valid, (Xi, Yi), method=method)

# -------------------------------
# AXIS PROJECTION (NEW)
# -------------------------------

theta = np.deg2rad(AXIS_DEG)
axis_vec = np.array([np.cos(theta), np.sin(theta)])
orth_vec = np.array([-np.sin(theta), np.cos(theta)])

Fmag = np.sqrt(Fx_s**2 + Fy_s**2)

F_axis = Fx_s * axis_vec[0] + Fy_s * axis_vec[1]
F_orth = Fx_s * orth_vec[0] + Fy_s * orth_vec[1]

# -------------------------------
# PLOTS
# -------------------------------

# trajectory
plt.figure()
plt.plot(x, y, alpha=0.3)
plt.title("Trajectory")
plt.grid()

# vector field
plt.figure()
plt.quiver(Xc, Yc, Fx_s, Fy_s)
plt.title("Vector field F(x,y)")
plt.grid()

# streamlines
plt.figure()
plt.streamplot(Xi, Yi, Fx_i, Fy_i, density=1.3)
plt.title("Streamlines")
plt.grid()

# curl
plt.figure()
plt.contourf(Xc, Yc, curl, levels=30)
plt.colorbar(label="curl")
plt.title("Curl")
plt.grid()

# overlay
plt.figure()
plt.streamplot(Xi, Yi, Fx_i, Fy_i, density=1.2)
plt.plot(x, y, 'k-', alpha=0.3)
plt.title("Flow + trajectory")
plt.grid()

# axis projection
plt.figure()
plt.contourf(Xc, Yc, F_axis, levels=30)
plt.colorbar(label="F_parallel")
plt.title(f"Flow along axis {AXIS_DEG}°")
plt.grid()

plt.figure()
plt.contourf(Xc, Yc, F_orth, levels=30)
plt.colorbar(label="F_perp")
plt.title("Flow orthogonal to axis")
plt.grid()

plt.show()

# -------------------------------
# DIAGNOSTICS
# -------------------------------

print("\n--- VECTOR FIELD ---")
print("Mean |F|:", np.nanmean(Fmag))

print("\n--- CURL ---")
print("Mean curl:", np.nanmean(curl))
print("Max |curl|:", np.nanmax(np.abs(curl)))

print("\n--- AXIS ALIGNMENT ---")
print("Mean |F_parallel|:", np.nanmean(np.abs(F_axis)))
print("Mean |F_perp|:", np.nanmean(np.abs(F_orth)))
print("Ratio (parallel/perp):", 
      np.nanmean(np.abs(F_axis)) / (np.nanmean(np.abs(F_orth)) + 1e-12))