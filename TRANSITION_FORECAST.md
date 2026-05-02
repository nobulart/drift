# Transition Probability Engine

## Overview

This implementation adds an **experimental time-resolved transition-probability** panel to the DRIFT dashboard. Instead of a single probability, you get a complete probability curve showing how the current state resembles prior transition-like episodes over time (days ahead).

## Model Architecture

### Base Probability

```
P₀ = P(shift | state, phase)
```

Computed from the existing conditional lag model.

### Lag Response Function

```
L(τ | phase, state)
```

Encodes when responses typically occur:
- Early peaks → near-horizon transition similarity
- Late peaks → longer-horizon transition similarity
- Flat response → weak transition-like structure

### Final Model

```
P(shift at τ) = P₀ × L(τ | phase, state)
```

Normalized across τ to form a proper probability distribution.

## Implementation Details

### 1. Lag Kernel Extraction (Python)

**File:** `scripts/transition_forecast.py`

**Steps:**
1. Extract positive responses: `lag_kernel = max(signal, 0)`
2. Normalize per phase bin: `sum(lag_kernel[:, p]) = 1`
3. Apply Gaussian smoothing: `gaussian_filter(lag_kernel, sigma=1.0)`

**Output:** Normalized kernel array with shape `(lags × phase_bins)`

### 2. Transition Probability Curve (TypeScript)

**File:** `src/lib/transitionForecast.ts`

**Function:** `predictTransitionCurve(theta, state, kernel, baseProb)`

**Returns:**
- `P_tau`: Probability distribution over lag values
- `expected_time`: Mean probability horizon in days
- `peak_time`: Most likely lag (days)
- `cumulative`: Cumulative probability up to each lag
- probability summary: LOW/MODERATE/HIGH

### 3. API Endpoint

**Route:** `/api/transition-forecast`

**Parameters:**
- `currentState`: 0-3 (Stable, Pre, Transition, Post)
- `theta`: Current phase angle (radians)
- `baseProb`: Base transition probability (0-1)
- `smoothSigma`: Gaussian smoothing parameter

**Response:**
```json
{
  "lags": [5, 6, 7, ..., 180],
  "P_tau": [0.001, 0.002, ..., 0.001],
  "expected_time": 23.5,
  "peak_time": 15.0,
  "cumulative": [0.01, 0.05, ..., 0.72],
  "probability_level": "MODERATE",
  "probability_message": "MODERATE TRANSITION PROBABILITY (30d): P=0.45"
}
```

## Probability Summary

Based on cumulative probability at 30 days:

| Threshold | Summary | Meaning |
|-----------|-------------|---------|
| P(≤30d) > 0.6 | HIGH | High near-term transition probability |
| P(≤30d) > 0.3 | MODERATE | Moderate near-term transition probability |
| Else | LOW | Low near-term transition probability |

## UI Components

### TransitionForecastPanel

**Location:** `src/components/TransitionForecastPanel.tsx`

**Features:**
- Probability vs Time plot (signal line)
- Cumulative probability overlay (dotted line)
- Key metrics display:
  - Peak time
  - Expected time
  - P(≤30d)
  - Transition probability summary (color-coded badge)

**Controls:**
- State selector (Stable, Pre, Transition, Post)
- Base probability slider (0.1-1.0)

## Integration

### Data Flow

1. **Rolling stats computation** (Python)
   - Computes conditional lag model
   - Extracts and normalizes lag kernel
   - Saves to cache with `lagKernel` field

2. **API endpoint** (TypeScript)
   - Loads cached rolling stats
   - Extracts lag kernel
   - Applies smoothing if requested
   - Computes transition probability

3. **Frontend** (React)
   - Fetches transition-probability data from API
   - Displays probability curve
   - Shows probability summary metrics

### Phase Mapping

States map to phase bins as follows:
- **State 0 (Stable)**: Phase bin 0
- **State 1 (Pre-Transition)**: Phase bin 1
- **State 2 (Transition)**: Phase bin 2
- **State 3 (Post-Transition)**: Phase bin 3

## Usage in Dashboard

1. Enable the "Transition Probability" panel in the sidebar
2. Select current state from dropdown
3. Adjust base probability if needed
4. View probability curve with metrics

## Interpretation

### Scenario 1: Near-Horizon Similarity
```
High P₀ + early lag peak
→ Near-horizon transition similarity
```

### Scenario 2: Longer-Horizon Similarity
```
High P₀ + late lag peak
→ Longer-horizon transition similarity
```

### Scenario 3: Weak Transition-Like Structure
```
Low P₀ + flat lag kernel
→ Weak transition-like structure in the calibration record
```

## Validation

### Backtesting
For each time t:
1. Compute P_tau
2. Check if transition-like behavior occurs within the evaluated window
3. Evaluate calibration and sharpness

### Calibration
Bin predicted probabilities vs actual frequency of shifts.

### Sharpness
- **Narrow peaks** → strong predictive structure
- **Flat curve** → weak model

## Extensions

### Future Work
1. Include geomagnetic forcing: `P(shift | state, phase, Kp, dKp/dt)`
2. Add ensemble probability curves with uncertainty bands
3. Real-time updates with streaming data
4. Historical backtest visualization

### Multi-Horizon Probability
Extend to summarize transition probability at multiple lead times:
- Short-term (0-30d)
- Medium-term (30-90d)
- Long-term (90-180d)

## Files

### Backend
- `scripts/transition_forecast.py` - Core prediction logic
- `scripts/compute_rolling_stats.py` - Updated to include lag kernel

### Frontend
- `src/lib/transitionForecast.ts` - TypeScript utilities
- `src/app/api/transition-forecast/route.ts` - API endpoint
- `src/components/TransitionForecastPanel.tsx` - UI component
- `src/lib/types.ts` - Type definitions

### Tests
- `scripts/test_transition_forecast.py` - Python test suite

## References

- Hazard models in seismology
- Regime transition models in climate systems
- Metastable transition prediction in physics

## Author

Implementation for DRIFT dashboard: Geodetic–Geomagnetic Coupling Analysis
