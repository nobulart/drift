import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy.stats import skew, kurtosis

# =========================
# CONFIG
# =========================
INPUT_FILE = "axis_angular_velocity.csv"

SIGMA_THRESHOLD = 2.0
LAG = 1

# =========================
# LOAD DATA
# =========================
df = pd.read_csv(INPUT_FILE, parse_dates=["date"])

if "omega_filtered" in df.columns:
    omega = df["omega_filtered"].values
else:
    omega = df["omega_smooth"].values

dates = df["date"].values

# =========================
# CLEAN (CRITICAL)
# =========================
omega = np.array(omega, dtype=float)

# remove inf
omega[np.isinf(omega)] = np.nan

mask = np.isfinite(omega)
omega = omega[mask]
dates = dates[mask]

# =========================
# TIME (years)
# =========================
t = pd.to_datetime(dates)
t_years = (t - t[0]).total_seconds() / (365.25 * 24 * 3600)

# =========================
# 1) DISTRIBUTION
# =========================
mu = np.nanmean(omega)
sigma = np.nanstd(omega)

sk = skew(omega, nan_policy="omit")
kt = kurtosis(omega, fisher=True, nan_policy="omit")

print("\n=== DISTRIBUTION ===")
print(f"Mean: {mu:.3f}")
print(f"Std:  {sigma:.3f}")
print(f"Skewness: {sk:.3f}")
print(f"Kurtosis (excess): {kt:.3f}")

plt.figure()
plt.hist(omega, bins=100)
plt.title("Omega Distribution")
plt.xlabel("ω (deg/year)")
plt.ylabel("Count")
plt.savefig("fig_20_omega_distribution.png", dpi=200)
plt.close()

# =========================
# 2) EVENT EXTRACTION
# =========================
threshold = SIGMA_THRESHOLD * sigma
event_mask = np.abs(omega) > threshold

events = []
current = None

for i in range(len(omega)):
    if event_mask[i]:
        if current is None:
            current = {
                "start_idx": i,
                "peak": omega[i],
                "sign": np.sign(omega[i])
            }
        else:
            if abs(omega[i]) > abs(current["peak"]):
                current["peak"] = omega[i]
    else:
        if current is not None:
            current["end_idx"] = i - 1
            current["duration"] = current["end_idx"] - current["start_idx"]
            events.append(current)
            current = None

if current is not None:
    current["end_idx"] = len(omega) - 1
    current["duration"] = current["end_idx"] - current["start_idx"]
    events.append(current)

events_df = pd.DataFrame(events)

if len(events_df) > 0:
    events_df["start_date"] = dates[events_df["start_idx"]]
    events_df["end_date"] = dates[events_df["end_idx"]]

events_df.to_csv("omega_events.csv", index=False)

print(f"\nDetected {len(events_df)} events (|ω| > {SIGMA_THRESHOLD}σ)")

# =========================
# 3) INTER-EVENT (TIME-BASED)
# =========================
if len(events_df) > 1:
    event_times = t_years[events_df["start_idx"].values]
    intervals = np.diff(event_times)

    mu_dt = np.mean(intervals)
    sigma_dt = np.std(intervals)

    burstiness = (sigma_dt - mu_dt) / (sigma_dt + mu_dt)

    print("\n=== INTER-EVENT ===")
    print(f"Mean Δt: {mu_dt:.3f} years")
    print(f"Std  Δt: {sigma_dt:.3f} years")
    print(f"Burstiness B: {burstiness:.3f}")

    plt.figure()
    plt.hist(intervals, bins=50)
    plt.title("Inter-event Interval Distribution")
    plt.xlabel("Δt (years)")
    plt.ylabel("Count")
    plt.savefig("fig_21_interevent_hist.png", dpi=200)
    plt.close()
else:
    print("\nNot enough events for interval analysis")

# =========================
# 4) SIGN PERSISTENCE (FIXED)
# =========================
signs = np.sign(omega)

# remove zeros (important)
nonzero = signs != 0
signs = signs[nonzero]

runs = []
current_sign = signs[0]
length = 1

for s in signs[1:]:
    if s == current_sign:
        length += 1
    else:
        runs.append((current_sign, length))
        current_sign = s
        length = 1

runs.append((current_sign, length))

runs_df = pd.DataFrame(runs, columns=["sign", "length"])
runs_df.to_csv("omega_sign_runs.csv", index=False)

# transition probabilities
trans = []
for i in range(len(signs) - 1):
    trans.append((signs[i], signs[i+1]))

trans_df = pd.DataFrame(trans, columns=["from", "to"])

P_pp = np.mean((trans_df["from"] == 1) & (trans_df["to"] == 1))
P_mm = np.mean((trans_df["from"] == -1) & (trans_df["to"] == -1))

print("\n=== SIGN PERSISTENCE ===")
print(f"P(+→+): {P_pp:.3f}")
print(f"P(-→-): {P_mm:.3f}")

plt.figure()
plt.hist(runs_df["length"], bins=100)
plt.title("Sign Run Length Distribution")
plt.xlabel("Run length")
plt.ylabel("Count")
plt.savefig("fig_22_run_lengths.png", dpi=200)
plt.close()

# =========================
# 5) PHASE SPACE
# =========================
if len(omega) > LAG:
    x = omega[:-LAG]
    y = omega[LAG:]

    plt.figure()
    plt.scatter(x, y, s=1)
    plt.xlabel("ω(t)")
    plt.ylabel(f"ω(t+{LAG})")
    plt.title("Phase Space (Lagged)")
    plt.savefig("fig_23_phase_space.png", dpi=200)
    plt.close()

# =========================
# SAVE SUMMARY
# =========================
summary = {
    "mean": mu,
    "std": sigma,
    "skewness": sk,
    "kurtosis_excess": kt,
    "num_events": len(events_df),
}

if len(events_df) > 1:
    summary["burstiness"] = burstiness

pd.DataFrame([summary]).to_csv("omega_summary.csv", index=False)

print("\nSaved:")
print("- omega_events.csv")
print("- omega_sign_runs.csv")
print("- omega_summary.csv")
print("- fig_20–23 diagnostics")