# 🧭 DRIFT — Geomagnetic Axis Proxy (CHAOS)

## Instruction Set for qwen3-coder-next

---

# 0. Objective

Implement a **time-resolved geomagnetic axis proxy** defined as:

> **The normalized dipole vector derived from CHAOS Gauss coefficients (g₁⁰, g₁¹, h₁¹)**

This will be used to compute:

* alignment with drift axis
* time evolution
* correlation with θ(t), ω(t)

---

# 1. Dependencies

Ensure the following is installed:

```bash
pip install chaosmagpy numpy scipy pandas
```

---

# 2. Load CHAOS Model

### Requirement

Use CHAOS field model (latest available .mat file)

---

### Implementation

```python id="chaos_load"
import chaosmagpy as cp

# Replace with actual path
CHAOS_MODEL_PATH = "CHAOS-7.mat"

model = cp.load_CHAOS_matfile(CHAOS_MODEL_PATH)
```

---

# 3. Time Handling

CHAOS uses **decimal years**.

---

### Convert datetime → decimal year

```python id="decimal_year"
import pandas as pd

def datetime_to_decimal_year(dt):
    year = dt.year
    start = pd.Timestamp(year=year, month=1, day=1)
    end = pd.Timestamp(year=year+1, month=1, day=1)

    return year + (dt - start).total_seconds() / (end - start).total_seconds()
```

---

### Apply to dataset

```python id="time_convert"
df["decimal_year"] = df["date"].apply(datetime_to_decimal_year)
```

---

# 4. Extract Dipole Coefficients

---

## 4.1 Correct method (IMPORTANT)

Use CHAOS core field synthesis:

```python id="coeff_extract"
# Evaluate at Earth surface (radius = 6371.2 km)
radius = 6371.2

# CHAOS expects arrays
times = df["decimal_year"].values

# Get Gauss coefficients
coeffs = model.synth_coeffs(times, nmax=1)  # degree 1 only
```

---

## 4.2 Extract g₁⁰, g₁¹, h₁¹

CHAOS ordering:

* coeffs[..., 0] = g₁⁰
* coeffs[..., 1] = g₁¹
* coeffs[..., 2] = h₁¹

```python id="coeff_unpack"
g10 = coeffs[:, 0]
g11 = coeffs[:, 1]
h11 = coeffs[:, 2]
```

---

# 5. Construct Dipole Vector

---

## 5.1 Formula

Geomagnetic dipole vector in Earth-fixed frame:

[
m = (-g_{1}^{1}, -h_{1}^{1}, -g_{1}^{0})
]

---

## 5.2 Implementation

```python id="dipole_vector"
import numpy as np

mx = -g11
my = -h11
mz = -g10

m = np.vstack([mx, my, mz]).T
```

---

## 5.3 Normalize

```python id="normalize"
norm = np.linalg.norm(m, axis=1, keepdims=True)
m_unit = m / norm
```

---

## Output

```python id="geomagnetic_axis"
geomagnetic_axis = m_unit  # shape (N, 3)
```

---

# 6. Align with DRIFT Coordinate System

---

## Requirement

Ensure drift axis is also expressed as unit vector in same frame.

If drift axis is currently 2D:

```python id="drift_embed"
drift_3d = np.vstack([dx, dy, np.zeros_like(dx)]).T
drift_3d = drift_3d / np.linalg.norm(drift_3d, axis=1, keepdims=True)
```

---

# 7. Compute Alignment Angle

---

## Formula

[
\theta(t) = \cos^{-1}(\hat{d}(t) \cdot \hat{m}(t))
]

---

## Implementation

```python id="alignment_angle"
def angle_between(a, b):
    dot = np.sum(a * b, axis=1)
    dot = np.clip(dot, -1.0, 1.0)
    return np.degrees(np.arccos(dot))

alignment = angle_between(drift_3d, geomagnetic_axis)
```

---

## Optional smoothing

```python id="smooth_align"
from scipy.signal import savgol_filter

alignment_smooth = savgol_filter(alignment, 31, 3)
```

---

# 8. Integrate into Dashboard

---

## 8.1 Replace existing geomagnetic panel

### Plot:

* alignment(t)
* ω(t) (secondary axis)

---

## 8.2 Add cross-correlation

```python id="correlation"
corr = np.corrcoef(alignment_smooth, omega)[0, 1]
```

---

## 8.3 Add to 3D view

Render geomagnetic axis:

* color: cyan
* label: “Geomagnetic Dipole”

---

# 9. Validation Checks (MANDATORY)

---

## 9.1 Norm check

```python id="norm_check"
assert np.allclose(np.linalg.norm(geomagnetic_axis, axis=1), 1, atol=1e-6)
```

---

## 9.2 Temporal smoothness

```python id="smooth_check"
assert np.max(np.abs(np.diff(geomagnetic_axis[:,0]))) < 0.01
```

---

## 9.3 Physical sanity

Dipole axis should:

* tilt ~9–11°
* drift slowly over decades

---

# 10. Performance Optimization

---

## 10.1 Cache coefficients

Do NOT recompute CHAOS on every frame.

Precompute:

```python id="cache"
geomagnetic_axis_series
```

---

## 10.2 Interpolate if needed

If CHAOS sampling is coarse:

```python id="interp"
from scipy.interpolate import interp1d

interp_fn = interp1d(time_coarse, geomagnetic_axis, axis=0)
geomagnetic_axis_dense = interp_fn(time_full)
```

---

# 11. Acceptance Criteria

Implementation is correct if:

---

### A. Geomagnetic axis

* smooth
* slowly varying
* unit length

---

### B. Alignment signal

* continuous (no steps)
* responds to drift axis changes

---

### C. Around ~1999–2000

* visible change in alignment behavior (if coupling exists)

---

### D. No dependence on Kp for axis definition

---

# 12. Final Instruction to Qwen

Do NOT approximate geomagnetic axis.

Use only:

> CHAOS-derived dipole vector from (g₁⁰, g₁¹, h₁¹)

Ensure:

* consistent coordinate frame
* normalized vectors
* continuous time series

