# DRIFT Data Pipeline - Quick Reference

## Run Complete Pipeline

```bash
cd /Users/craig/src/drift
./scripts/run_pipeline.sh --compute-stats
```

## Environment Variables

| Variable | Default | Description |
|-- --------|-- -------|-- -----------|
| `COMPUTE_STATS` | `0` | Enable rolling statistics |
| `WINDOW_SIZE` | `365` | Rolling window size (days) |
| `TURN_THRESHOLD` | `0.05` | Turning point detection threshold |

## Available Commands

### Full Pipeline (with stats)
```bash
./scripts/run_pipeline.sh --compute-stats
```

### Full Pipeline (without stats)
```bash
./scripts/run_pipeline.sh
```

### Individual Scripts

```bash
# Fetch latest stale data; use --force for a full upstream refresh
python3 scripts/fetch_latest.py
python3 scripts/fetch_latest.py --force

# Build EOP data
python3 scripts/build_eop.py

# Build GFZ-KP data
python3 scripts/build_geomag_gfz.py

# Build GRACE data
python3 scripts/build_grace.py

# Build inertia data
python3 scripts/build_inertia.py

# Build DE442 ephemerides
python3 scripts/build_ephemeris.py

# Combine all data
python3 scripts/combine_data.py

# Compute rolling statistics
python3 scripts/compute_rolling_stats.py \
    -i data/eop_historic.json \
    -o data/rolling_stats.json \
    --window-size 365
```

## Data Files

| File | Description | Location |
|-- ----|-- -----------|-- ------- |
| `eop_historic.json` | Earth Orientation Parameters | `data/` |
| `geomag_gfz_kp.json` | GFZ-KP Geomagnetic Indices | `data/` |
| `grace_historic.json` | GRACE LWE Data | `public/data/` |
| `inertia_timeseries.json` | Inertia Eigenframes | `public/data/` |
| `ephemeris_historic.json` | DE442 geocentric ephemerides | `data/` |
| `combined_historic.json` | Merged Dataset | `data/` |
| `rolling_stats.json` | Advanced Statistics | `data/` |

## Verification

After running the pipeline:
```bash
# Build frontend
npm run build

# Start development server
npm run dev

# Verify at http://localhost:3000
```

## Troubleshooting

### Python dependencies missing
```bash
pip install numpy scipy pandas spiceypy
```

### Data files not found
```bash
# Run pipeline first
./scripts/run_pipeline.sh --compute-stats
```

### Build errors
```bash
# Clean and rebuild
rm -rf .next out
npm run build
```
