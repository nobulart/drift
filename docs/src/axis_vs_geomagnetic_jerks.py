#!/usr/bin/env python3
"""
Compare time-resolved axis with geomagnetic jerk epochs.

Includes:
- event alignment
- delta-theta / delta-ratio response
- permutation significance test
"""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

# -------------------------------
# INPUTS
# -------------------------------

AXIS_FILE = "time_resolved_axis.csv"

# Replace with precise times if available
# (example indices — map to your dataset time base)
JERK_TIMES = np.array([
    1978,
    1991,
    1999,
    2014
])

# If your t_center is not in years,
# provide mapping or convert beforehand

WINDOW = 5  # years (or index units)

# -------------------------------
# LOAD
# -------------------------------

df = pd.read_csv(AXIS_FILE)

t = df["t_center"].values
theta = df["theta_star"].values
ratio = df["ratio"].values

# unwrap for proper differences
theta_rad = np.unwrap(np.deg2rad(theta))
theta = np.rad2deg(theta_rad)

# -------------------------------
# EVENT RESPONSE
# -------------------------------

def extract_response(series, t, events, window):
    responses = []

    for e in events:
        mask = (t >= e - window) & (t <= e + window)
        if np.sum(mask) > 5:
            responses.append(series[mask] - np.mean(series[mask]))
    return responses

theta_resp = extract_response(theta, t, JERK_TIMES, WINDOW)
ratio_resp = extract_response(ratio, t, JERK_TIMES, WINDOW)

# -------------------------------
# PLOT RESPONSES
# -------------------------------

plt.figure()
for r in theta_resp:
    plt.plot(r, alpha=0.5)
plt.title("θ*(t) responses around jerks")
plt.grid()

plt.figure()
for r in ratio_resp:
    plt.plot(r, alpha=0.5)
plt.title("Anisotropy responses around jerks")
plt.grid()

# -------------------------------
# PERMUTATION TEST
# -------------------------------

N_PERM = 1000
obs_var = np.var(np.concatenate(theta_resp)) if theta_resp else 0

perm_vars = []

for _ in range(N_PERM):
    fake_events = np.random.choice(t, size=len(JERK_TIMES), replace=False)
    fake_resp = extract_response(theta, t, fake_events, WINDOW)

    if fake_resp:
        perm_vars.append(np.var(np.concatenate(fake_resp)))

perm_vars = np.array(perm_vars)
p_value = np.mean(perm_vars >= obs_var)

print("\n--- JERK ALIGNMENT TEST ---")
print("Observed variance:", obs_var)
print("p-value:", p_value)

plt.figure()
plt.hist(perm_vars, bins=40)
plt.axvline(obs_var)
plt.title("Permutation test (θ variance)")
plt.grid()

plt.show()