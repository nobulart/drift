# DRIFT Dashboard Refactoring - Implementation Summary

## Overview
Successfully upgraded DRIFT dashboard from static geometric visualizer to time-resolved state-space diagnostic system.

## Files Created/Modified

### Core Backend
1. **`scripts/compute_rolling_stats.py`** - Python computation module
   - Detrending module (linear drift removal)
   - Rolling PCA (sliding window, time-local principal axes)
   - Loop center extraction (sliding window centroids)
   - Phase angle θ(t) with unwrapping + Savitzky-Golay smoothing
   - Angular velocity ω(t) computation
   - Turning point detection (|ω| < threshold)
   - Dance segment extraction
   - Orthogonal deviation ratio R(t)

2. **`src/lib/rollingStats.ts`** - TypeScript type definitions
   - RollingStats interface
   - DanceSegment interface
   - Parameters interface

3. **`src/app/api/rolling-stats/route.ts`** - Next.js API route
   - Parameter-based caching (md5 hash of params + data)
   - Dynamic computation on parameter change
   - Invokes Python script for heavy computations

4. **`src/store/useStore.ts`** - Zustand store updates
   - Added rollingStats state
   - Added turnThreshold state
   - computeRollingStats() async method
   - Invalidate cache on windowSize change

### Frontend Components
5. **`src/components/PhasePortrait.tsx`** - Phase space plot (θ vs ω)
6. **`src/components/ThetaOmegaPlots.tsx`** - Two-line plot for θ(t) and ω(t)
7. **`src/components/OrthogonalDeviationPlot.tsx`** - R(t) with rolling mean
8. **`src/components/PolarPlot.tsx`** - Updated with rolling stats (turning points)

### UI Updates
9. **`src/components/Controls.tsx`** - Added window size presets (180d, 365d, 730d)
10. **`src/app/page.tsx`** - Added rolling stats panels to dashboard

## Key Features Implemented

### State Variables
- ✓ θ(t): phase angle (unwrapped, smoothed)
- ✓ ω(t): angular velocity (time derivative of θ)
- ✓ R(t): orthogonal deviation ratio (min/max eigenvalues)

### Visualizations
- ✓ Phase portrait (θ vs ω)
- ✓ θ(t) and ω(t) time series
- ✓ R(t) orthogonal deviation ratio
- ✓ Turning point markers on all plots
- ✓ Updated Residual Polhody with turning points

### Parameters
- ✓ Window size presets: 180d, 365d, 730d
- ✓ Frame toggle: Earth / Principal
- ✓ Turning point threshold: configurable
- ✓ Dynamic recomputation on parameter changes

## API Endpoint

```
GET /api/rolling-stats?windowSize=365&turnThreshold=0.05
```

Returns full rolling stats object with:
- t, x_detrended, y_detrended
- e1, e2 (time-varying eigenvectors)
- centers (loop centroids)
- theta, omega
- turningPoints
- danceSegments
- rRatio
- metadata (window parameters, date range)

## Testing

```bash
# Build
npm run build

# Run
npm run dev

# Test API directly
curl "http://localhost:3000/api/rolling-stats?windowSize=365" | python3 -c "import sys, json; d=json.load(sys.stdin); print('Turning points:', d.get('turningPoints', [])); print('Theta range:', min(d.get('theta', [])), max(d.get('theta', [])))"
```

## Next Steps (Optional)
As mentioned in REFACTOR.md section 8:
- Energy-like metric: E(t) = ω² + αθ²
- Curvature: κ = (x'y'' - y'x'') / (x'² + y'²)^(3/2)
- Surrogate testing with phase randomization
