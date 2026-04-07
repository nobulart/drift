# Transition Forecast Implementation

## Quick Start

The transition forecast engine has been implemented and integrated into the DRIFT dashboard.

### What's New

1. **Time-resolved forecast curves** - Instead of single probabilities, you get full probability distributions over time
2. **Lag kernel extraction** - Automatically extracts and normalizes lag responses from conditional lag model
3. **Transition probability prediction** - Computes P(shift at τ | state, phase, lag dynamics)

### Files Created

**Backend (Python):**
- `scripts/transition_forecast.py` - Core prediction logic
- Updated `scripts/compute_rolling_stats.py` - Now includes lag kernel normalization

**Frontend (TypeScript/React):**
- `src/lib/transitionForecast.ts` - TypeScript utilities
- `src/app/api/transition-forecast/route.ts` - API endpoint
- `src/components/TransitionForecastPanel.tsx` - UI component

**Documentation:**
- `TRANSITION_FORECAST.md` - Full implementation guide
- `TRANSITION_README.md` - This file

### How to Use

1. **Restart the dev server** to load the new components
2. **Enable the panel** in the sidebar (checking "Transition Forecast")
3. **View the forecast** showing:
   - Probability curve over time
   - Cumulative probability
   - Key metrics (peak time, expected time)
   - Alert level (LOW/MODERATE/HIGH)

### Model Format

The forecast model computes:

```
P(shift at τ) = P₀ × L(τ | phase, state)
```

Where:
- `P₀` = Base transition probability (0-1)
- `L(τ)` = Lag response kernel (probability distribution over time)
- `τ` = Time ahead (days)

### Alert Thresholds

- **HIGH**: P(transition within 30 days) > 60%
- **MODERATE**: P(transition within 30 days) > 30%
- **LOW**: Otherwise

### Interpretation

- **Early peak** + **high P₀** → Imminent shift
- **Late peak** + **high P₀** → Building transition
- **Flat kernel** + **low P₀** → Stable regime

## Testing

### Python Tests

```bash
cd /Users/craig/src/drift
python3 scripts/test_transition_forecast.py
```

### Frontend

1. Open dashboard at `http://localhost:3000`
2. Check "Transition Forecast" in sidebar
3. Interact with controls to see different forecasts

## API Usage

```bash
curl "http://localhost:3000/api/transition-forecast?currentState=1&theta=0.5&baseProb=0.5"
```

## Dependencies

- `scipy` for Gaussian smoothing
- `numpy` for array operations
- `react-plotly.js` for visualization

## Next Steps

1. Run the dev server and test the UI
2. Cross-validate with known transitions
3. Tune base probability based on domain knowledge
4. Integrate geomagnetic drivers (Kp, dKp/dt) for external forcing

## Questions?

See `TRANSITION_FORECAST.md` for detailed documentation.
