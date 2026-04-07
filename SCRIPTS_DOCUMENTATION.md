# DRIFT Dashboard - Scripts Documentation

This document provides comprehensive documentation for all scripts in the `scripts/` folder.

## Overview

The DRIFT dashboard uses a pipeline of Python scripts to process geodetic and geomagnetic data. These scripts:

1. **Fetch raw data** from external sources (IERS, GFZ, GRACE)
2. **Process and combine** data into unified formats
3. **Compute advanced statistics** (PCA, phase analysis, turning points)
4. **Generate inertia frames** from GRACE spherical harmonics

All processed data is stored in `/public/data/` for the Next.js frontend to consume.

---

## Scripts by Category

### 1. Data Fetching Scripts

#### `fetch_latest.py`
**Purpose**: Automated daily retrieval of latest data from all sources

**Description**: 
- Fetches latest IERS EOP data from finals.all.json
- Downloads latest GRACE manifest and decodes time data
- Retrieves GFZ-KP geomagnetic indices for recent period
- Generates combined data file

**Usage**:
```bash
python scripts/fetch_latest.py
```

**Outputs**:
- `data/eop_latest.json` - Latest EOP data (last 30 days)
- `data/grace_latest.json` - Latest GRACE data
- `data/geomag_gfz_latest.json` - Latest GFZ-KP data
- `data/combined_latest.json` - Combined data

**Dependencies**:
- Python 3
- urllib (standard library)

---

### 2. Data Processing Scripts

#### `build_eop.py`
**Purpose**: Parse IERS EOP (Earth Orientation Parameters) data

**Description**:
- Parses `finals.all.json` from IERS
- Extracts polar motion coordinates (xp, yp)
- Also extracts UT1-UTC and LOD (Length of Day) if available
- Falls back to rapid data if finals.all.json not found

**Formats Supported**:
- IERS finals.all.json (JSON format)
- IERS C01/C04 (text format)
- IERS rapid data (text format)

**Usage**:
```bash
python scripts/build_eop.py
```

**Outputs**:
- `data/eop_historic.json` - Historical EOP data

**Data Structure**:
```json
{
  "t": "YYYY-MM-DD",
  "xp": 0.123,
  "yp": -0.456,
  "ut1_utc": 0.001,
  "lod": 0.5
}
```

**Dependencies**:
- Python 3
- json (standard library)
- urllib (standard library)

---

#### `build_geomag.py`
**Purpose**: Generate synthetic geomagnetic data

**Description**:
- **Note**: This is a legacy script that generates **synthetic** data
- For real GFZ-KP data, use `build_geomag_gfz.py`
- Generates sinusoidal Kp, Dst, and aa indices with noise

**Usage**:
```bash
python scripts/build_geomag.py
```

**Outputs**:
- `data/geomag_historic.json`

**Recommendation**: Use `build_geomag_gfz.py` instead for real data.

---

#### `build_geomag_gfz.py`
**Purpose**: Fetch and process GFZ-KP geomagnetic indices

**Description**:
- Fetches all geomagnetic indices from GFZ web service:
  - Kp (3-hourly)
  - ap (3-hourly)
  - Ap (daily mean)
  - Cp (daily variation index)
  - C9 (9-day index)
- Parses legacy text files (Kp_ap_since_1932.txt)
- Handles both 3-hourly and daily data formats

**Usage**:
```bash
python scripts/build_geomag_gfz.py
```

**Outputs**:
- `data/geomag_gfz_kp.json`

**Data Structure**:
```json
{
  "t": "YYYY-MM-DD",
  "kp": 3.3,
  "ap": 12,
  "ap_daily": 10,
  "cp": 0.5,
  "c9": 0.8,
  "sn": 45,
  "f107_obs": 75.2,
  "f107_adj": 72.1
}
```

**Dependencies**:
- Python 3
- json (standard library)
- urllib (standard library)

---

