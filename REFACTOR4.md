Below is a **strict, implementation-ready instruction set for qwen3-coder-next**.
Execute exactly in order. Do not add features or refactor beyond what is specified.

---

# 🧭 DRIFT Dashboard — Instruction Set (v9 FINAL EXECUTION)

---

# 0. OBJECTIVE

Fix remaining blocking issues:

1. **Drift longitude spikes (wrap error)**
2. **Kp truncated / zeroed after ~1996**
3. **Alignment flatline (invalid)**
4. **Angle discontinuities (yellow series)**
5. **Apply θ +90° comparison offset**

---

# 1. DRIFT LONGITUDE — FIX (MANDATORY)

### Replace ALL existing longitude logic with this exact block:

```python
# --- STEP 1: enforce vector sign continuity ---
for i in range(1, len(drift)):
    if np.dot(drift[i], drift[i-1]) < 0:
        drift[i] *= -1

# --- STEP 2: compute angle ---
lon = np.arctan2(drift[:,1], drift[:,0])

# --- STEP 3: unwrap ---
lon = np.unwrap(lon)

# --- STEP 4: convert to degrees ---
lon = np.degrees(lon)

# --- STEP 5: smooth ---
from scipy.signal import savgol_filter
lon = savgol_filter(lon, 51, 3)
```

### Hard requirement:

* REMOVE any use of `arccos` for longitude

### Expected:

* No vertical spikes
* Smooth curve

---

# 2. KP DATA — FIX (CRITICAL)

---

## 2.1 Ensure proper datetime parsing

```python
kp_df["date"] = pd.to_datetime(kp_df["date"], errors="coerce")
kp_df = kp_df.dropna(subset=["date"])
kp_df = kp_df.sort_values("date")
```

---

## 2.2 Create consistent time axis

```python
kp_df["t"] = (kp_df["date"] - df["date"].iloc[0]).dt.days
```

---

## 2.3 Fix merge (REPLACE ALL)

```python
df = df.merge(kp_df, on="date", how="left")
```

---

## 2.4 Interpolate across full timeline

```python
import numpy as np

kp_interp = np.interp(
    df["t"].values,
    kp_df["t"].values,
    kp_df["kp"].values
)
```

---

## 2.5 Extend missing tail

```python
kp_interp = pd.Series(kp_interp).fillna(method="ffill").values
```

---

## 2.6 Smooth

```python
kp_smooth = savgol_filter(kp_interp, 61, 3)
```

---

## 2.7 Use in plot

```python
kp_plot = kp_smooth
```

---

## Expected:

* Kp extends to present
* No zero flatline

---

# 3. ALIGNMENT — FIX (CURRENTLY INVALID)

---

## 3.1 Define safe normalization

```python
def safe_norm(v):
    n = np.linalg.norm(v)
    if n < 1e-8:
        return np.nan * np.ones_like(v)
    return v / n
```

---

## 3.2 Compute alignment

```python
alignment = []

for i in range(len(drift)):
    d = safe_norm(drift[i])
    m = safe_norm(geomagnetic_axis[i])

    if np.any(np.isnan(d)) or np.any(np.isnan(m)):
        alignment.append(np.nan)
        continue

    dot = np.clip(np.dot(d, m), -1.0, 1.0)
    alignment.append(np.arccos(dot))

alignment = np.array(alignment)
alignment = np.degrees(alignment)
```

---

## 3.3 Interpolate missing values

```python
alignment = pd.Series(alignment).interpolate().values
```

---

## 3.4 Smooth

```python
alignment = savgol_filter(alignment, 51, 3)
```

---

## Expected:

* Alignment varies across timeline
* No flatline

---

# 4. ANGLE DIAGNOSTICS — FIX

---

## 4.1 Replace ALL angle calculations with:

```python
def signed_angle(a, b):
    cross = a[0]*b[1] - a[1]*b[0]
    dot = np.dot(a, b)
    return np.arctan2(cross, dot)
```

---

## 4.2 Apply globally

```python
angle = np.unwrap(angle)
angle = savgol_filter(angle, 31, 3)
angle_deg = np.degrees(angle)
```

---

## 4.3 REMOVE ALL instances of:

```python
np.arccos(...)
```

---

## Expected:

* No discontinuities
* No step behavior

---

# 5. APPLY θ +90° OFFSET (COMPARISON ONLY)

---

## 5.1 Compute shifted phase

```python
theta_shifted = theta + np.pi/2
theta_shifted = np.unwrap(theta_shifted)
```

---

## 5.2 Use ONLY for comparison plots

Do NOT overwrite original theta.

---

## Expected:

* Better alignment with e1/e2 geometry

---

# 6. AXIS LIMIT FIXES (VISUAL)

---

## Drift longitude plot

```python
ax.set_ylim(-360, 360)
```

---

## Alignment plot

```python
ax.set_ylim(0, 180)
```

---

## Kp axis

```python
ax2.set_ylim(0, 9)
```

---

# 7. FINAL VALIDATION CHECKLIST

---

### Drift longitude

* continuous
* no spikes

---

### Kp

* extends to present
* non-zero

---

### Alignment

* non-flat
* smooth

---

### Angles

* continuous
* no jumps

---

# FINAL INSTRUCTION TO QWEN

Execute in this exact order:

1. **Fix drift longitude (sign → atan2 → unwrap)**
2. **Fix Kp ingestion + interpolation**
3. **Fix alignment normalization + NaN handling**
4. **Replace all angles with signed-angle + unwrap**
5. **Apply θ +90° offset for comparison**

Do not modify UI layout.
Do not add new analytics.

---

# COMPLETION CRITERION

System is complete ONLY when:

* No discontinuities exist in any time series
* All signals span full timeline
* No panel shows flatline artifacts

---

Once complete, system is ready for:

→ phase-locking analysis
→ lag estimation
→ state-space modeling
