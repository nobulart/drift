# Transition Forecast Engine

## Overview

This implementation adds a **time-resolved transition forecast** to the DRIFT dashboard. Instead of a single probability, you now get a complete probability curve showing how the likelihood of a state transition evolves over time (days ahead).

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
- Early peaks → imminent shift
- Late peaks → latent transition
- Flat response → stable regime

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
- `expected_time`: Mean days to shift
- `peak_time`: Most likely lag (days)
- `cumulative`: Cumulative probability up to each lag
- `alert_level`: LOW/MODERATE/HIGH

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
  "alert_level": "MODERATE",
  "alert_message": "MODERATE RISK (30d): P=0.45"
}
```

## Alert System

Based on cumulative probability at 30 days:

| Threshold | Alert Level | Meaning |
|-----------|-------------|---------|
| P(≤30d) > 0.6 | HIGH | High probability shift within 30 days |
| P(≤30d) > 0.3 | MODERATE | Some risk of shift within 30 days |
| Else | LOW | Low risk of imminent shift |

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
  - Alert level (color-coded badge)

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
   - Computes transition forecast

3. **Frontend** (React)
   - Fetches forecast from API
   - Displays probability curve
   - Shows metrics and alerts

### Phase Mapping

States map to phase bins as follows:
- **State 0 (Stable)**: Phase bin 0
- **State 1 (Pre-Transition)**: Phase bin 1
- **State 2 (Transition)**: Phase bin 2
- **State 3 (Post-Transition)**: Phase bin 3

## Usage in Dashboard

1. Enable the "Transition Forecast" panel in the sidebar
2. Select current state from dropdown
3. Adjust base probability if needed
4. View forecast curve with metrics

## Interpretation

### Scenario 1: Immediate Instability
```
High P₀ + early lag peak
→ Imminent shift (within days)
```

### Scenario 2: Delayed Instability
```
High P₀ + late lag peak
→ Latent transition building
```

### Scenario 3: Stable Regime
```
Low P₀ + flat lag kernel
→ No structured transition pattern
```

## Validation

### Backtesting
For each time t:
1. Compute P_tau
2. Check if shift occurs within predicted window
3. Evaluate calibration and sharpness

### Calibration
Bin predicted probabilities vs actual frequency of shifts.

### Sharpness
- **Narrow peaks** → strong predictive structure
- **Flat curve** → weak model

## Extensions

### Future Work
1. Include geomagnetic forcing: `P(shift | state, phase, Kp, dKp/dt)`
2. Add ensemble forecasting with uncertainty bands
3. Real-time updates with streaming data
4. Historical backtest visualization

### Multi-Horizon Forecasting
Extend to predict transitions at multiple lead times:
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
