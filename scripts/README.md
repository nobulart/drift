# Scripts Folder - DRIFT Dashboard

This directory contains all data processing scripts for the DRIFT dashboard.

## Quick Start

### Fetch Latest Data
```bash
python scripts/fetch_latest.py
```

### Build All Data from Scratch
```bash
python scripts/build_eop.py
python scripts/build_geomag_gfz.py
python scripts/build_grace.py  
python scripts/build_inertia.py
python scripts/build_ephemeris.py
python scripts/combine_data.py
python scripts/compute_rolling_stats.py -i data/eop_historic.json -o data/rolling_stats.json
```

## Data Output

All processed data is saved to `/public/data/`:

| File | Description |
|------|-------------|
| `eop_historic.json` | Earth Orientation Parameters (xp, yp) |
| `grace_historic.json` | GRACE Liquid Water Equivalent |
| `geomag_gfz_kp.json` | GFZ-KP Geomagnetic Indices |
| `inertia_timeseries.json` | Inertia Tensor Eigenframes |
| `ephemeris_historic.json` | DE442 geocentric ephemerides |
| `combined_historic.json` | Combined dataset |
| `rolling_stats.json` | Advanced rolling statistics |

## Categories

### Data Fetching
- `fetch_latest.py` - Automated daily data retrieval

### Data Processing
- `build_eop.py` - Parse IERS EOP data
- `build_geomag.py` - Generate synthetic geomag data
- `build_geomag_gfz.py` - Fetch real GFZ-KP data
- `build_grace.py` - Process GRACE data
- `build_inertia.py` - Compute inertia frames
- `build_ephemeris.py` - Download DE442 and derive geocentric body observables
- `combine_data.py` - Merge all data sources

### Advanced Analysis
- `compute_rolling_stats.py` - PCA, phase analysis, turning points

### Frontend
- `load_inertia.ts` - Load inertia data in React app

## Documentation

- **SCRIPTS_DOCUMENTATION.md** - Comprehensive documentation
- **README.md** (in root) - Main project documentation

## Requirements

```bash
pip install numpy scipy pandas spiceypy
```

Optional:
```bash
pip install chaosmagpy
```

## CI/CD Integration

The `fetch_latest.py` script is designed to run daily via cron or GitHub Actions to keep data fresh.
