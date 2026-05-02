import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

# =========================
# LOAD DATA
# =========================
df = pd.read_csv("axis_states_timeseries.csv")
df["date"] = pd.to_datetime(df["date"])

# =========================
# CLEAN TIMEBASE
# =========================
df = df.sort_values("date")
df = df.drop_duplicates(subset="date").reset_index(drop=True)

t = df["date"]
t_years = (t - t.iloc[0]).dt.total_seconds() / (365.25 * 24 * 3600)

t_years = np.array(t_years, dtype=float)
mask = np.diff(t_years, prepend=np.nan) > 0
df = df[mask].reset_index(drop=True)
t_years = t_years[mask]

# =========================
# TRAJECTORY (PLANAR)
# =========================
V = df[["x","y","z"]].values

# =========================
# PRIMARY PHASE (ONLY VALID DOF)
# =========================
theta = np.unwrap(np.arctan2(V[:,1], V[:,0]))
theta_deg = np.degrees(theta)

# =========================
# DERIVATIVE (SAFE)
# =========================
dt = np.diff(t_years)
dθ = np.diff(theta_deg)

valid = dt > 0
dt = dt[valid]
dθ = dθ[valid]

omega = dθ / dt

t_mid = t_years[1:][valid]
theta_mid = theta_deg[1:][valid]
states = df["state"].values[1:][valid]

# =========================
# 1) PHASE SPACE (REPLACES TORUS)
# =========================
plt.figure(figsize=(6,6))
plt.scatter(
    np.mod(theta_mid, 360),
    omega,
    s=5
)
plt.xlabel("θ (deg)")
plt.ylabel("ω (deg/year)")
plt.title("Phase Space (θ, ω)")
plt.grid(True)
plt.savefig("fig_70_phase_space.png", dpi=200)
plt.close()

# =========================
# 2) STATE-CONDITIONED POTENTIAL
# =========================
def compute_conditioned(theta, omega, states):
    results = []

    for s in np.unique(states):
        mask = states == s

        θ = theta[mask]
        ω = omega[mask]

        if len(θ) < 20:
            continue

        bins = np.linspace(np.min(θ), np.max(θ), 30)
        digitized = np.digitize(θ, bins)

        θc = []
        ωm = []

        for i in range(1, len(bins)):
            m = digitized == i
            if np.sum(m) > 5:
                θc.append(np.mean(θ[m]))
                ωm.append(np.mean(ω[m]))

        θc = np.array(θc)
        ωm = np.array(ωm)

        if len(θc) < 5:
            continue

        idx = np.argsort(θc)
        θc = θc[idx]
        ωm = ωm[idx]

        θrad = np.radians(θc)
        dθ_local = np.gradient(θrad)

        Vθ = -np.cumsum(ωm * dθ_local)
        Vθ -= np.nanmin(Vθ)

        plt.figure(figsize=(5,4))
        plt.plot(θc, Vθ)
        plt.title(f"V(θ) | state={s}")
        plt.grid(True)
        plt.savefig(f"fig_71_potential_state_{s}.png", dpi=200)
        plt.close()

        results.append((s, θc, ωm, Vθ))

    return results

state_results = compute_conditioned(theta_mid, omega, states)

# =========================
# 3) IMPULSE DETECTION (ROBUST)
# =========================
med = np.median(omega)
mad = np.median(np.abs(omega - med))

if mad == 0 or not np.isfinite(mad):
    threshold = med + 6 * np.std(omega)
else:
    threshold = med + 6 * mad

impulses = np.abs(omega) > threshold

impulse_times = t_mid[impulses]
impulse_strength = omega[impulses]

print(f"\nDetected impulses: {len(impulse_times)}")

# =========================
# PLOT IMPULSES
# =========================
plt.figure(figsize=(10,4))
plt.plot(t_mid, omega, label="ω")
plt.scatter(
    impulse_times,
    impulse_strength,
    s=20,
    label="impulses"
)
plt.legend()
plt.title("Impulse Detection")
plt.grid(True)
plt.savefig("fig_72_impulses.png", dpi=200)
plt.close()

# =========================
# SAVE IMPULSES
# =========================
out_imp = pd.DataFrame({
    "time": impulse_times,
    "omega": impulse_strength
})
out_imp.to_csv("impulses.csv", index=False)

# =========================
# 4) PHASE VELOCITY FIELD (1D CONSISTENT)
# =========================
plt.figure(figsize=(6,4))
plt.scatter(theta_mid, omega, s=5)
plt.xlabel("θ")
plt.ylabel("ω")
plt.title("Phase Velocity Structure")
plt.grid(True)
plt.savefig("fig_73_velocity_field.png", dpi=200)
plt.close()

print("\nSaved:")
print("- fig_70_phase_space.png")
print("- fig_71_potential_state_*.png")
print("- fig_72_impulses.png")
print("- fig_73_velocity_field.png")
print("- impulses.csv")