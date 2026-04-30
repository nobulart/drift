# DRIFT Data Integration System

## Overview

This project integrates multiple scientific data sources to study geodetic-geomagnetic coupling. The system automatically retrieves and processes data from:

1. **IERS EOP** - Earth Orientation Parameters (polar motion)
2. **GRACE MASCON** - Gravity solutions (liquid water equivalent thickness)
3. **GFZ-KP** - Geomagnetic indices (Kp, ap, Ap, Cp, C9)

## Data Sources

### IERS EOP (Earth Orientation Parameters)

**Source**: https://datacenter.iers.org/data/json/finals.all.json

**Content**:
- Pole coordinates (X, Y) in arcseconds
- UT1-UTC in seconds  
- LOD (Length of Day) in milliseconds
- Nutation corrections (dPsi, dEpsilon) in marcsec

**Format**: JSON with structure:
```json
{
  "EOP": {
    "data": {
      "timeSeries": [
        {
          "time": {"dateYear": "YYYY", "dateMonth": "MM", "dateDay": "DD", "MJD": "N"},
          "dataEOP": {
            "pole": [{"source": "BulletinA", "X": "0.123", "Y": "0.456", ...}],
            "UT": [{"source": "BulletinA", "UT1-UTC": "0.876", "LOD": "3.456", ...}],
            "nutation": [{"source": "BulletinA", "dPsi": "44.969", "dEpsilon": "2.839", ...}]
          }
        }
      ]
    }
  }
}
```

### GRACE MASCON (Mass Conservation)

**Source**: https://archive.podaac.earthdata.nasa.gov/podaac-ops-cumulus-public/virtual_collections/TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4/

**Content**:
- Liquid Water Equivalent (LWE) thickness in cm
- Global 0.5° grid (360 lat × 720 lon)
- Monthly resolution from 2002-2025

**Format**: Zarr-over-HTTP manifest (JSON referencing actual NetCDF data)

**Data Extraction**:
```python
# Time coordinates in days since 2002-01-01
dates = [base_date + timedelta(days=float(days)) for days in time_values]
```

### GFZ-KP Geomagnetic Indices

**Source**: https://kp.gfz-potsdam.de/app/json/

**Content**:
- Kp: Planetary 3-hour index (0-9, dimensionless)
- ap: Equivalent planetary amplitude (nT-like)
- Ap: Daily equivalent planetary amplitude
- Cp, C9: Activity indices
- SN, F10.7: Solar indices (via extended datasets)

**Format**: JSON from web service API

## Data Pipeline

### Scripts

#### `scripts/build_eop.py`
Parse IERS finals.all.json and extract polar motion data.

**Output**: `data/eop_historic.json`
- 19,449 daily records (1973-2026)
- Each record: `{"t": "YYYY-MM-DD", "xp": 0.123, "yp": 0.456, ...}`

#### `scripts/build_grace.py`
Extract GRACE time series from Zarr manifest.

**Output**: `data/grace_historic.json`
- 245 monthly records (2002-2025)
- Each record: `{"t": "YYYY-MM-DD", "lwe_mean": 0.0, ...}`

#### `scripts/build_geomag_gfz.py`
Fetch GFZ-KP data via web service API.

**Output**: `data/geomag_gfz_kp.json`
- 67,680 records (2003-2026, 3-hourly)
- Each record: `{"t": "YYYY-MM-DD", "kp": 1.234, "ap": 7, "ap_daily": 12, ...}`

#### `scripts/fetch_latest.py`
Timestamp-aware retrieval script.

**Functions**:
1. Fetch latest EOP from IERS API when the local EOP cache may be stale
2. Fetch latest GRACE manifest when the local GRACE cache may be stale
3. Fetch latest KP data for the past 60 days when the local GFZ-KP cache may be stale
4. Create combined data files only when source artifacts changed
5. Accept `--force` to bypass freshness windows

**Output**: `data/eop_latest.json`, `data/grace_latest.json`, `data/geomag_gfz_latest.json`, `data/combined_latest.json`

### Data Files

| File | Records | Description |
|------|---------|-------------|
| `eop_historic.json` | 19,449 | Full EOP record (1973-2026) |
| `eop_latest.json` | 30 | Recent EOP (daily) |
| `grace_historic.json` | 245 | Full GRACE record (2002-2025) |
| `grace_latest.json` | 245 | Latest GRACE (monthly) |
| `geomag_gfz_kp.json` | 67,680 | Full KP record (1932+) |
| `geomag_gfz_latest.json` | 25 | Recent KP (last month) |
| `combined_historic.json` | 19,449 | EOP + GFZ-KP combined |
| `combined_latest.json` | 19,449 | Latest combined data |

## API Routes

### `/api/eop`
Returns recent IERS EOP polar motion data.

```json
[
  {"t": "2027-04-10", "xp": 0.0806, "yp": 0.4832},
  {"t": "2027-04-09", "xp": 0.0762, "yp": 0.4798},
  ...
]
```

### `/api/geomag`
Returns recent GFZ-KP geomagnetic indices.

```json
[
  {"t": "2026-02-28", "kp": 2.333, "ap": 9, "ap_daily": 9},
  {"t": "2026-02-27", "kp": 1.667, "ap": 6, "ap_daily": 6},
  ...
]
```

### `/api/combined`
Returns combined EOP + GRACE data.

```json
[
  {"t": "2002-04-17", "xp": 0.234, "yp": 0.456, "grace_lwe_mean": 0.0},
  ...
]
```

### `/api/combined-full`
Returns EOP + GRACE + GFZ-KP combined data.

```json
[
  {"t": "2002-04-17", "xp": 0.234, "yp": 0.456, "grace_lwe_mean": 0.0, "kp": 1.234, "ap": 7},
  ...
]
```

## Usage

### Building Data Files

```bash
# Build full historic datasets
python3 scripts/build_eop.py
python3 scripts/build_grace.py
python3 scripts/build_geomag_gfz.py

# Combine data sources
python3 scripts/combine_data.py

# Or use timestamp-aware combined script
python3 scripts/fetch_latest.py
python3 scripts/fetch_latest.py --force
```

### Running Development Server

```bash
npm run dev
```

### Automated Daily Retrieval

```bash
# Add to crontab (daily at 01:00 UTC)
0 1 * * * cd /path/to/drift && python3 scripts/fetch_latest.py

# Or run manually; fresh local files are skipped
python3 scripts/fetch_latest.py
python3 scripts/fetch_latest.py --force
```

## Data Quality Notes

1. **EOP**: Recent values may be preliminary until definitive values are available (1-2 months later)
2. **GRACE**: LWE values are smoothed with CRI filter; temporal resolution is monthly
3. **KP**: Kp indices are 3-hourly averages; use ap/Ap for continuous measures

## Citation

- **EOP**: IERS (2026). IERS Earth Orientation Parameters.
- **GRACE**: Wiese, D. et al. (2026). JPL GRACE and GRACE-FO MASCON RL06.3Mv04 CRI.
- **KP**: Matzka, J. et al. (2021). The geomagnetic Kp index. Space Weather.

## License

- **IERS EOP**: IERS Data Policy
- **GRACE**: NASA Earth Science Data Policy  
- **GFZ-KP**: CC BY 4.0
