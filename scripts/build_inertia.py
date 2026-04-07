#!/usr/bin/env python3
"""
build_inertia.py

Process GRACE spherical harmonics (degree 2) to compute inertia tensor eigenframes.
Output: JSON time series of eigenvalues and eigenvectors.
"""

import json
import numpy as np
from datetime import datetime, timedelta
import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from data_paths import write_json


def gmf_to_inertia(gmf_data):
    """
    Convert GRACE geopotential coefficients to inertia tensor.

    For degree l=2, we use:
    - C20, C21, S21, C22, S22

    The inertia tensor components are proportional to:
    - Ixx = (2/3) * C20 * R^2
    - Iyy = -(1/3) * C20 * R^2
    - Izz = (1/3) * C20 * R^2
    - Off-diagonal terms from C21, S21, C22, S22
    """
    C20 = gmf_data.get("C20", 0)
    C21 = gmf_data.get("C21", 0)
    S21 = gmf_data.get("S21", 0)
    C22 = gmf_data.get("C22", 0)
    S22 = gmf_data.get("S21", 0)

    R = 6371000  # Earth's radius in meters

    Ixx = (2.0 / 3.0) * C20 * R**2
    Iyy = -(1.0 / 3.0) * C20 * R**2
    Izz = (1.0 / 3.0) * C20 * R**2

    Ixy = -(1.0 / 2.0) * (C21 - S21) * R**2
    Ixz = -(1.0 / 2.0) * (C21 + S21) * R**2
    Iyz = -(1.0 / 2.0) * (C22 - S22) * R**2

    inertia_tensor = np.array([[Ixx, Ixy, Ixz], [Ixy, Iyy, Iyz], [Ixz, Iyz, Izz]])

    return inertia_tensor


def compute_eigenframe(inertia_tensor):
    """
    Compute eigenvalues and eigenvectors of inertia tensor.
    Returns eigenvalues [I1, I2, I3] and eigenvectors [e1, e2, e3].
    """
    eigenvalues, eigenvectors = np.linalg.eigh(inertia_tensor)

    indices = np.argsort(eigenvalues)
    eigenvalues = eigenvalues[indices]
    eigenvectors = eigenvectors[:, indices]

    e1 = eigenvectors[:, 0].tolist()
    e2 = eigenvectors[:, 1].tolist()
    e3 = eigenvectors[:, 2].tolist()

    return eigenvalues.tolist(), [e1, e2, e3]


def generate_synthetic_inertia_data(n_days=12000, start_date=None):
    """
    Generate synthetic GRACE ℓ=2 data for demonstration.
    In production, this would parse actual GRACE L2 data files.
    """
    if start_date is None:
        start_date = datetime(2003, 1, 1)

    data = []

    for i in range(n_days):
        date = start_date + timedelta(days=i)

        C20 = -4.84e-4 + 1e-10 * i
        C21 = 2e-6 * np.sin(2 * np.pi * i / 365)
        S21 = 2e-6 * np.cos(2 * np.pi * i / 365)
        C22 = 1e-6 * np.cos(4 * np.pi * i / 365)
        S22 = 1e-6 * np.sin(4 * np.pi * i / 365)

        gmf_data = {
            "date": date.strftime("%Y-%m-%d"),
            "C20": C20,
            "C21": C21,
            "S21": S21,
            "C22": C22,
            "S22": S22,
        }

        inertia_tensor = gmf_to_inertia(gmf_data)
        eigenvalues, eigenvectors = compute_eigenframe(inertia_tensor)

        data.append(
            {
                "t": date.strftime("%Y-%m-%d"),
                "e1": eigenvectors[0],
                "e2": eigenvectors[1],
                "e3": eigenvectors[2],
                "lambda": eigenvalues,
            }
        )

    return data


def main():
    print("Generating synthetic GRACE ℓ=2 inertia tensor data...")
    data = generate_synthetic_inertia_data()

    output_file = write_json("inertia_timeseries.json", data)

    print(f"Saved {len(data)} data points to {output_file}")


if __name__ == "__main__":
    main()
