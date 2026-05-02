import numpy as np
import pandas as pd

# ================================
# CONFIG
# ================================
INPUT_FILE = "filtered_series.csv"

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

mag = np.sqrt(vx**2 + vy**2)
valid = mag > 0

vx = vx[valid] / mag[valid]
vy = vy[valid] / mag[valid]

# embed in 3D (planar system)
vectors = np.stack([vx, vy, np.zeros_like(vx)], axis=1)
N = len(vectors)

# ================================
# l = 1 (DIPOLE)
# ================================
dipole = np.mean(vectors, axis=0)
dipole_mag = np.linalg.norm(dipole)

dipole_dir = dipole / dipole_mag if dipole_mag > 0 else dipole

# ================================
# l = 2 (QUADRUPOLE TENSOR)
# ================================
# Q_ij = <v_i v_j> - (1/3) δ_ij

Q = (vectors.T @ vectors) / N
Q -= np.eye(3) / 3.0

# eigen decomposition
eigvals, eigvecs = np.linalg.eigh(Q)

# sort descending
idx = np.argsort(eigvals)[::-1]
eigvals = eigvals[idx]
eigvecs = eigvecs[:, idx]

# ================================
# POWER (PROPER NORMALIZATION)
# ================================
# Total second moment trace = 1 for unit vectors
# So quadrupole power is Frobenius norm of Q

P2 = np.sum(eigvals**2)              # quadrupole power
P1 = dipole_mag**2                  # dipole power

# isotropic reference:
# for random unit vectors in plane:
# expected Q ≈ diag(1/2,1/2,0) - 1/3 I
# → eigenvalues ≈ [1/6, 1/6, -1/3]
P2_iso = (1/6)**2 + (1/6)**2 + (1/3)**2

# normalized anisotropy ratio
anisotropy_ratio = P2 / (P2 + P1 + 1e-12)

# ================================
# AXIS INTERPRETATION
# ================================
principal_axis = eigvecs[:, 0]   # max eigenvalue
secondary_axis = eigvecs[:, 1]
normal_axis = eigvecs[:, 2]      # plane normal

def vec_to_angles(v):
    theta = np.degrees(np.arccos(np.clip(v[2], -1, 1)))
    phi = np.degrees(np.arctan2(v[1], v[0])) % 360
    return theta, phi

principal_angles = vec_to_angles(principal_axis)
secondary_angles = vec_to_angles(secondary_axis)
normal_angles = vec_to_angles(normal_axis)
dipole_angles = vec_to_angles(dipole_dir)

# ================================
# ALIGNMENT DIAGNOSTICS
# ================================
# angle between dipole and quadrupole axis
alignment = np.degrees(np.arccos(
    np.clip(np.dot(dipole_dir, principal_axis), -1, 1)
)) if dipole_mag > 0 else np.nan

# ================================
# SAVE OUTPUT
# ================================
results = {
    "dipole_magnitude": dipole_mag,
    "dipole_theta": dipole_angles[0],
    "dipole_phi": dipole_angles[1],

    "quadrupole_eigenvalues": eigvals.tolist(),

    "principal_axis_theta": principal_angles[0],
    "principal_axis_phi": principal_angles[1],

    "secondary_axis_theta": secondary_angles[0],
    "secondary_axis_phi": secondary_angles[1],

    "normal_axis_theta": normal_angles[0],
    "normal_axis_phi": normal_angles[1],

    "quadrupole_power_P2": P2,
    "dipole_power_P1": P1,
    "anisotropy_ratio": anisotropy_ratio,
    "P2_isotropic_reference": P2_iso,

    "dipole_quadrupole_alignment_deg": alignment
}

pd.DataFrame([results]).to_csv("spherical_harmonics_summary.csv", index=False)

# ================================
# PRINT SUMMARY
# ================================
print("\n=== SPHERICAL HARMONIC DECOMPOSITION (FINAL) ===")

print(f"\nDipole magnitude: {dipole_mag:.6f}")
print(f"Dipole direction: θ={dipole_angles[0]:.2f}, φ={dipole_angles[1]:.2f}")

print("\nQuadrupole eigenvalues:")
print(eigvals)

print("\nPrincipal axis:")
print(f"θ={principal_angles[0]:.2f}, φ={principal_angles[1]:.2f}")

print("\nPlane normal:")
print(f"θ={normal_angles[0]:.2f}, φ={normal_angles[1]:.2f}")

print("\nPower diagnostics:")
print(f"P2 (quadrupole): {P2:.6f}")
print(f"P1 (dipole):     {P1:.6f}")
print(f"P2_iso ref:      {P2_iso:.6f}")
print(f"Anisotropy ratio: {anisotropy_ratio:.6f}")

print("\nDipole–quadrupole alignment:")
print(f"{alignment:.2f} degrees")

print("\nSaved: spherical_harmonics_summary.csv")