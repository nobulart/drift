import numpy as np
import pandas as pd
from numpy.fft import fft, ifft

# ==============================
# Phase randomization surrogate
# ==============================
def phase_randomize(ts):
    f = fft(ts)
    mag = np.abs(f)
    phase = np.angle(f)

    rand_phase = np.random.uniform(0, 2*np.pi, len(phase))
    f_new = mag * np.exp(1j * rand_phase)

    return np.real(ifft(f_new))

# ==============================
# Directional energy
# ==============================
def directional_energy(x, y, phi):
    n = np.array([np.cos(phi), np.sin(phi)])
    p = np.vstack([x, y]).T
    proj = p @ n
    return np.mean(proj**2)

# ==============================
# Load filtered data
# ==============================
df = pd.read_csv("filtered_series.csv")

x = df["x_filt"].values
y = df["y_filt"].values

phis = np.linspace(0, 2*np.pi, 360)

# ==============================
# Compute real max energy
# ==============================
real_energy = np.array([directional_energy(x, y, phi) for phi in phis])
real_max = real_energy.max()

# ==============================
# Surrogate ensemble
# ==============================
N = 500
surrogate_max = []

for i in range(N):
    xs = phase_randomize(x)
    ys = phase_randomize(y)

    energy = np.array([directional_energy(xs, ys, phi) for phi in phis])
    surrogate_max.append(energy.max())

surrogate_max = np.array(surrogate_max)

# ==============================
# Statistics
# ==============================
p_value = np.mean(surrogate_max >= real_max)
z_score = (real_max - surrogate_max.mean()) / surrogate_max.std()

print("=== ANISOTROPY SIGNIFICANCE ===")
print(f"Real max energy: {real_max}")
print(f"Surrogate mean: {surrogate_max.mean()}")
print(f"Surrogate std: {surrogate_max.std()}")
print(f"Z-score: {z_score}")
print(f"p-value: {p_value}")

pd.DataFrame({
    "surrogate_max": surrogate_max
}).to_csv("anisotropy_surrogate_distribution.csv", index=False)