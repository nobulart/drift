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

dates = pd.to_datetime(df["date"])

# =========================
# CLEAN
# =========================
omega = np.array(omega, dtype=float)
omega[np.isinf(omega)] = np.nan

mask = np.isfinite(omega)
omega = omega[mask]
dates = dates[mask]

# =========================
# TIME (years) — CORRECT
# =========================
t_years = (dates - dates.iloc[0]).dt.total_seconds() / (365.25 * 24 * 3600)

# ensure strictly increasing
t_years = np.array(t_years, dtype=float)
dt = np.diff(t_years)

valid = dt > 0
mask2 = np.insert(valid, 0, True)

omega = omega[mask2]
dates = dates[mask2]
t_years = t_years[mask2]

dt = np.diff(t_years)

# =========================
# 1) INTEGRATE θ(t) (CORRECT)
# =========================
theta = np.zeros_like(omega)

for i in range(1, len(theta)):
    dt_i = t_years[i] - t_years[i-1]
    if dt_i <= 0:
        dt_i = 0.0
    theta[i] = theta[i-1] + omega[i] * dt_i

# wrapped version
theta_wrapped = (theta + 180) % 360 - 180

# =========================
# 2) PHASE-SPACE RECONSTRUCTION (CONSISTENT)
# =========================
x = np.cos(np.deg2rad(theta))
y = np.sin(np.deg2rad(theta))

# =========================
# 3) SAVE
# =========================
out = pd.DataFrame({
    "date": dates,
    "theta_deg": theta,
    "theta_wrapped": theta_wrapped,
    "x_phase": x,
    "y_phase": y
})

out.to_csv("theta_reconstruction.csv", index=False)

# =========================
# 4) PLOTS
# =========================

# θ(t)
plt.figure()
plt.plot(dates, theta_wrapped)
plt.title("Integrated Phase θ(t)")
plt.ylabel("Degrees")
plt.grid()
plt.savefig("fig_28_theta.png", dpi=200)
plt.close()

# phase space
plt.figure()
plt.plot(x, y)
plt.title("Phase Space (Unit Circle)")
plt.axis("equal")
plt.grid()
plt.savefig("fig_29_phase_space.png", dpi=200)
plt.close()

# phase histogram
plt.figure()
plt.hist(theta_wrapped, bins=100)
plt.title("Phase Distribution")
plt.xlabel("θ (deg)")
plt.savefig("fig_30_theta_hist.png", dpi=200)
plt.close()

print("\nSaved:")
print("- theta_reconstruction.csv")
print("- fig_28–30")