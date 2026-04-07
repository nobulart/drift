# 🧭 DRIFT Dashboard — Instruction Set (v2)

## 0. Critical Diagnosis (must fix first)

### ❗ Problem 1: Drift axis still flat

* Middle-right panel unchanged → still static
* Indicates **rolling PCA not properly wired to UI**

### ❗ Problem 2: Step-function angles (bottom-left)

* θ-like signals are quantized / discontinuous
* This is **incorrect mathematically**

Cause:

* Missing `unwrap()`
* Or recomputing angle from unstable vectors

---

## 1. FIX CORE SIGNAL PIPELINE (MANDATORY)

### 1.1 Ensure θ(t) is continuous

Replace any angle computation with:

```python
theta = np.arctan2(y_center, x_center)
theta = np.unwrap(theta)
theta = savgol_filter(theta, 21, 3)
```

❗ Do NOT compute angles from PCA vectors directly for θ(t)

---

### 1.2 Fix ω(t)

```python
dt = np.gradient(time)
omega = np.gradient(theta) / dt
omega = savgol_filter(omega, 21, 3)
```

---

### 1.3 Validate immediately

Add debug assertion:

```python
assert np.max(np.abs(np.diff(theta))) < 1.0
```

If this fails → unwrap not working.

---

## 2. FIX ROLLING PCA (UI INTEGRATION BUG)

### Problem

You likely compute rolling PCA but:

* UI still uses **global/static eigenvectors**

---

### Required Fix

Ensure ALL visualizations use:

```python
e1(t_i), e2(t_i)
```

NOT:

```python
e1_global
```

---

### Implementation rule

Every render frame must use:

```python
current_index = timeline_index

e1 = e1_series[current_index]
e2 = e2_series[current_index]
```

---

### Acceptance test

When sliding timeline:

* e1/e2 vectors must visibly rotate

---

## 3. DRIFT AXIS: REDEFINE (IMPORTANT)

Your drift axis is currently ambiguous.

### Correct definition (use this)

Drift axis = **principal direction of loop center trajectory**

Compute:

```python
centers = [(cx, cy)]

cov = np.cov(centers.T)
eigvals, eigvecs = np.linalg.eig(cov)

drift_axis = eigvecs[:, np.argmax(eigvals)]
```

Make this:

* **rolling over long window (e.g. 2–5 years)**
* NOT instantaneous

---

## 4. FIX BROKEN PANELS

---

### 4.1 Middle-right (currently flat lines)

❌ Remove current content

✅ Replace with:

#### Panel: Phase Dynamics

* θ(t)
* ω(t)

Add:

* vertical lines at turning points

---

### 4.2 Bottom-left (step function plot)

❌ This is invalid → remove

Replace with:

#### Panel: Angular Relationships

* angle(drift, e1)
* angle(drift, e2)

Ensure:

```python
angle = arccos(dot(a,b))
```

and apply smoothing.

---

### 4.3 Bottom-right (geomagnetic panel)

Fix:

1. Smooth Kp:

```python
kp_smooth = rolling_mean(kp, 30)
```

2. Replace alignment step-function with:

* continuous angle(drift, geomagnetic axis proxy)

---

## 5. ADD REQUIRED NEW PANELS

---

### 5.1 Phase Portrait (MANDATORY)

Plot:

```python
x = theta
y = omega
```

Purpose:

* reveals attractor / regime structure

---

### 5.2 Orthogonal Deviation R(t)

Already partially present → refine

Ensure:

```python
R = lambda_min / lambda_max
```

Add:

* smoothing
* turning point markers

---

### 5.3 Turning Point Panel

New small panel:

* scatter of:

  * time vs ω(t)
* highlight:

  * |ω| < threshold

---

## 6. 3D VIEW FIXES

---

### 6.1 Add temporal trails

Render:

* last N positions of:

  * drift axis
  * e1 axis

---

### 6.2 Fix vector scaling

Currently all vectors same length.

Scale drift vector:

```python
length = norm(center_vector)
```

---

### 6.3 Add angle overlays

Display live:

* ∠(drift, e1)
* ∠(drift, e2)

---

## 7. POLHODY PANEL IMPROVEMENTS

---

### 7.1 Time coloring (high priority)

```python
scatter(x_res, y_res, c=time, cmap="viridis")
```

---

### 7.2 Turning point overlay

Mark:

* extracted dance windows

---

## 8. UI / UX IMPROVEMENTS

---

### 8.1 DEFAULT DARK THEME (MANDATORY)

Set dark theme as default across entire app.

#### Color specification:

Background:

```css
#0b1220
```

Panels:

```css
#111827
```

Gridlines:

```css
#374151
```

Text:

```css
#e5e7eb
```

Accent:

```css
#3b82f6
```

---

### 8.2 Plot styling

* Remove white backgrounds
* Use consistent dark matplotlib / plotly theme
* Ensure high contrast for:

  * θ(t)
  * ω(t)
  * R(t)

---

### 8.3 Improve layout hierarchy

Reorder panels:

1. **Top:** 3D state view
2. **Row 2:**

   * Phase dynamics (θ, ω)
   * Phase portrait
3. **Row 3:**

   * Polhody
   * R(t)
4. **Row 4:**

   * Geomagnetic comparison

---

## 9. ADD VALIDATION OVERLAYS

---

### 9.1 Known event markers

Add vertical lines at:

* 1978
* 1991
* 1999
* 2003

---

### 9.2 Expected turning points

Verify detection near:

* ~1988
* ~2006

---

## 10. PERFORMANCE FIXES

---

### 10.1 Cache rolling PCA

Do NOT recompute every frame.

Precompute:

```python
e1_series, e2_series
```

---

### 10.2 Vectorize everything

Avoid Python loops for:

* covariance
* window extraction

---

## 11. Acceptance Criteria (STRICT)

Implementation is correct if:

---

### A. θ(t)

* smooth
* no discontinuities
* shows inflection ~2000

---

### B. ω(t)

* crosses near zero at:

  * ~1988
  * ~2006

---

### C. Drift axis

* visibly rotates over time
* not flat

---

### D. R(t)

* spikes at turning points

---

### E. Phase portrait

* shows structured curve (not noise)

---

### F. Dark theme

* applied globally by default
* no white panels remain

---

# Final Instruction to Qwen

Do NOT add new features until:

1. θ(t) and ω(t) are mathematically correct
2. Rolling PCA is fully time-resolved in UI
3. Drift axis is properly defined and dynamic

Only then refine visualization.

---

If executed correctly, this version will cross the threshold from:

> “interesting visualization”

to:

> **quantitative diagnostic system with falsifiable structure**

