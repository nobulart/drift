# DRIFT Data System

This document describes the automated data retrieval and integration system for the DRIFT geodetic-geomagnetic coupling dashboard.

## Data Sources

### 1. IERS EOP Data (Earth Orientation Parameters)
- **Source**: IERS Data Center (datacenter.iers.org)
- **Format**: JSON (finals.all.json)
- **Content**: 
  - Pole coordinates (X, Y) in arcseconds
  - UT1-UTC in seconds
  - LOD (Length of Day) in milliseconds
  - Nutation corrections (dPsi, dEpsilon)
- **Time Range**: 1973-2026
- **Resolution**: Daily
- **License**: IERS Data Policy

### 2. GRACE MASCON Data
- **Source**: NASA PO.DAAC (podaac.jpl.nasa.gov)
- **Format**: Zarr-over-HTTP
- **Content**: 
  - Liquid Water Equivalent (LWE) thickness (cm)
  - Global 0.5° grid (360 × 720)
  - Time series from 2002-2025
- **Resolution**: Monthly
- **License**: NASA Earth Science Data Policy

### 3. GFZ-KP Geomagnetic Indices
- **Source**: GFZ German Research Centre for Geosciences (kp.gfz.de)
- **Format**: JSON via Web Service API
- **Content**:
  - Kp: Planetary 3-hour index (0-9)
  - ap: Equivalent planetary amplitude
  - Ap: Daily equivalent planetary amplitude
  - Cp, C9: Activity indices
  - SN, F10.7: Solar indices (via extended datasets)
- **Time Range**: 1932-present
- **Resolution**: 3-hourly (Kp), daily (Ap)
- **License**: CC BY 4.0 (GFZ)

### 4. JPL DE442 Ephemeris Cache
- **Source**: JPL DE442 planetary ephemeris kernel
- **Format**: Pre-extracted daily JSON cache
- **Content**:
  - Earth-geocentric body distance and angular state
  - Ecliptic longitude and angular velocity
  - Torque-proxy series used for contextual overlays and phase-composite construction
- **Time Range**: 1973-2050
- **Resolution**: Daily
- **Role**: Supports planetary overlay context and the Phase-Locked Escape Model composite phases. This is a phase-conditioned diagnostic input, not a deterministic forcing claim.

## Data Pipeline

### Build Scripts

#### `scripts/build_eop.py`
Parse IERS EOP data from finals.all.json and extract xp, yp (polar motion).

#### `scripts/build_grace.py`
Process GRACE Zarr manifest to extract time coordinates and create time series.

#### `scripts/build_geomag_gfz.py`
Fetch and process GFZ-KP geomagnetic indices via web service API.

#### `scripts/combine_data.py`
Combine EOP, GRACE, and GFZ-KP data into unified format.

#### `scripts/build_ephemeris.py`
Extract the slim daily DE442 overlay cache used by dashboard ephemeris panels and phase-composite construction.

#### `scripts/compute_phase_escape.py`
Build Phase-Locked Escape Model inputs from internal EOP/DRIFT state and cached DE442 ephemeris. This production path does not read `docs/drift.csv` or any `docs/outputs` exploratory artifacts.

### Fetch Scripts

#### `scripts/fetch_latest.py`
Timestamp-aware retrieval script that:
1. Fetches latest EOP from IERS JSON API
2. Fetches latest GRACE manifest
3. Fetches latest KP data for past 60 days
4. Creates combined data files
5. Skips sources whose local cache files are still within their freshness windows, unless `--force` is supplied

## Data Files

### Location: `/data/`

