import numpy as np
import pandas as pd
from scipy.linalg import eigh
from sklearn.mixture import GaussianMixture
from scipy.signal import lfilter
import warnings

warnings.filterwarnings("ignore")

# =========================
# LOAD DATA
# =========================

df = pd.read_csv("filtered_series.csv")

# Expect columns: x, y
x = df["x"].values
y = df["y"].values
X = np.vstack([x, y]).T

# =========================
# CORE FUNCTIONS
# =========================

def compute_pca_metrics(X):
    cov = np.cov(X.T)
    vals, vecs = eigh(cov)
    idx = np.argsort(vals)[::-1]
    vals = vals[idx]
    vecs = vecs[:, idx]

    axis = vecs[:, 0]
    angle = np.degrees(np.arctan2(axis[1], axis[0]))

    anisotropy = vals[0] / (vals[0] + vals[1])
    planarity = vals[1] / vals[0]

    return angle, anisotropy, planarity, axis


def compute_velocity(X):
    v = np.gradient(X, axis=0)
    return v


def directional_energy(v, g):
    proj = np.dot(v, g)
    return np.mean(proj**2)


# =========================
# (1) SMOOTHING SENSITIVITY
# =========================

print("\n=== (1) SMOOTHING SENSITIVITY ===")

window_sizes = [3, 7, 15, 31, 61]

results_smoothing = []

for W in window_sizes:
    kernel = np.ones(W) / W
    xs = np.convolve(x, kernel, mode='same')
    ys = np.convolve(y, kernel, mode='same')

    Xs = np.vstack([xs, ys]).T

    angle, anisotropy, planarity, _ = compute_pca_metrics(Xs)

    results_smoothing.append([W, angle, anisotropy, planarity])

df_smooth = pd.DataFrame(results_smoothing,
                         columns=["window", "axis_angle", "anisotropy", "planarity"])

df_smooth.to_csv("robustness_smoothing.csv", index=False)
print(df_smooth)


# =========================
# (2) THRESHOLD ROBUSTNESS
# =========================

print("\n=== (2) THRESHOLD ROBUSTNESS ===")

_, _, _, axis = compute_pca_metrics(X)

proj = X @ axis

# Mean threshold
state_mean = (proj > np.mean(proj)).astype(int)

# Median threshold
state_median = (proj > np.median(proj)).astype(int)

# GMM clustering
gmm = GaussianMixture(n_components=2, random_state=0).fit(proj.reshape(-1, 1))
state_gmm = gmm.predict(proj.reshape(-1, 1))


def count_transitions(s):
    return np.sum(np.abs(np.diff(s)))


def dwell_times(s):
    changes = np.where(np.diff(s) != 0)[0]
    if len(changes) < 2:
        return []
    return np.diff(changes)


results_states = {
    "method": [],
    "transitions": [],
    "mean_dwell": []
}

for name, s in [
    ("mean", state_mean),
    ("median", state_median),
    ("gmm", state_gmm)
]:
    results_states["method"].append(name)
    results_states["transitions"].append(count_transitions(s))

    dt = dwell_times(s)
    results_states["mean_dwell"].append(np.mean(dt) if len(dt) > 0 else np.nan)

df_states = pd.DataFrame(results_states)
df_states.to_csv("robustness_states.csv", index=False)
print(df_states)


# =========================
# (3) COLORED NOISE SURROGATE (AR1)
# =========================

print("\n=== (3) AR(1) SURROGATE TEST ===")

def estimate_ar1(series):
    x = series[:-1]
    y = series[1:]
    a = np.dot(x, y) / np.dot(x, x)
    return a


def generate_ar1(a, sigma, n):
    noise = np.random.normal(0, sigma, n)
    return lfilter([1], [1, -a], noise)


v = compute_velocity(X)
vx = v[:, 0]

a = estimate_ar1(vx)
sigma = np.std(vx)

n_surrogates = 200

anisotropy_vals = []

for _ in range(n_surrogates):
    xs = generate_ar1(a, sigma, len(x))
    ys = generate_ar1(a, sigma, len(y))

    Xs = np.vstack([xs, ys]).T
    _, anisotropy, _, _ = compute_pca_metrics(Xs)
    anisotropy_vals.append(anisotropy)

anisotropy_vals = np.array(anisotropy_vals)

real_aniso = compute_pca_metrics(X)[1]

z_score = (real_aniso - np.mean(anisotropy_vals)) / np.std(anisotropy_vals)

df_ar1 = pd.DataFrame({
    "real_anisotropy": [real_aniso],
    "surrogate_mean": [np.mean(anisotropy_vals)],
    "surrogate_std": [np.std(anisotropy_vals)],
    "z_score": [z_score]
})

df_ar1.to_csv("robustness_ar1.csv", index=False)
print(df_ar1)


# =========================
# (4) AXIS STABILITY NULL TEST
# =========================

print("\n=== (4) AXIS STABILITY NULL TEST ===")

def random_rotation_2d():
    theta = np.random.uniform(0, 2*np.pi)
    R = np.array([
        [np.cos(theta), -np.sin(theta)],
        [np.sin(theta),  np.cos(theta)]
    ])
    return R


real_angles = []

# Rolling axis (observed)
window = 365

for i in range(len(X) - window):
    Xw = X[i:i+window]
    angle, _, _, _ = compute_pca_metrics(Xw)
    real_angles.append(angle)

real_angles = np.unwrap(np.radians(real_angles))
real_std = np.std(real_angles)


# Null model
null_stds = []

for _ in range(200):
    Xr = X.copy()

    for i in range(len(Xr)):
        R = random_rotation_2d()
        Xr[i] = R @ Xr[i]

    angles = []

    for i in range(len(Xr) - window):
        Xw = Xr[i:i+window]
        angle, _, _, _ = compute_pca_metrics(Xw)
        angles.append(angle)

    angles = np.unwrap(np.radians(angles))
    null_stds.append(np.std(angles))

null_stds = np.array(null_stds)

z_axis = (real_std - np.mean(null_stds)) / np.std(null_stds)

df_axis = pd.DataFrame({
    "real_std": [real_std],
    "null_mean": [np.mean(null_stds)],
    "null_std": [np.std(null_stds)],
    "z_score": [z_axis]
})

df_axis.to_csv("robustness_axis_stability.csv", index=False)
print(df_axis)


# =========================
# FINAL SUMMARY
# =========================

print("\n=== ROBUSTNESS SUMMARY ===")
print(f"Smoothing invariance: see robustness_smoothing.csv")
print(f"State robustness: see robustness_states.csv")
print(f"AR1 significance Z: {z_score:.3f}")
print(f"Axis stability Z: {z_axis:.3f}")