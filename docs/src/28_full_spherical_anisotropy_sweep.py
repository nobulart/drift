import numpy as np
import pandas as pd
from tqdm import tqdm

# ================================
# CONFIG
# ================================
INPUT_FILE = "filtered_series.csv"
GRID_RES = 2.0  # degrees
N_SURROGATES = 200  # increase to 1000 for publication

# ================================
# LOAD DATA
# ================================
df = pd.read_csv(INPUT_FILE)

x = df["x_filt"].values
y = df["y_filt"].values

# ================================
# VELOCITY (ROBUST)
# ================================
vx = np.gradient(x)
vy = np.gradient(y)

mask = np.isfinite(vx) & np.isfinite(vy)
vx = vx[mask]
vy = vy[mask]

v_mag = np.sqrt(vx**2 + vy**2)
valid = v_mag > 0

vx = vx[valid] / v_mag[valid]
vy = vy[valid] / v_mag[valid]

# embed in 3D
vectors = np.stack([vx, vy, np.zeros_like(vx)], axis=1)

# ================================
# SPHERE GRID
# ================================
theta = np.deg2rad(np.arange(0, 180, GRID_RES))
phi   = np.deg2rad(np.arange(0, 360, GRID_RES))

grid_dirs = []

for t in theta:
    for p in phi:
        grid_dirs.append([
            np.sin(t)*np.cos(p),
            np.sin(t)*np.sin(p),
            np.cos(t)
        ])

grid_dirs = np.array(grid_dirs)

# ================================
# PROJECTION ENERGY (REAL)
# ================================
print("Computing real projection energy...")

proj_energy = np.array([
    np.mean((vectors @ g)**2)
    for g in tqdm(grid_dirs)
])

real_max = np.max(proj_energy)

# ================================
# SURROGATE GENERATION
# ================================
def phase_randomize(v):
    """Preserve spectrum, destroy direction structure"""
    fft = np.fft.fft(v)
    phases = np.exp(2j * np.pi * np.random.rand(len(v)))
    return np.real(np.fft.ifft(np.abs(fft) * phases))

print("Running surrogate ensemble...")

surrogate_max = []

for _ in tqdm(range(N_SURROGATES)):

    vx_s = phase_randomize(vx)
    vy_s = phase_randomize(vy)

    mag = np.sqrt(vx_s**2 + vy_s**2)
    valid = mag > 0

    vx_s = vx_s[valid] / mag[valid]
    vy_s = vy_s[valid] / mag[valid]

    vec_s = np.stack([vx_s, vy_s, np.zeros_like(vx_s)], axis=1)

    energy_s = np.array([
        np.mean((vec_s @ g)**2)
        for g in grid_dirs
    ])

    surrogate_max.append(np.max(energy_s))

surrogate_max = np.array(surrogate_max)

# ================================
# SIGNIFICANCE
# ================================
mean_s = np.mean(surrogate_max)
std_s  = np.std(surrogate_max)

z_score = (real_max - mean_s) / (std_s + 1e-12)
p_value = np.mean(surrogate_max >= real_max)

print("\n=== ANISOTROPY SIGNIFICANCE ===")
print(f"Real max energy: {real_max}")
print(f"Surrogate mean: {mean_s}")
print(f"Surrogate std: {std_s}")
print(f"Z-score: {z_score}")
print(f"p-value: {p_value}")

# ================================
# DOMINANT DIRECTIONS
# ================================
top_idx = np.argsort(proj_energy)[-20:][::-1]

rows = []

for idx in top_idx:
    g = grid_dirs[idx]

    theta_deg = np.degrees(np.arccos(g[2]))
    phi_deg   = np.degrees(np.arctan2(g[1], g[0])) % 360

    rows.append({
        "theta_deg": theta_deg,
        "phi_deg": phi_deg,
        "energy": proj_energy[idx]
    })

top_df = pd.DataFrame(rows)

# ================================
# SAVE
# ================================
pd.DataFrame({
    "gx": grid_dirs[:,0],
    "gy": grid_dirs[:,1],
    "gz": grid_dirs[:,2],
    "energy": proj_energy
}).to_csv("anisotropy_sweep_full_sphere.csv", index=False)

top_df.to_csv("anisotropy_top_directions.csv", index=False)

with open("anisotropy_summary.txt", "w") as f:
    f.write(f"Real max energy: {real_max}\n")
    f.write(f"Surrogate mean: {mean_s}\n")
    f.write(f"Surrogate std: {std_s}\n")
    f.write(f"Z-score: {z_score}\n")
    f.write(f"p-value: {p_value}\n")

print("\nSaved:")
print("- anisotropy_sweep_full_sphere.csv")
print("- anisotropy_top_directions.csv")
print("- anisotropy_summary.txt")