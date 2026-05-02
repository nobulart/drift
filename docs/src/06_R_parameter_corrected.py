import pandas as pd
import numpy as np

INPUT_FILE = "axis_distance_analysis.csv"
OUTPUT_FILE = "R_parameter_timeseries.csv"

# Candidate axes (must match projection script exactly)
AXES = [
    "zach_75W_parallel",
    "adhikari_100W_parallel",
    "observed_326_parallel"   # your ~45° dominant axis
]


def compute_R(row):
    values = np.array([abs(row[a]) for a in AXES])
    max_val = np.max(values)
    mean_val = np.mean(values)

    if mean_val == 0:
        return np.nan

    return max_val / mean_val


def compute_dominant_axis(row):
    values = {a: abs(row[a]) for a in AXES}
    return max(values, key=values.get)


def main():
    df = pd.read_csv(INPUT_FILE)

    # --- Compute R(t) ---
    df["R"] = df.apply(compute_R, axis=1)

    # --- Dominant axis tracking ---
    df["dominant_axis"] = df.apply(compute_dominant_axis, axis=1)

    # --- Optional: anisotropy strength ---
    df["anisotropy_excess"] = df["R"] - 1.0

    df.to_csv(OUTPUT_FILE, index=False)

    print("=== R PARAMETER ===")
    print(f"Mean R: {df['R'].mean()}")
    print(f"Max  R: {df['R'].max()}")
    print(f"Min  R: {df['R'].min()}")

    print("\nSaved:", OUTPUT_FILE)


if __name__ == "__main__":
    main()