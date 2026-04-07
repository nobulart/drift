# 🧭 DRIFT Dashboard — Instruction Set (v3: Final Integration Pass)

---

# 0. Immediate Diagnosis (from screenshot)

### ❗ Still broken / incomplete:

1. **Drift axis still flat (top-right panel)**
2. **Geomagnetic alignment is constant (red line = 0) → NOT using CHAOS yet**
3. **Bottom-left panel is meaningless (flat zero line)**
4. **Phase portrait panel mislabeled / incorrect scaling**
5. **White plot backgrounds still present (dark theme incomplete)**
6. **3D view lacks temporal evolution (still static snapshot)**

---

# 1. HARD REQUIREMENT: ACTUALLY WIRE CHAOS AXIS

### Problem

You implemented instructions—but not connected to UI.

---

## 1.1 Replace geomagnetic axis everywhere

REMOVE:

```python
dummy_axis = [0,0,1]
```

REPLACE WITH:

```python
geomagnetic_axis[t_index]
```

---

## 1.2 Fix alignment panel (currently broken)

### Current:

* Flat red line = incorrect

### Required:

```python
alignment = angle_between(drift_axis[t], geomagnetic_axis[t])
```

Then:

```python
alignment = savgol_filter(alignment, 31, 3)
```

---

## 1.3 Validation (must pass)

* Alignment must:

  * vary slowly
  * NOT be constant
  * NOT be step-like

---

# 2. FIX DRIFT AXIS (CRITICAL)

### Current problem

Still computed globally → no time variation

---

## 2.1 Implement rolling drift axis

```python
WINDOW_LONG = 1825  # ~5 years

for t_i:
    centers_window = centers[(t >= t_i-W/2) & (t <= t_i+W/2)]

    cov = np.cov(centers_window.T)
    eigvals, eigvecs = np.linalg.eig(cov)

    drift_axis[t_i] = eigvecs[:, argmax(eigvals)]
```

---

## 2.2 Normalize and stabilize sign

```python
if dot(drift_axis[t], drift_axis[t-1]) < 0:
    drift_axis[t] *= -1
```

---

## 2.3 Acceptance

* Drift axis must:

  * rotate slowly over decades
  * NOT be flat

---

# 3. DELETE BROKEN PANEL (bottom-left)

### Current:

Flat zero line → no information

---

## Replace with:

### Panel: Alignment vs Angular Velocity

Plot:

* alignment(t)
* ω(t)

This becomes your **primary coupling diagnostic**

---

# 4. FIX PHASE PANEL (bottom-middle)

### Problem:

* Blue line (θ) is linear → incorrect scaling or not unwrapped properly

---

## Fix:

### 4.1 Ensure θ is computed ONLY from loop centers

```python
theta = np.unwrap(np.arctan2(cy, cx))
```

NOT from PCA vectors

---

### 4.2 Normalize for visualization

```python
theta_plot = theta - np.mean(theta)
```

---

### 4.3 Plot:

* θ(t)
* ω(t)

---

# 5. FIX PHASE PORTRAIT (bottom-left small panel)

### Current:

* mislabeled
* incorrect scaling

---

## Replace with:

```python
plt.plot(theta, omega)
```

Add:

* turning points overlay

---

## Expected:

* smooth trajectory
* visible curvature
* NOT noise cloud

---

# 6. FIX R(t) PANEL (bottom-right)

This is close but needs refinement.

---

## 6.1 Smooth R(t)

```python
R_smooth = savgol_filter(R, 21, 3)
```

---

## 6.2 Normalize for display

```python
R_plot = (R_smooth - min) / (max - min)
```

---

## 6.3 Overlay turning points

Already present → keep

---

## Expected:

* spikes at:

  * ~1988
  * ~2006

---

# 7. 3D VIEW — MAKE IT TEMPORAL (IMPORTANT)

---

## 7.1 Add trails

Render last N frames:

```python
trail_length = 100

for i in range(t_index - trail_length, t_index):
    draw_line(e1[i], e1[i+1])
    draw_line(drift[i], drift[i+1])
```

---

## 7.2 Add geomagnetic axis

Color:

```text
cyan
```

Label:

```text
"Geomagnetic Dipole"
```

---

## 7.3 Scale vectors

```python
length = norm(center_vector)
```

---

# 8. FIX POLHODY PANEL

---

## 8.1 Add time coloring

```python
scatter(x_res, y_res, c=time, cmap="viridis")
```

---

## 8.2 Add turning point highlights

Mark extracted dance windows

---

# 9. DARK THEME — COMPLETE IMPLEMENTATION

### Problem:

Plots still white → incomplete

---

## 9.1 Force global theme

If matplotlib:

```python
plt.style.use("dark_background")
```

---

## 9.2 Override axes

```python
ax.set_facecolor("#111827")
fig.patch.set_facecolor("#0b1220")
```

---

## 9.3 Grid + text

```python
ax.grid(color="#374151")
ax.tick_params(colors="#e5e7eb")
```

---

## 9.4 Remove ALL white panels

Audit:

* every subplot
* every container

---

# 10. ADD EVENT MARKERS (HIGH VALUE)

Add vertical lines at:

```text
1978
1991
1999
2003
```

Across:

* θ(t)
* ω(t)
* alignment
* R(t)

---

# 11. FINAL VALIDATION CHECKLIST

System is correct only if:

---

### A. Drift axis

* not flat
* evolves slowly

---

### B. Geomagnetic alignment

* smooth
* non-constant
* no steps

---

### C. θ(t)

* continuous
* no jumps

---

### D. ω(t)

* near-zero at:

  * ~1988
  * ~2006

---

### E. R(t)

* peaks at turning points

---

### F. Phase portrait

* structured curve

---

### G. Dark theme

* zero white backgrounds

---

# 12. Final Instruction to Qwen

Focus strictly on:

1. **Correct signals (θ, ω, drift, geomagnetic axis)**
2. **Proper wiring into UI**
3. **Removing placeholder logic**

Do NOT add new features until:

* drift axis moves
* alignment varies
* phase signals are continuous

---

# If you complete this pass

You will have:

> a fully functional **geometry → state → coupling diagnostic system**

