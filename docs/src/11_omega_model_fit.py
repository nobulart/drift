import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

# =========================
# LOAD
# =========================
df = pd.read_csv("axis_angular_velocity.csv", parse_dates=["date"])

if "omega_filtered" in df.columns:
    omega = df["omega_filtered"].values
else:
    omega = df["omega_smooth"].values

dates = df["date"]

# =========================
# CLEAN (CRITICAL)
# =========================
omega = np.array(omega, dtype=float)
omega[np.isinf(omega)] = np.nan

mask = np.isfinite(omega)
omega = omega[mask]
dates = dates[mask]

# =========================
# TIME (years)
# =========================
t = pd.to_datetime(dates)
t_years = (t - t.iloc[0]).dt.total_seconds() / (365.25 * 24 * 3600)

# =========================
# LAGGED SERIES (TIME-CONSISTENT)
# =========================
x = omega[:-1]
y = omega[1:]
dt = np.diff(t_years)

# avoid tiny dt
dt[dt <= 0] = np.nan
dt = pd.Series(dt).interpolate(limit_direction="both").values

# =========================
# AR(1) FIT (UNCHANGED FORM)
# =========================
X = np.vstack([x, np.ones_like(x)]).T
phi, c = np.linalg.lstsq(X, y, rcond=None)[0]

y_pred = phi * x + c
resid = y - y_pred

sigma = np.nanstd(resid)

print("\n=== AR(1) FIT ===")
print(f"phi (persistence): {phi:.6f}")
print(f"c (bias):         {c:.6f}")
print(f"sigma (noise):    {sigma:.6f}")

# =========================
# FIT QUALITY (ROBUST)
# =========================
var_y = np.nanvar(y)
var_resid = np.nanvar(resid)

r2 = 1 - var_resid / var_y if var_y > 0 else np.nan
print(f"R^2:              {r2:.6f}")

# =========================
# CONDITIONAL DRIFT F(ω)
# =========================
# use rate: dω/dt instead of Δω
dw = (y - x) / dt

# binning
bins = np.linspace(np.nanmin(x), np.nanmax(x), 60)
centers = 0.5 * (bins[:-1] + bins[1:])

drift = np.zeros_like(centers)
counts = np.zeros_like(centers)

for i in range(len(x)):
    idx = np.searchsorted(bins, x[i]) - 1
    if 0 <= idx < len(drift) and np.isfinite(dw[i]):
        drift[idx] += dw[i]
        counts[idx] += 1

# normalize safely
valid = counts > 30
drift[valid] /= counts[valid]

# =========================
# POTENTIAL RECONSTRUCTION (FIXED)
# =========================
centers_valid = centers[valid]
drift_valid = drift[valid]

# ensure sorted (safety)
order = np.argsort(centers_valid)
centers_valid = centers_valid[order]
drift_valid = drift_valid[order]

# integrate with variable spacing
U = np.zeros_like(centers_valid)
for i in range(1, len(U)):
    dx = centers_valid[i] - centers_valid[i-1]
    U[i] = U[i-1] - drift_valid[i] * dx

U -= np.nanmin(U)

# =========================
# PLOTS
# =========================

# 1) AR(1)
plt.figure()
plt.scatter(x, y, s=1, alpha=0.5)
xx = np.linspace(np.min(x), np.max(x), 200)
plt.plot(xx, phi * xx + c)
plt.xlabel("ω(t)")
plt.ylabel("ω(t+1)")
plt.title("AR(1) Fit")
plt.savefig("fig_24_ar1_fit.png", dpi=200)
plt.close()

# 2) Residuals
plt.figure()
plt.hist(resid[np.isfinite(resid)], bins=100)
plt.title("Residual Distribution")
plt.xlabel("ε")
plt.savefig("fig_25_residuals.png", dpi=200)
plt.close()

# 3) Drift
plt.figure()
plt.plot(centers_valid, drift_valid)
plt.xlabel("ω")
plt.ylabel("dω/dt")
plt.title("Empirical Drift Function")
plt.savefig("fig_26_drift_function.png", dpi=200)
plt.close()

# 4) Potential
plt.figure()
plt.plot(centers_valid, U)
plt.xlabel("ω")
plt.ylabel("U(ω)")
plt.title("Reconstructed Potential")
plt.savefig("fig_27_potential.png", dpi=200)
plt.close()

# =========================
# SAVE SUMMARY
# =========================
summary = {
    "phi": phi,
    "c": c,
    "sigma": sigma,
    "r2": r2,
}

pd.DataFrame([summary]).to_csv("omega_model_fit.csv", index=False)

print("\nSaved:")
print("- omega_model_fit.csv")
print("- fig_24–27")