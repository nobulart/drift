# DRIFT Script Audit Complete ✅

## Summary

All scripts in the `/scripts/` folder have been audited, tested, and documented. A comprehensive pipeline wrapper script has been created for easy execution.

## Test Results

All scripts tested successfully:

| Script | Status | Output |
|-- ------|-- -----|-- -----|
| `fetch_latest.py` | ✅ PASS | Downloaded EOP, GRACE, GFZ-KP data |
| `build_eop.py` | ✅ PASS | Processed 19449 EOP records |
| `build_geomag_gfz.py` | ✅ PASS | Processed 67680 GFZ-KP records |
| `build_grace.py` | ✅ PASS | Processed 245 GRACE records |
| `build_inertia.py` | ✅ PASS | Generated 12000 inertia records |
| `combine_data.py` | ✅ PASS | Merged to 19449 combined records |
| `compute_rolling_stats.py` | ✅ PASS | Computed rolling PCA statistics |

**Build Verification**: ✅ Next.js build passed (13 routes, 0 errors)

## Pipeline Wrapper Script

### `scripts/run_pipeline.sh`

A comprehensive wrapper script that runs the entire pipeline:

```bash
# Run complete pipeline with rolling stats
./scripts/run_pipeline.sh --compute-stats

# Or without rolling stats
./scripts/run_pipeline.sh

# With environment variables
COMPUTE_STATS=1 WINDOW_SIZE=365 ./scripts/run_pipeline.sh
```

**Features**:
- Automated dependency checking
- Progress logging with colors
- Clear step-by-step output
- Optional rolling statistics computation
- Data file summary
- Next steps guidance

## File Locations

### Data Files (generated)
- `data/eop_historic.json` - Earth Orientation Parameters
- `data/geomag_gfz_kp.json` - GFZ-KP Geomagnetic Indices
- `data/grace_historic.json` - GRACE Liquid Water Equivalent
- `data/inertia_timeseries.json` - Inertia Tensor Eigenframes
- `data/combined_historic.json` - Merged dataset
- `data/rolling_stats.json` - Advanced rolling statistics

### Scripts (audited)
- `scripts/fetch_latest.py` - Automated data retrieval
- `scripts/build_eop.py` - EOP data parsing
- `scripts/build_geomag_gfz.py` - GFZ-KP data processing
- `scripts/build_grace.py` - GRACE data processing
- `scripts/build_inertia.py` - Inertia calculations
- `scripts/combine_data.py` - Data merging
- `scripts/compute_rolling_stats.py` - Rolling analysis
- `scripts/run_pipeline.sh` - Pipeline wrapper (NEW)

## Usage

### Quick Start
```bash
cd /Users/craig/src/drift
python3 scripts/run_pipeline.sh --compute-stats
npm run build
npm run dev
```

### Manual Steps
```bash
python3 scripts/fetch_latest.py
python3 scripts/build_eop.py
python3 scripts/build_geomag_gfz.py
python3 scripts/build_grace.py
python3 scripts/build_inertia.py
python3 scripts/combine_data.py
python3 scripts/compute_rolling_stats.py \
    -i data/eop_historic.json \
    -o data/rolling_stats.json
```

## Documentation Created

1. **`SCRIPTS_DOCUMENTATION.md`** (15 KB) - Comprehensive audit documentation
2. **`scripts/README.md`** (NEW) - Quick start guide
3. **`scripts/run_pipeline.sh`** (NEW) - Pipeline wrapper script
4. **`AUDIT_COMPLETE.md`** - Summary of audit findings

## Data Sources Verified

- ✅ IERS EOP data from finals.all.json
- ✅ GFZ-KP geomagnetic indices from web service
- ✅ GRACE MASCON data from Zarr manifest
- ✅ Inertia data (synthetic, ready for real data)

## Next Steps

1. ✅ All scripts tested and working
2. ✅ Pipeline wrapper created
3. ✅ Build verified
4. Next: Run `npm run dev` to verify dashboard displays correctly

## Maintenance

### To refresh data daily:
```bash
./scripts/run_pipeline.sh --compute-stats
```

### To rebuild dashboard:
```bash
npm run build
npm run dev
```
