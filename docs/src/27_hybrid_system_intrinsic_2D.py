import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.linear_model import LinearRegression

# =========================
# LOAD DATA
# =========================
df = pd.read_csv("hybrid_system_corrected.csv")

theta1 = df["theta1"].values
theta2 = df["theta2"].values
state  = df["state"].values
impulse = df["impulse"].values

omega1 = df["omega1"].values
omega2 = df["omega2"].values

# =========================
# HELPERS
# =========================
def wrap(x):
    return x % 360

# =========================
# INTRINSIC COORDINATES
# =========================
phi = wrap(theta1 - theta2)     # TRUE dynamical coordinate
r   = wrap(theta1 + theta2)     # slow amplitude / modulation

phi_dot = omega1 - omega2
r_dot   = omega1 + omega2

# =========================
# FEATURE MAP
# =========================
def features(phi, r):
    p = np.radians(phi)
    q = np.radians(r)

    return np.array([
        np.sin(p), np.cos(p),
        np.sin(2*p), np.cos(2*p),

        np.sin(q), np.cos(q)
    ])

# =========================
# FIT VECTOR FIELD
# =========================
models_phi = {}
models_r   = {}

for s in np.unique(state):
    mask = state == s
    if np.sum(mask) < 50:
        continue

    idx = np.where(mask)[0]

    X = np.vstack([features(phi[i], r[i]) for i in idx])

    models_phi[s] = LinearRegression().fit(X, phi_dot[mask])
    models_r[s]   = LinearRegression().fit(X, r_dot[mask])

# =========================
# FIT RESET MAP (PHASE ONLY)
# =========================
reset_models = {}

for s in np.unique(state):
    mask = (state == s) & (impulse == 1)

    if np.sum(mask) < 20:
        continue

    X = phi[mask].reshape(-1,1)
    y = phi_dot[mask]

    reset_models[s] = LinearRegression().fit(X, y)

# =========================
# SWITCHING MANIFOLD Σ
# =========================
switch_mask = np.diff(state) != 0

Σ = np.vstack([
    wrap(theta1[:-1][switch_mask]),
    wrap(theta2[:-1][switch_mask])
]).T

def torus_dist(a, b):
    d = np.abs(a - b)
    d = np.minimum(d, 360 - d)
    return np.sqrt(np.sum(d**2, axis=-1))

def dist_to_S(t1, t2):
    p = np.array([wrap(t1), wrap(t2)])
    return np.min(torus_dist(Σ, p))

# =========================
# EMBEDDING (EXACT)
# =========================
def embed(phi, r):
    t1 = 0.5 * (phi + r)
    t2 = 0.5 * (r - phi)
    return wrap(t1), wrap(t2)

# =========================
# SIMULATION PARAMETERS
# =========================
N = 5000
dt = 0.01

phi_sim = np.zeros(N)
r_sim   = np.zeros(N)
state_sim = np.zeros(N, dtype=int)

phi_sim[0] = phi[0]
r_sim[0]   = r[0]
state_sim[0] = state[0]

theta1_sim = np.zeros(N)
theta2_sim = np.zeros(N)

rng = np.random.default_rng(42)

# HYSTERESIS (critical stability fix)
SWITCH_IN  = 6.0
SWITCH_OUT = 10.0
in_band = False

# =========================
# SIMULATION LOOP
# =========================
for i in range(N-1):

    s = state_sim[i]

    f = features(phi_sim[i], r_sim[i])

    # ----- FLOW -----
    dphi = models_phi[s].predict(f.reshape(1,-1))[0]
    dr   = models_r[s].predict(f.reshape(1,-1))[0]

    phi_new = wrap(phi_sim[i] + dphi * dt)
    r_new   = wrap(r_sim[i]   + dr   * dt)

    # ----- EMBED -----
    t1, t2 = embed(phi_new, r_new)

    # ----- SWITCHING (GEOMETRIC + HYSTERESIS) -----
    d = dist_to_S(t1, t2)

    if not in_band and d < SWITCH_IN:
        if rng.random() < 0.5:
            s_new = 1 - s
            in_band = True
        else:
            s_new = s

    elif in_band and d > SWITCH_OUT:
        in_band = False
        s_new = s

    else:
        s_new = s

    # ----- PHASE RESET (TARGET STATE) -----
    if s_new != s and s_new in reset_models:
        delta = reset_models[s_new].predict([[phi_sim[i]]])[0]
        phi_new = wrap(phi_new + 0.05 * delta)  # scaled injection

    # ----- STORE -----
    phi_sim[i+1] = phi_new
    r_sim[i+1]   = r_new
    state_sim[i+1] = s_new

    theta1_sim[i+1], theta2_sim[i+1] = t1, t2

# =========================
# PLOTS
# =========================
plt.figure(figsize=(6,6))
plt.scatter(theta1 % 360, theta2 % 360, s=2, alpha=0.3, label="data")
plt.scatter(theta1_sim, theta2_sim, s=2, alpha=0.3, label="sim")
plt.legend()
plt.grid()
plt.title("Intrinsic Phase Model (Final)")
plt.savefig("fig_final_phase.png", dpi=200)

plt.figure(figsize=(10,4))
plt.plot(theta1_sim[:1000])
plt.title("θ1 simulation")
plt.grid()
plt.savefig("fig_final_theta1.png", dpi=200)

plt.figure(figsize=(10,3))
plt.plot(state_sim[:1000])
plt.title("State sequence")
plt.grid()
plt.savefig("fig_final_state.png", dpi=200)

# =========================
# SAVE OUTPUT
# =========================
pd.DataFrame({
    "phi": phi_sim,
    "r": r_sim,
    "theta1": theta1_sim,
    "theta2": theta2_sim,
    "state": state_sim
}).to_csv("hybrid_simulation_final_intrinsic.csv", index=False)

print("\nSaved FINAL intrinsic model:")
print("- fig_final_phase.png")
print("- fig_final_theta1.png")
print("- fig_final_state.png")
print("- hybrid_simulation_final_intrinsic.csv")