#### `build_grace.py`
**Purpose**: Process GRACE MASCON data from Zarr manifest

**Description**:
- Decodes Zarr-format time chunks from GRACE manifest
- Extracts dates from base64-encoded time data
- **Note**: Actual LWE (Liquid Water Equivalent) values require chunk downloads

**Usage**:
```bash
python scripts/build_grace.py
```

**Inputs**:
- `data/TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4_virtual_https.json` (Zarr manifest)

**Outputs**:
- `data/grace_historic.json`

**Data Structure**:
```json
{
  "t": "YYYY-MM-DD",
  "lwe_mean": 0.0,
  "lwe_std": 0.0,
  "lwe_min": 0.0,
  "lwe_max": 0.0,
  "valid_pixels": 259200
}
```

**Dependencies**:
- Python 3
- json, base64, struct (standard library)
- zlib (for decompression)

---

#### `build_inertia.py`
**Purpose**: Compute inertia tensor eigenframes from GRACE spherical harmonics

**Description**:
- Converts GRACE geopotential coefficients (C20, C21, S21, C22, S22) to inertia tensor
- Computes eigenvalues and eigenvectors
- Generates time series of inertia eigenframes
- **Note**: Currently generates **synthetic** data; requires actual GRACE L2 data for production

**Usage**:
```bash
python scripts/build_inertia.py
```

**Outputs**:
- `data/inertia_timeseries.json`

**Data Structure**:
```json
{
  "t": "YYYY-MM-DD",
  "e1": [1.0, 0.0, 0.0],
  "e2": [0.0, 1.0, 0.0],
  "e3": [0.0, 0.0, 1.0],
  "lambda": [1.0, 0.999, 0.998]
}
```

**Dependencies**:
- Python 3
- numpy
- json (standard library)

---

#### `combine_data.py`
**Purpose**: Combine EOP, GRACE, and GFZ-KP data into unified format

**Description**:
- Uses EOP as base timeline
- Merges GRACE LWE data by date
- Fetches recent GFZ-KP data via web service
- Interpolates andsmoothes missing Kp/ap values

**Usage**:
```bash
python scripts/combine_data.py
```

**Inputs**:
- `data/eop_historic.json` (required)
- `data/grace_historic.json` (optional)
- `data/geomag_gfz_kp.json` (via web service)

**Outputs**:
- `data/combined_historic.json`

**Data Structure**:
```json
{
  "t": "YYYY-MM-DD",
  "xp": 0.123,
  "yp": -0.456,
  "kp": 3.3,
  "ap": 12,
  "ap_daily": 10,
  "grace_lwe_mean": 0.5
}
```

**Dependencies**:
- Python 3
- json (standard library)
- urllib (standard library)
- numpy
- scipy

---

### 3. Advanced Analysis Scripts

#### `compute_rolling_stats.py`
**Purpose**: Compute time-resolved state-space diagnostics

**Description**:
- **Most complex script** - performs advanced mathematical analysis
- Computes rolling PCA for time-local principal axes
- Calculates phase angle θ(t) and angular velocity ω(t)
- Detects turning points where rotation slows
- Extracts "dance segments" around turning points
- Computes orthogonal deviation ratio R(t)
- Generates time-varying drift axis using PCA
- Computes alignment angle with geomagnetic axis

**Mathematical Methods**:
1. **Detrending**: Remove linear drift using polyfit
2. **Rolling PCA**: Time-local covariance analysis
3. **Phase analysis**: Arctangent with unwrapping and smoothing
4. **Turning point detection**: Omega threshold crossings
5. **Dance segments**: Trajectory segments around turning points
6. **Drift axis**: PCA eigenvector with sign stabilization

**Usage**:
```bash
python scripts/compute_rolling_stats.py \
    -i data/eop_historic.json \
    -o data/rolling_stats.json \
    --window-size 365 \
    --turn-threshold 0.05 \
    --center-window 60 \
    --center-step 5 \
    --dance-window 120
```

