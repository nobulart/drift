import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

# =========================================================
# LOAD (GEOMETRY-FIRST)
# =========================================================
df = pd.read_csv("filtered_series.csv", parse_dates=["date"])

# =========================================================
# CONFIG
# =========================================================
WINDOW = 365 * 2   # 2-year window

# =========================================================
# EXTRACT + GLOBAL MEAN CENTER (CRITICAL)
# =========================================================
x_all = df["x_filt"].values
y_all = df["y_filt"].values

x_all = x_all - np.mean(x_all)
y_all = y_all - np.mean(y_all)

# =========================================================
# ROLLING PCA
# =========================================================
dates = []
lambda1 = []
lambda2 = []
ratio = []
angle = []

prev_vec = None  # for orientation consistency

for i in range(WINDOW, len(df)):

    x = x_all[i-WINDOW:i]
    y = y_all[i-WINDOW:i]

    # window mean-center (IMPORTANT)
    x = x - np.mean(x)
    y = y - np.mean(y)

    X = np.vstack([x, y])

    # covariance (symmetric → use eigvalsh)
    C = np.cov(X)

    vals, vecs = np.linalg.eigh(C)

    # sort descending
    idx = np.argsort(vals)[::-1]
    vals = vals[idx]
    vecs = vecs[:, idx]

    l1, l2 = vals

    # anisotropy ratio
    r = l1 / (l1 + l2)

    # principal axis
    v = vecs[:, 0]

    # enforce sign consistency (avoid 180° flips)
    if prev_vec is not None:
        if np.dot(v, prev_vec) < 0:
            v = -v

    prev_vec = v

    ang = np.degrees(np.arctan2(v[1], v[0])) % 360

    dates.append(df["date"].iloc[i])
    lambda1.append(l1)
    lambda2.append(l2)
    ratio.append(r)
    angle.append(ang)

# =========================================================
# BUILD DF
# =========================================================
pca_df = pd.DataFrame({
    "date": dates,
    "lambda1": lambda1,
    "lambda2": lambda2,
    "variance_ratio": ratio,
    "principal_angle": angle
})

# =========================================================
# PRINT SUMMARY
# =========================================================
print("\n=== ROLLING PCA SUMMARY ===")
print("Mean variance ratio:", pca_df["variance_ratio"].mean())
print("Max  variance ratio:", pca_df["variance_ratio"].max())
print("Min  variance ratio:", pca_df["variance_ratio"].min())

print("\nMean principal angle:", pca_df["principal_angle"].mean())
print("Std  principal angle:", pca_df["principal_angle"].std())

# =========================================================
# ANGLE UNWRAP (for continuity)
# =========================================================
angle_unwrapped = np.unwrap(np.deg2rad(pca_df["principal_angle"]))
angle_unwrapped = np.rad2deg(angle_unwrapped)

# =========================================================
# PLOTS
# =========================================================

# 1. Principal axis (unwrapped)
plt.figure()
plt.plot(pca_df["date"], angle_unwrapped)
plt.ylabel("Angle (deg, unwrapped)")
plt.title("Principal Axis (Unwrapped)")
plt.grid()
plt.savefig("fig_16_principal_axis_unwrapped.png", dpi=300)
plt.close()

# 2. Variance ratio (dimensional collapse)
plt.figure()
plt.plot(pca_df["date"], pca_df["variance_ratio"])
plt.axhline(0.5, linestyle="--", label="Isotropic (2D)")
plt.axhline(0.9, linestyle="--", label="Strong anisotropy")

plt.legend()
plt.ylabel("Variance ratio (λ1 / total)")
plt.title("Dimensional Collapse (Rolling PCA)")
plt.grid()
plt.savefig("fig_13_variance_ratio.png", dpi=300)
plt.close()

# 3. Eigenvalues
plt.figure()
plt.plot(pca_df["date"], pca_df["lambda1"], label="λ1")
plt.plot(pca_df["date"], pca_df["lambda2"], label="λ2")

plt.legend()
plt.ylabel("Eigenvalue")
plt.title("Eigenvalue Evolution")
plt.grid()
plt.savefig("fig_14_eigenvalues.png", dpi=300)
plt.close()

# 4. Principal axis (wrapped)
plt.figure()
plt.plot(pca_df["date"], pca_df["principal_angle"])
plt.ylabel("Angle (deg)")
plt.title("Principal Axis Orientation")
plt.grid()
plt.savefig("fig_15_principal_axis.png", dpi=300)
plt.close()

# =========================================================
# SAVE
# =========================================================
pca_df.to_csv("rolling_pca_analysis.csv", index=False)

print("\nSaved:")
print("- rolling_pca_analysis.csv")