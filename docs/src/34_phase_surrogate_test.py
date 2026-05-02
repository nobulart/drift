import numpy as np
import pandas as pd

def phase_randomize(x):
    X = np.fft.rfft(x)
    phases = np.angle(X)
    amps = np.abs(X)

    random_phases = np.random.uniform(0, 2*np.pi, len(phases))
    random_phases[0] = phases[0]  # preserve DC

    X_new = amps * np.exp(1j * random_phases)
    return np.fft.irfft(X_new, n=len(x))

# load
df = pd.read_csv("filtered_series.csv")

x = df["x_filt"].values
y = df["y_filt"].values

N = 500
anisotropy = []

for i in range(N):
    xs = phase_randomize(x)
    ys = phase_randomize(y)

    v = np.vstack([np.diff(xs), np.diff(ys)]).T

    # direction energy
    angles = np.arctan2(v[:,1], v[:,0])
    hist, _ = np.histogram(angles, bins=36)
    anisotropy.append(np.max(hist))

pd.DataFrame({"anisotropy": anisotropy}).to_csv(
    "phase_surrogate_results.csv", index=False
)

print("✅ Phase surrogate test complete")