| File | Contents | Records | Last Updated |
|------|----------|---------|--------------|
| `eop_historic.json` | EOP polar motion data | 19,449 | 2026-04-02 |
| `eop_latest.json` | Recent EOP data (last 30 days) | 30 | Daily |
| `grace_historic.json` | GRACE LWE time series | 245 | Monthly |
| `grace_latest.json` | Latest GRACE data | 245 | Monthly |
| `geomag_gfz_kp.json` | Full GFZ-KP record | 67,680 | Monthly |
| `geomag_gfz_latest.json` | Recent KP data | 25 | Daily |
| `combined_historic.json` | Combined EOP+KP | 19,449 | Monthly |
| `combined_latest.json` | Latest combined data | 19,449 | Daily |
| `ephemeris_historic.json` | Daily DE442 Earth-geocentric overlay cache | 28,000+ | Static / rebuilt as needed |
| `.phase-escape-cache/*.json` | Cached Phase-Locked Escape Model API outputs | Window-dependent | On demand |

## API Routes

### `/api/eop`
Returns IERS EOP rapid data (polar motion: xp, yp).

### `/api/geomag`
Returns GFZ-KP geomagnetic indices (Kp, ap, Ap).

### `/api/combined`
Returns combined EOP + GRACE data.

### `/api/combined-full`
Returns EOP + GRACE + GFZ-KP data.

### `/api/ephemeris`
Returns the cached DE442-derived Earth-geocentric overlay dataset.

### `/api/rolling-stats`
Computes or serves cached rolling DRIFT diagnostics, lag models, and transition-state inputs.

### `/api/transition-forecast`
Returns the experimental lag-conditioned transition probability summary.

### `/api/phase-escape`
Returns Phase-Locked Escape Model state derived from internal DRIFT EOP state and DE442 composite phases. The experimental panel computes residual phase misalignment, phase drift, phase acceleration, escape probability, barrier ratio, phase stability, and a Kramers-like comparative index from this internal state.

## Phase-Locked Escape Model

The Phase-Locked Escape Model is an experimental dashboard diagnostic introduced in v1.4.7. It uses internal DRIFT state and DE442-derived torque-proxy analytic phases to compute residual phase misalignment against registered planetary composites.

Runtime behavior:

- No production code reads `docs/drift.csv`.
- No production code reads `docs/outputs/*`.
- The panel consumes `/api/phase-escape`, which is backed by internal EOP/DRIFT state plus DE442 cache data.
- The model reports phase-dependent escape probability, phase drift, phase acceleration, curvature signal, phase stability, escape-energy diagnostic values, barrier ratio, and a Kramers-like comparative index.

Interpretation constraints:

- Treat the output as a phase-conditioned metastable escape diagnostic.
- Treat `R(t)` as a noise proxy for the Kramers-like index, not as literal thermal noise.
- Do not interpret energy values as physical joules or deterministic transition timing.
- Do not interpret DE442 phase composites as planetary triggers.

## Automation

### Daily Fetch Schedule

Add to cron or use task scheduler:

```bash
# Run daily at 01:00 UTC
0 1 * * * cd /path/to/drift && python3 scripts/fetch_latest.py
```

### Manual Update

```bash
python3 scripts/fetch_latest.py
python3 scripts/fetch_latest.py --force
```

## Data Updates

- **EOP**: Updated daily by IERS
- **GRACE**: Updated monthly (~10 days after month end)
- **KP**: Updated daily by GFZ

## Data Quality Notes

1. **EOP**: Recent values may be preliminary until definitive values are available (typically 1-2 months later)
2. **GRACE**: LWE values are smoothed with CRI filter; temporal resolution is monthly
3. **KP**: Kp indices are 3-hourly averages; use ap/Ap for continuous measures

## Citation

- **EOP**: IERS (2026). IERS Earth Orientation Parameters.
- **GRACE**: Wiese, D. et al. (2026). JPL GRACE и GRACE-FO MASCON RL06.3Mv04 CRI.
- **KP**: Matzka, J. et al. (2021). The geomagnetic Kp index. Space Weather.

## License

- IERS EOP: IERS Data Policy
- GRACE: NASA Earth Science Data Policy
- GFZ-KP: CC BY 4.0
