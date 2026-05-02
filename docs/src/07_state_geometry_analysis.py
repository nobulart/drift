import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy.stats import entropy

# =========================================================
# LOAD DATA (GEOMETRY-FIRST)
# =========================================================
df = pd.read_csv("filtered_series.csv", parse_dates=["date"])

# =========================================================
# MEAN CENTER (CRITICAL)
# =========================================================
x = df["x_filt"].values
y = df["y_filt"].values

x = x - np.mean(x)
y = y - np.mean(y)

df["x_c"] = x
df["y_c"] = y

# =========================================================
# PCA (GEOMETRIC)
# =========================================================
C = np.cov(x, y)
vals, vecs = np.linalg.eigh(C)

# sort descending
order = np.argsort(vals)[::-1]
vals = vals[order]
vecs = vecs[:, order]

principal_axis = vecs[:, 0]

principal_angle = np.degrees(
    np.arctan2(principal_axis[1], principal_axis[0])
) % 360

anisotropy_ratio = vals[0] / vals.sum()

# =========================================================
# ANGULAR DEVIATION FROM PRINCIPAL AXIS
# =========================================================
angles = np.degrees(np.arctan2(y, x)) % 360

def angular_distance(a, b):
    d = np.abs(a - b) % 360
    return np.minimum(d, 360 - d)

df["dist_principal"] = angular_distance(angles, principal_angle)

# =========================================================
# ENTROPY (ROLLING, GEOMETRIC)
# =========================================================
WINDOW = 365

def circular_histogram(angles_deg, bins=36):
    hist, _ = np.histogram(angles_deg, bins=bins, range=(0, 360), density=True)
    return hist + 1e-12

entropy_vals = []
dates = []

for i in range(WINDOW, len(df)):
    window = angles[i-WINDOW:i]

    hist = circular_histogram(window)
    H = entropy(hist)

    entropy_vals.append(H)
    dates.append(df["date"].iloc[i])

entropy_df = pd.DataFrame({
    "date": dates,
    "entropy": entropy_vals
})

# =========================================================
# OUTPUT SUMMARY
# =========================================================
print("\n=== GEOMETRIC ANALYSIS ===\n")

print(f"Principal axis angle (deg): {principal_angle:.2f}")
print(f"Anisotropy ratio (λ1 / Σλ): {anisotropy_ratio:.4f}")

print("\nAngular deviation from principal axis:")
print(f"Mean: {df['dist_principal'].mean():.2f} deg")
print(f"Std : {df['dist_principal'].std():.2f} deg")

print("\nEntropy:")
print(f"Mean entropy: {entropy_df['entropy'].mean():.4f}")
print(f"Std entropy : {entropy_df['entropy'].std():.4f}")

# =========================================================
# PLOTS
# =========================================================

# 1. Angular deviation over time
plt.figure()
plt.plot(df["date"], df["dist_principal"], linewidth=0.5)
plt.ylabel("Angular deviation (deg)")
plt.title("Deviation from Principal Axis")
plt.grid()
plt.savefig("fig_10_axis_deviation.png", dpi=300)
plt.close()

# 2. Entropy evolution
plt.figure()
plt.plot(entropy_df["date"], entropy_df["entropy"])
plt.ylabel("Entropy")
plt.title("Directional Entropy (Geometric)")
plt.grid()
plt.savefig("fig_11_entropy.png", dpi=300)
plt.close()

# 3. PCA phase space (correct)
plt.figure(figsize=(6,6))
plt.scatter(x, y, s=2)

# principal axis
v = principal_axis
plt.quiver(0, 0, v[0], v[1], scale=3)

plt.title("Phase Space with Principal Axis")
plt.axis("equal")
plt.grid()
plt.savefig("fig_12_pca.png", dpi=300)
plt.close()

# =========================================================
# SAVE
# =========================================================
df.to_csv("axis_distance_analysis.csv", index=False)
entropy_df.to_csv("entropy_analysis.csv", index=False)

print("\nSaved:")
print("- axis_distance_analysis.csv")
print("- entropy_analysis.csv")