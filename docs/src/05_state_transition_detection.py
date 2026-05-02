import pandas as pd
import numpy as np

# =========================================================
# LOAD (use filtered polar motion, not mode projections)
# =========================================================
df = pd.read_csv("filtered_series.csv", parse_dates=["date"])

# =========================================================
# EXTRACT + MEAN CENTER (CRITICAL)
# =========================================================
x = df["x_filt"].values
y = df["y_filt"].values

x = x - np.mean(x)
y = y - np.mean(y)

# =========================================================
# COVARIANCE + PRINCIPAL AXIS
# =========================================================
C = np.cov(x, y)
vals, vecs = np.linalg.eigh(C)

# sort eigenvalues descending
order = np.argsort(vals)[::-1]
vals = vals[order]
vecs = vecs[:, order]

principal_axis = vecs[:, 0]

# =========================================================
# PROJECTION ONTO PRINCIPAL AXIS
# =========================================================
s = x * principal_axis[0] + y * principal_axis[1]

# =========================================================
# DERIVATIVE (ROBUST)
# =========================================================
# use central differences where possible
ds = np.gradient(s)

# =========================================================
# STATE DEFINITION (GEOMETRIC)
# =========================================================
# state = direction of motion along principal axis
state = (ds > 0).astype(int)

df["state"] = state
df["projection"] = s
df["dprojection"] = ds

# =========================================================
# TRANSITIONS
# =========================================================
state_shift = np.diff(state, prepend=state[0])
transition_idx = np.where(state_shift != 0)[0]

transition_times = df["date"].iloc[transition_idx]

# =========================================================
# DWELL TIMES
# =========================================================
runs = []
current_state = state[0]
length = 1

for i in range(1, len(state)):
    if state[i] == current_state:
        length += 1
    else:
        runs.append((current_state, length))
        current_state = state[i]
        length = 1

runs.append((current_state, length))

# convert to DataFrame
dwell_df = pd.DataFrame(runs, columns=["state", "length"])

# =========================================================
# TIME AXIS (for rates)
# =========================================================
t = df["date"]
t_numeric = (t - t.iloc[0]).dt.total_seconds() / (365.25 * 24 * 3600)

# =========================================================
# TRANSITION RATE
# =========================================================
total_time = t_numeric.iloc[-1] - t_numeric.iloc[0]
transition_rate = len(transition_idx) / total_time if total_time > 0 else np.nan

# =========================================================
# OUTPUT
# =========================================================
print("\n=== GEOMETRIC STATE TRANSITION ANALYSIS ===\n")

print(f"Principal axis angle (deg): {np.degrees(np.arctan2(principal_axis[1], principal_axis[0])):.2f}")
print(f"Anisotropy ratio (λ1 / Σλ): {vals[0]/vals.sum():.4f}")

print(f"\nTotal transitions: {len(transition_idx)}")
print(f"Transition rate (per year): {transition_rate:.3f}")

if len(transition_times) > 0:
    print(f"\nFirst transition: {transition_times.iloc[0]}")
    print(f"Last transition:  {transition_times.iloc[-1]}")

print("\nDwell time statistics:")
print(dwell_df.groupby("state")["length"].describe())

# =========================================================
# SAVE
# =========================================================
df.to_csv("state_transition_analysis.csv", index=False)
dwell_df.to_csv("axis_dwell_times.csv", index=False)

print("\nSaved:")
print("- state_transition_analysis.csv")
print("- axis_dwell_times.csv")