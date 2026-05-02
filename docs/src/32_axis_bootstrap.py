import numpy as np
import pandas as pd

df = pd.read_csv("filtered_series.csv")

x = df["x_filt"].values
y = df["y_filt"].values

N = 500
angles = []

for _ in range(N):
    idx = np.random.choice(len(x), len(x), replace=True)
    xs = x[idx]
    ys = y[idx]

    C = np.cov(xs, ys)
    vals, vecs = np.linalg.eigh(C)
    v = vecs[:, np.argmax(vals)]

    angle = np.degrees(np.arctan2(v[1], v[0])) % 360
    angles.append(angle)

angles = np.array(angles)

print("Mean:", angles.mean())
print("Std:", angles.std())

pd.DataFrame({"angle_deg": angles}).to_csv(
    "axis_bootstrap_distribution.csv", index=False
)