**Arguments**:
- `-i, --input`: Input EOP JSON file
- `-o, --output`: Output stats JSON file
- `--window-size`: Rolling PCA window (default: 365 days)
- `--turn-threshold`: Turning point threshold for ω (default: 0.05 rad/day)
- `--center-window`: Window for loop center computation (default: 60 days)
- `--center-step`: Step size for center computation (default: 5 days)
- `--dance-window`: Window for dance segment extraction (default: 120 days)

**Outputs**:
- `data/rolling_stats.json`
- `.rolling-stats-cache/` - Cached results for faster reload

**Data Structure**:
```json
{
  "t": [0, 1, 2, ...],
  "x_detrended": [...],
  "y_detrended": [...],
  "e1": [[1, 0], [1, 0], ...],
  "e2": [[0, 1], [0, 1], ...],
  "centers": [[cx, cy], ...],
  "theta": [0, 0.1, 0.2, ...],
  "omega": [0.1, 0.1, 0.09, ...],
  "turningPoints": [100, 250, 400],
  "danceSegments": [
    {
      "startIndex": 95,
      "endIndex": 145,
      "centerTime": 100,
      "x": [...],
      "y": [...],
      "area": 12.5,
      "rRatio": 0.85
    }
  ],
  "rRatio": [1.0, 0.95, 0.90, ...],
  "driftAxis": [[1, 0, 0], ...],
  "geomagnetic_axis": [[0.9, 0.1, 0], ...],
  "alignment": [15, 18, 22, ...]
}
```

**Dependencies**:
- Python 3
- numpy
- scipy
- pandas
- chaosmagpy (optional, for real geomagnetic axis)

---

### 4. Frontend Data Loaders

#### `load_inertia.ts`
**Purpose**: Load inertia data in frontend (Node.js)

**Description**:
- TypeScript file (but actually Node.js with CommonJS)
- Loads `inertia_timeseries.json` from data directory
- Exports `loadInertiaData()` function

**Usage in frontend**:
```typescript
import { loadInertiaData } from '@/lib/dataLoader';
```

**Note**: This file appears to be incomplete - should be a proper TypeScript module.

---

## Data Pipeline Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Raw Data Sources                            │
├───────────────────┬───────────────────┬─────────────────────────────┤
│  IERS EOP         │  GFZ-KP           │  GRACE                      │
│  finals.all.json  │  Web Service      │  Zarr Manifest              │
└─────────┬─────────┴─────────┬─────────┴────────────┬──────────────┘
          │                   │                        │
          ▼                   ▼                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Processing Scripts                               │
├───────────┬─────────┬───────────┬────────────────┬──────────────────┤
│ build_eop │combine_ │build_grac │build_inertia  │compute_rolling   │
│           │combine │e          │               │_stats           │
└───────────┴─────────┴───────────┴────────────────┴──────────────────┘
          │                   │                        │
          └───────────────────┼────────────────────────┘
                              ▼
                    ┌──────────────────────┐
                    │   data/              │
                    │   eop_historic.json  │
                    │   grace_historic.json│
                    │   geomag_gfz_kp.json │
                    │   inertia_timeseries.json │
                    │   rolling_stats.json │
                    │   combined_historic.json│
                    └──────────────────────┘
                              │
                              ▼
                    ┌──────────────────────┐
                    │     API Routes       │
                    │   /api/eop           │
                    │   /api/grace         │
                    │   /api/geomag        │
                    │   /api/inertia       │
                    │   /api/rolling-stats │
                    └──────────────────────┘
                              │
                              ▼
                    ┌──────────────────────┐
                    │   Frontend (React)   │
                    │   Charts & Visuals   │
                    └──────────────────────┘
