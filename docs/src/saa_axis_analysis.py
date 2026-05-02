#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import numpy as np
import matplotlib.pyplot as plt
from concurrent.futures import ProcessPoolExecutor
import multiprocessing as mp
from chaosmagpy import load_CHAOS_matfile
from datetime import datetime
import os

# -------------------------------
# CONFIG
# -------------------------------

LAT_RES = 2.0
LON_RES = 2.0
YEARS = np.arange(2000, 2025, 1)

AXIS_LAT = 0.0
AXIS_LON = -42.1
N_NULL = 200

CHAOS_FILE = "CHAOS-7.mat"

if not os.path.exists(CHAOS_FILE):
    raise FileNotFoundError("CHAOS-7.mat not found")

# -------------------------------
# GRID
# -------------------------------

lat = np.arange(-89, 89 + LAT_RES, LAT_RES)
lon = np.arange(-180, 180 + LON_RES, LON_RES)
LAT2D, LON2D = np.meshgrid(lat, lon, indexing='ij')

# -------------------------------
# GEOMETRY
# -------------------------------

def sph_to_cart(lat_deg, lon_deg):
    lat = np.radians(lat_deg)
    lon = np.radians(lon_deg)
    x = np.cos(lat) * np.cos(lon)
    y = np.cos(lat) * np.sin(lon)
    z = np.sin(lat)
    return np.stack([x, y, z], axis=-1)

def compute_centroid(mask):
    if np.sum(mask) < 20:
        return None

    xyz = sph_to_cart(LAT2D, LON2D)
    weights = mask * np.cos(np.radians(LAT2D))

    C = (xyz * weights[..., None]).sum(axis=(0, 1))
    norm = np.linalg.norm(C)

    if norm == 0:
        return None

    return C / norm

# Axis vector
n = sph_to_cart(AXIS_LAT, AXIS_LON)[0]

# -------------------------------
# CHAOS MODEL
# -------------------------------

model = load_CHAOS_matfile(CHAOS_FILE)

def year_to_mjd(year):
    dt = datetime(int(year), 7, 1)
    mjd0 = datetime(1858, 11, 17)
    return (dt - mjd0).days

def compute_B(mjd):
    theta = np.radians(90 - lat)
    phi = np.radians(lon)

    theta_grid, phi_grid = np.meshgrid(theta, phi, indexing='ij')

    Br, Bt, Bp = model.synth_values_tdep(
        mjd,
        6371.2,
        theta_grid,
        phi_grid,
        nmax=13
    )

    return np.sqrt(Br**2 + Bt**2 + Bp**2)

# -------------------------------
# WORKERS
# -------------------------------

def worker(year):
    mjd = year_to_mjd(year)
    B = compute_B(mjd)

    threshold = np.percentile(B, 10)
    mask = (B < threshold)

    return compute_centroid(mask)

# -------------------------------
# ANALYSIS
# -------------------------------

def clean_series(r_series):
    return np.array([r for r in r_series if r is not None])

def principal_direction(r_series):
    r_series = clean_series(r_series)

    if len(r_series) < 5:
        return None

    dr = np.diff(r_series, axis=0)

    norms = np.linalg.norm(dr, axis=1)
    dr = dr[norms > 0]

    if len(dr) < 3:
        return None

    C = np.cov(dr.T)

    # symmetric → eigh (stable)
    vals, vecs = np.linalg.eigh(C)
    v = vecs[:, np.argmax(vals)]

    return v / np.linalg.norm(v)

def angle_to_axis(v, n):
    return float(np.degrees(np.arccos(np.clip(np.dot(v, n), -1, 1))))

def mean_alignment(r_series, n):
    r_series = clean_series(r_series)
    aligns = []

    for i in range(len(r_series) - 1):
        dr = r_series[i+1] - r_series[i]
        norm = np.linalg.norm(dr)
        if norm == 0:
            continue
        dr /= norm
        aligns.append(np.dot(dr, n))

    return float(np.mean(aligns)) if aligns else np.nan

# -------------------------------
# NULL MODEL
# -------------------------------

def rotate_longitude(B, shift_deg):
    dlon = lon[1] - lon[0]
    shift_idx = int(shift_deg / dlon)
    return np.roll(B, shift_idx, axis=1)

def null_worker(seed):
    np.random.seed(seed)
    r_series = []

    for year in YEARS:
        mjd = year_to_mjd(year)
        B = compute_B(mjd)

        threshold = np.percentile(B, 10)
        B_rot = rotate_longitude(B, np.random.uniform(0, 360))

        mask = (B_rot < threshold)
        r = compute_centroid(mask)

        if r is not None:
            r_series.append(r)

    v = principal_direction(r_series)
    if v is None:
        return np.nan

    return float(angle_to_axis(v, n))

# -------------------------------
# MAIN
# -------------------------------

if __name__ == "__main__":
    ctx = mp.get_context("spawn")

    print("Computing centroids...")

    with ProcessPoolExecutor(mp_context=ctx) as ex:
        r_series = list(ex.map(worker, YEARS))

    r_clean = clean_series(r_series)
    print(f"Valid samples: {len(r_clean)}")

    # ---------------------------
    # OBSERVED
    # ---------------------------

    v = principal_direction(r_series)

    if v is None:
        print("Failed to compute principal direction")
        exit()

    angle = float(angle_to_axis(v, n))
    alignment = float(mean_alignment(r_series, n))

    print(f"\nAngle to axis (deg): {angle}")
    print(f"Mean directional alignment: {alignment}")

    # ---------------------------
    # NULL
    # ---------------------------

    print("\nRunning null ensemble...")

    with ProcessPoolExecutor(mp_context=ctx) as ex:
        null_angles = np.array(list(ex.map(null_worker, range(N_NULL))), dtype=float)

    null_angles = null_angles[np.isfinite(null_angles)]

    print(f"Valid null samples: {len(null_angles)}")

    if len(null_angles) == 0:
        print("Null failed")
        exit()

    p_value = float(np.mean(null_angles <= angle))

    print(f"Null mean angle: {np.mean(null_angles)}")
    print(f"p-value: {p_value}")

    # ---------------------------
    # PLOT
    # ---------------------------

    plt.figure()
    plt.hist(null_angles, bins=30)
    plt.axvline(angle)
    plt.title("Null Angle Distribution")
    plt.show()