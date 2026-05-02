import numpy as np
import pandas as pd

# =========================================================
# LOAD
# =========================================================
df = pd.read_csv("axis_plane_summary.csv")

n = df.loc[0, ["plane_normal_x", "plane_normal_y", "plane_normal_z"]].values
n = np.array(n, dtype=float)

# =========================================================
# VALIDITY CHECK (CRITICAL)
# =========================================================
if not np.all(np.isfinite(n)) or np.linalg.norm(n) < 1e-6:
    print("\nPlane normal is undefined (degenerate planar dynamics).")
    print("Earth-fixed plane alignment analysis is not applicable.")
    exit()

# normalize safely
n = n / np.linalg.norm(n)

print("\nPlane normal (unit):")
print(n)

# =========================================================
# DEFINE PLANES (ONLY IF VALID)
# =========================================================
def plane_normal_from_longitude(lon_deg):
    lon = np.deg2rad(lon_deg)
    return np.array([np.sin(lon), -np.cos(lon), 0.0])

def angle(a, b):
    return np.rad2deg(np.arccos(np.clip(np.dot(a, b), -1, 1)))

# Earth-fixed planes
n_170 = plane_normal_from_longitude(170.0)
n_31  = plane_normal_from_longitude(31.0)
n_75W = plane_normal_from_longitude(-75.0)

# =========================================================
# ANGLES
# =========================================================
angle_170 = angle(n, n_170)
angle_31  = angle(n, n_31)
angle_75W = angle(n, n_75W)

print("\nPlane alignment angles (deg):")
print(f"170E : {angle_170:.3f}")
print(f"31E  : {angle_31:.3f}")
print(f"75W  : {angle_75W:.3f}")