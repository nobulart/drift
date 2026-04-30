# Data Processing Scripts

## Quick Start

```bash
# Build all data files from scratch
python3 scripts/build_eop.py
python3 scripts/build_grace.py
python3 scripts/build_geomag_gfz.py
python3 scripts/combine_data.py

# Or fetch_latest to update stale source artifacts
python3 scripts/fetch_latest.py
python3 scripts/fetch_latest.py --force
```

## Available Scripts

### `scripts/build_eop.py`
Parse IERS EOP data from finals.all.json

**Output**: `data/eop_historic.json` (19,449 records, 1973-2026)

**Features**:
- Extracts polar motion (xp, yp)
- Also extracts UT1-UTC, LOD
- Uses full finals.all.json dataset

### `scripts/build_grace.py`
Extract GRACE MASCON data from Zarr manifest

**Output**: `data/grace_historic.json` (245 records, 2002-2025)

**Features**:
- Parses Zarr-over-HTTP manifest
- Extracts time coordinates (245 monthly records)
- Extracts monthly time coordinates; real mass fields require additional source processing
- Full chunk data requires additional processing

### `scripts/build_geomag_gfz.py`
Fetch GFZ-KP geomagnetic indices via web service

**Output**: `data/geomag_gfz_kp.json` (67,680 records, 2003-2026)

**Features**:
- Fetches Kp, ap, Ap, Cp, C9 indices
- Uses GFZ web service API
- 3-hourly resolution data

### `scripts/combine_data.py`
Combine EOP, GRACE, and GFZ-KP data

**Output**: `data/combined_historic.json`

**Features**:
- Merges data sources by date
- All data normalized to daily resolution

### `scripts/fetch_latest.py`
Timestamp-aware data retrieval

**Output**: 
- `data/eop_latest.json` (last 30 EOP records)
- `data/grace_latest.json` (latest GRACE manifest metadata)
- `data/geomag_gfz_latest.json` (past month's KP)
- `data/combined_latest.json` (combined data)

**Features**:
- Skips EOP, GFZ-KP, and GRACE retrievals while local files are still fresh
- Falls back to cached data if online sources unavailable
- Updates all "latest" files
- Use `--force` to bypass freshness windows

## Usage

### Building from Scratch

```bash
cd /path/to/drift/scripts
python3 build_eop.py
python3 build_grace.py
python3 build_geomag_gfz.py
python3 combine_data.py
```

### Updating Data

```bash
# Run automated fetch
python3 fetch_latest.py

# Force all upstream retrievals
python3 fetch_latest.py --force
```

### Scheduling Daily Updates

```bash
# Add to crontab
0 1 * * * cd /path/to/drift && python3 scripts/fetch_latest.py
```

## Data Sources

| Source | URL | Format | Resolution |
|--------|-----|--------|-- -----------|
| IERS EOP | https://datacenter.iers.org/data/json/finals.all.json | JSON | Daily |
| GRACE | https://archive.podaac.earthdata.nasa.gov/podaac-ops-cumulus-public/virtual_collections/TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4/ | Zarr over HTTP | Monthly |
| GFZ-KP | https://kp.gfz-potsdam.de/app/json/ | Web Service API | 3-hourly |

## Output Format

All scripts output JSON with consistent structure:

```json
[
  {"t": "2026-04-05", "xp": 0.123, "yp": 0.456},
  {"t": "2026-04-04", "xp": 0.120, "yp": 0.452},
  ...
]
```

For GRACE:
```json
[
  {"t": "2025-05-16", "lwe_mean": 0.0, "lwe_std": 0.0, "valid_pixels": 259200},
  ...
]
```

For GFZ-KP:
```json
[
  {"t": "2026-04-05", "kp": 1.333, "ap": 5, "ap_daily": 6},
  ...
]
```

## Notes

1. **GRACE LWE values**: Synthetic placeholders are not used in the active dashboard pipeline. Full mass-field values require additional source processing beyond the manifest metadata.

2. **EOP data**: Uses IERS 'finals.all.json' which contains both Bulletin A (final+prediction) and Bulletin B (final only) data. We extract Bulletin A final values.

3. **KP data**: Contains 3-hourly Kp values. Daily means are also available via ap_daily field.

4. **Automation**: The `fetch_latest.py` script handles data source selection intelligently, skips fresh local caches, and falls back to cached data if online sources are unavailable.
