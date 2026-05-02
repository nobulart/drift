#!/usr/bin/env python3
"""
Reconstruct effective potential V(s), identify metastable states,
and compute transition rates.

Input:
    sn_dynamics_v2.csv  (columns: s, n, ds_dt, dn_dt)

Outputs:
    potential.csv
    states.csv
    transitions.csv
    plots
"""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy.signal import find_peaks

# -------------------------------
# CONFIG
# -------------------------------

INPUT_FILE = "sn_dynamics_v2.csv"

NBINS = 100
SMOOTH_WINDOW = 5
MIN_STATE_PROMINENCE = 0.5
MIN_DWELL = 20   # minimum samples to count as a state

# -------------------------------
# LOAD
# -------------------------------

df = pd.read_csv(INPUT_FILE)

s = df["s"].values

# remove NaNs / infs
mask = np.isfinite(s)
s = s[mask]

# -------------------------------
# STEP 1: HISTOGRAM → PROBABILITY
# -------------------------------

hist, edges = np.histogram(s, bins=NBINS, density=True)
centers = 0.5 * (edges[:-1] + edges[1:])

# avoid log(0)
hist = hist + 1e-10

# -------------------------------
# STEP 2: EFFECTIVE POTENTIAL
# -------------------------------

V = -np.log(hist)

# normalize (optional)
V = V - np.min(V)

# smooth slightly
V = pd.Series(V).rolling(SMOOTH_WINDOW, center=True).mean().values

# -------------------------------
# STEP 3: IDENTIFY STATES (MINIMA)
# -------------------------------

# find peaks in -V (i.e. minima of V)
peaks, props = find_peaks(-V, prominence=MIN_STATE_PROMINENCE)

state_positions = centers[peaks]
state_depths = V[peaks]

# -------------------------------
# STEP 4: ASSIGN EACH POINT TO STATE
# -------------------------------

def assign_state(val, states):
    return np.argmin(np.abs(states - val))

state_ids = np.array([assign_state(val, state_positions) for val in s])

# -------------------------------
# STEP 5: DETECT TRANSITIONS
# -------------------------------

transitions = []
current_state = state_ids[0]
start_idx = 0

for i in range(1, len(state_ids)):
    if state_ids[i] != current_state:
        dwell = i - start_idx
        
        if dwell >= MIN_DWELL:
            transitions.append({
                "from": current_state,
                "to": state_ids[i],
                "start_idx": start_idx,
                "end_idx": i,
                "dwell_time": dwell
            })
        
        current_state = state_ids[i]
        start_idx = i

transitions_df = pd.DataFrame(transitions)

# -------------------------------
# STEP 6: TRANSITION MATRIX
# -------------------------------

n_states = len(state_positions)
T = np.zeros((n_states, n_states))

for _, row in transitions_df.iterrows():
    i = int(row["from"])
    j = int(row["to"])
    T[i, j] += 1

# normalize rows
row_sums = T.sum(axis=1, keepdims=True) + 1e-10
T_norm = T / row_sums

# -------------------------------
# SAVE OUTPUTS
# -------------------------------

pd.DataFrame({
    "s": centers,
    "V": V
}).to_csv("potential.csv", index=False)

pd.DataFrame({
    "state_id": np.arange(len(state_positions)),
    "s_position": state_positions,
    "V_depth": state_depths
}).to_csv("states.csv", index=False)

transitions_df.to_csv("transitions.csv", index=False)

pd.DataFrame(T_norm).to_csv("transition_matrix.csv", index=False)

# -------------------------------
# PLOTS
# -------------------------------

# 1. Potential
plt.figure()
plt.plot(centers, V)
plt.scatter(state_positions, state_depths)
plt.title("Effective Potential V(s)")
plt.xlabel("s")
plt.ylabel("V(s)")
plt.grid()
plt.show()

# 2. State assignment over time
plt.figure()
plt.plot(state_ids, lw=1)
plt.title("State sequence")
plt.xlabel("time index")
plt.ylabel("state id")
plt.grid()
plt.show()

# 3. Histogram + states
plt.figure()
plt.hist(s, bins=NBINS, density=True, alpha=0.5)
plt.scatter(state_positions, np.exp(-state_depths), color='red')
plt.title("Probability density with states")
plt.grid()
plt.show()

# -------------------------------
# SUMMARY
# -------------------------------

print("\n--- STATE SUMMARY ---")
print("Number of states:", n_states)

print("\nState positions (s):")
for i, pos in enumerate(state_positions):
    print(f"State {i}: s ≈ {pos:.2f}")

print("\nTransition counts:")
print(T)

print("\nNormalized transition matrix:")
print(T_norm)