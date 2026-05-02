#!/usr/bin/env python3
"""
Polar Azimuthal Projection Dashboard
-----------------------------------
Maps:
- SAA centroid drift
- Geomagnetic dip poles
- Polar motion (rotation pole)
- User-defined axes (great circle planes)

Projection: Azimuthal Equidistant (polar)
"""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

import cartopy.crs as ccrs
import cartopy.feature as cfeature

# =========================
# CONFIG
# =========================

SAA_FILE = "saa_centroids.csv"        # columns: time, lat, lon
POLE_FILE = "polar_motion.csv"        # columns: time, lat, lon
DIPOLE_FILE = "NP.xy.csv" # columns: time, lat, lon

PROJECTION = "north"  # "north" or "south"

# User-defined axes (longitude of great-circle plane normal)
AXES = {
    "Excursion Plane (~170E/10W)": -10.0,
    "Polar Motion Axis (~138E/42W)": -42.0,
    "ECDO Euler (~121E/59W)": -59.0,
}

# =========================
# UTILITIES
# =========================

import os

def load_csv_safe(path, name="dataset"):
    """
    Robust loader:
    - Handles missing files
    - Handles semicolon CSVs
    - Auto-detects lat/lon columns
    - Falls back to synthetic data
    """

    if not os.path.exists(path):
        print(f"[WARN] {name} file not found: {path}")
        print(f"[INFO] Generating synthetic {name} data...\n")
        return generate_synthetic_data(name)

    try:
        # Try standard CSV
        df = pd.read_csv(path)
    except:
        # Fallback: semicolon-delimited
        df = pd.read_csv(path, sep=";")

    df.columns = [c.strip().lower() for c in df.columns]

    # ---- Column normalization ----
    col_map = {}

    for col in df.columns:
        if "lat" in col:
            col_map[col] = "lat"
        elif "lon" in col:
            col_map[col] = "lon"
        elif "time" in col or "date" in col:
            col_map[col] = "time"

    df = df.rename(columns=col_map)

    # ---- Validation ----
    if "lat" not in df or "lon" not in df:
        raise ValueError(f"{name} missing lat/lon columns after parsing")

    return df

def generate_synthetic_data(name, n=200):
    t = np.linspace(0, 1, n)

    if name == "SAA":
        lat = -25 + 2*np.sin(2*np.pi*t)
        lon = -50 - 10*t  # westward drift

    elif name == "Pole":
        lat = 89.9 - 0.1*np.sin(2*np.pi*t)
        lon = 0 + 20*np.cos(2*np.pi*t)

    elif name == "Dipole":
        lat = 80 + 2*np.sin(2*np.pi*t)
        lon = -70 - 5*t

    else:
        lat = np.zeros(n)
        lon = np.zeros(n)

    return pd.DataFrame({
        "time": np.arange(n),
        "lat": lat,
        "lon": lon
    })    

def wrap_lon(lon):
    """Wrap longitude to [-180, 180]"""
    return ((lon + 180) % 360) - 180


def great_circle_from_axis(lon_deg, n=360):
    """
    Returns lat/lon points for a great circle plane defined by longitude.
    This represents a meridian plane (axis).
    """
    lats = np.linspace(-90, 90, n)
    lons = np.full_like(lats, wrap_lon(lon_deg))
    return lats, lons


def setup_projection():
    if PROJECTION == "south":
        proj = ccrs.AzimuthalEquidistant(central_latitude=-90)
    else:
        proj = ccrs.AzimuthalEquidistant(central_latitude=90)
    return proj


# =========================
# MAIN
# =========================

def main():

    # ---- Load data ----
    saa = load_csv_safe(SAA_FILE, "SAA")
    pole = load_csv_safe(POLE_FILE, "Pole")
    dip = load_csv_safe(DIPOLE_FILE, "Dipole")

    # ---- Projection ----
    proj = setup_projection()
    fig = plt.figure(figsize=(10, 10))
    ax = plt.axes(projection=proj)

    # ---- Base map ----
    ax.set_global()
    ax.coastlines(color="gray", linewidth=0.5)
    ax.add_feature(cfeature.LAND, alpha=0.2)
    ax.gridlines(draw_labels=False, linewidth=0.3, linestyle="--")

    # =========================
    # PLOT DATASETS
    # =========================

    def plot_track(df, label, marker):
        ax.plot(
            wrap_lon(df["lon"]),
            df["lat"],
            marker=marker,
            markersize=2,
            linestyle="-",
            transform=ccrs.PlateCarree(),
            label=label
        )

    plot_track(saa, "SAA Centroid", "o")
    plot_track(dip, "Geomagnetic Dip Pole", "^")

    # =========================
    # AXES (GREAT CIRCLES)
    # =========================

    for name, lon in AXES.items():
        lats, lons = great_circle_from_axis(lon)
        ax.plot(
            lons,
            lats,
            linestyle="--",
            transform=ccrs.PlateCarree(),
            label=name
        )

    # =========================
    # MARK CURRENT POSITIONS
    # =========================

    def mark_latest(df, color):
        lat = df["lat"].iloc[-1]
        lon = wrap_lon(df["lon"].iloc[-1])
        ax.scatter(
            lon, lat,
            transform=ccrs.PlateCarree(),
            s=60
        )

    mark_latest(saa, "red")
    mark_latest(pole, "blue")
    mark_latest(dip, "green")

    # =========================
    # TITLE / LEGEND
    # =========================

    ax.set_title(
        f"Polar Azimuthal Projection ({PROJECTION.capitalize()})\n"
        "SAA, Geomagnetic, and Rotational Axes"
    )

    ax.legend(loc="lower left")

    plt.tight_layout()
    plt.show()


# =========================
# ENTRY POINT (Apple-safe)
# =========================

if __name__ == "__main__":
    main()