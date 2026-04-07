#!/usr/bin/env python3
"""
build_geomag.py

Combine geomagnetic activity indices (Kp, Dst, aa).
Output: JSON time series of geomagnetic indices.
"""

import json
import os
from datetime import datetime, timedelta
import numpy as np


def fetch_noaa_indices():
    """
    Fetch NOAA geomagnetic indices from API.
    Returns list of {t, kp, dst, aa} dictionaries.
    """
    import urllib.request
    import json as json_lib

    url = "https://services.swpc.noaa.gov/json/geomag/indices.json"

    try:
        with urllib.request.urlopen(url) as response:
            data = json_lib.loads(response.read().decode("utf-8"))

        return data
    except Exception as e:
        print(f"Error fetching NOAA data: {e}")
        return []


def generate_synthetic_geomag_data(n_days=5000, start_date=None):
    """
    Generate synthetic geomagnetic indices for demonstration.
    """
    if start_date is None:
        start_date = datetime(2003, 1, 1)

    data = []

    for i in range(n_days):
        date = start_date + timedelta(days=i)

        kp_base = 3.0 + 1.5 * np.sin(2 * np.pi * i / 365)
        kp = max(0, min(9, kp_base + np.random.randn() * 0.5))

        dst_base = -20 + 10 * np.sin(2 * np.pi * i / 365)
        dst = int(dst_base + np.random.randn() * 5)

        aa_base = 10 + 5 * np.sin(2 * np.pi * i / 365)
        aa = max(0, aa_base + np.random.randn() * 3)

        data.append(
            {
                "t": date.strftime("%Y-%m-%d"),
                "kp": round(kp, 2),
                "dst": dst,
                "aa": round(aa, 2),
            }
        )

    return data


def main():
    np.random.seed(42)

    output_dir = os.path.join(os.path.dirname(__file__), "..", "data")
    os.makedirs(output_dir, exist_ok=True)

    print("Generating synthetic geomagnetic activity data...")
    data = generate_synthetic_geomag_data()

    output_file = os.path.join(output_dir, "geomag_historic.json")
    with open(output_file, "w") as f:
        json.dump(data, f, indent=2)

    print(f"Saved {len(data)} data points to {output_file}")


if __name__ == "__main__":
    main()