```

---

## Data Location

All processed data is stored in:
```
/public/data/
```

Subdirectories:
- `/data/` - Development data (gitignored)
- `/data/.rolling-stats-cache/` - Cached rolling stats by hash

---

## Running the Complete Pipeline

### Using the Pipeline Wrapper Script (Recommended)

The easiest way to run the entire pipeline is using the wrapper script:

```bash
# Run complete pipeline with rolling stats
./scripts/run_pipeline.sh --compute-stats

# Or without rolling stats
./scripts/run_pipeline.sh

# Environment variables:
# COMPUTE_STATS=1  - Enable rolling stats
# WINDOW_SIZE=365  - Set rolling window size
# TURN_THRESHOLD=0.05  - Set turn detection threshold
```

### Manual Pipeline Execution

### Daily Data Refresh
```bash
# Fetch latest data
python scripts/fetch_latest.py

# Process combined data
python scripts/combine_data.py

# Compute advanced statistics
python scripts/compute_rolling_stats.py \
    -i data/eop_historic.json \
    -o data/rolling_stats.json \
    --window-size 365
```

### Initial Data Setup
```bash
# 1. Build EOP (requires finals.all.json or fetch latest)
python scripts/build_eop.py

# 2. Build GFZ-KP geomagnetic data
python scripts/build_geomag_gfz.py

# 3. Build GRACE data
python scripts/build_grace.py

# 4. Build inertia data
python scripts/build_inertia.py

# 5. Combine all data
python scripts/combine_data.py

# 6. Compute rolling statistics
python scripts/compute_rolling_stats.py \
    -i data/eop_historic.json \
    -o data/rolling_stats.json
```

---

## Dependencies

### Python Dependencies
```bash
pip install numpy scipy pandas
```

### Optional (for full functionality)
```bash
pip install chaosmagpy  # For real geomagnetic axis computation
```

---

## Error Handling

### Common Issues

1. **Missing data files**
   ```
   ERROR: eop_historic.json not found
   ```
   **Solution**: Run `build_eop.py` first

2. **Network errors**
   ```
   ERROR: Could not fetch EOP data
   ```
   **Solution**: Check internet connection or use cached data

3. **CHAOS model not found**
   ```
   CHAOS model not found, generating synthetic geomagnetic axis
   ```
   **Solution**: This is expected if CHAOS model not installed; synthetic data used

4. **Chunk decoding errors**
   ```
   ERROR: Could not decode time chunks
   ```
   **Solution**: Verify Zarr manifest integrity

---

## Performance Considerations

- `compute_rolling_stats.py` is computationally intensive (O(n²) for rolling PCA)
- Cache results in `.rolling-stats-cache/` for faster reloads
- Consider reducing `--window-size` for large datasets
- Use `--center-step` to skip intermediate center calculations

---

## Testing

```bash
# Test data generation
python scripts/build_eop.py
python scripts/build_geomag_gfz.py

# Test combined data
python scripts/combine_data.py

# Test rolling stats (small window for speed)
python scripts/compute_rolling_stats.py \
    -i data/eop_historic.json \
    -o data/rolling_stats_test.json \
    --window-size 180
```

---

## Future Enhancements

- [ ] Add real-time data streaming via WebSocket
- [ ] Implement incremental updates (only fetch new data)
- [ ] Add data validation and quality checks
- [ ] Support additional data sources (CNES, JPL)
- [ ] Optimize rolling PCA with parallelization
- [ ] Add unit tests for all scripts

---

## Maintenance Notes

### Adding New Scripts

1. Follow naming convention: `verb_noun.py` (e.g., `build_*.py`, `fetch_*.py`)
2. Include shebang: `#!/usr/bin/env python3`
3. Add comprehensive docstring
4. Use argparse for CLI arguments
5. Implement error handling
6. Save outputs to `/public/data/`

### Editing Existing Scripts

1. Test with small data first
2. Check for NaN/Inf values
3. Verify output format matches expectations
4. Update this documentation
5. Run `npm run build` to verify frontend compatibility

---

For questions or issues, start with the root `README.md` and this scripts guide.
