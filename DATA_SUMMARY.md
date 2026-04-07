# Data Summary

## DRIFT Data System - Summary

### Data Files Overview

| File | Records | Date Range | Description |
|------|---------|------------|-- -----------|
| `eop_historic.json` | 19,449 | 1973-2026 | IERS EOP polar motion (xp, yp) |
| `grace_historic.json` | 245 | 2002-2025 | GRACE LWE thickness (monthly) |
| `geomag_gfz_kp.json` | 67,680 | 2003-2026 | GFZ-KP geomagnetic indices (3-hourly) |

### Data Statistics

**EOP (Earth Orientation Parameters)**:
- Date range: 1973-01-02 to 2026-04-02
- XP (polar motion): -0.2477 to 0.3255 arcsec
- YP (polar motion): 0.0141 to 0.5967 arcsec
- Additional: UT1-UTC, LOD available

**GRACE MASCON**:
- Date range: 2002-04-17 to 2025-05-16
- Resolution: Monthly (245 records)
- Data: Liquid Water Equivalent thickness (cm)
- Grid: 360 × 720 (0.5° global resolution)

**GFZ-KP Geomagnetic Indices**:
- Date range: 2003-01-01 to 2026-02-28
- Resolution: 3-hourly (67,680 records/year ≈ 67k records total)
- Kp: 0.0 to 9.0 (mean: 1.747)
- Ap: 0 to 100+ (daily equivalent)
- Plus: Cp, C9, SN, F10.7

### Data Integration

**Combined dataset** (`combined_historic.json`):
- 19,449 records (EOP + GFZ-KP matched by date)
- Each record contains: t, xp, yp, kp, ap, ap_daily
- Ready for correlation analysis

### API Endpoints

All API routes return JSON with data arrays:

- `/api/eop` - EOP polar motion (last 30 days)
- `/api/geomag` - GFZ-KP indices (last 30 days)
- `/api/combined` - EOP + GRACE (full historic)
- `/api/combined-full` - EOP + GRACE + GFZ-KP (full historic)

### Data Sources & Licensing

| Source | License |
|--------|---------|
| IERS EOP | IERS Data Policy |
| GRACE | NASA Earth Science Data Policy |
| GFZ-KP | CC BY 4.0 |

### Citation

If using this data in research, please cite:

- **EOP**: IERS (2026). IERS Earth Orientation Parameters.
- **GRACE**: Wiese, D. et al. (2026). JPL GRACE and GRACE-FO MASCON RL06.3Mv04 CRI.
- **KP**: Matzka, J. et al. (2021). The geomagnetic Kp index. Space Weather.

### Automated Retrival

Update data daily with:
```bash
python3 scripts/fetch_latest.py
```

Add to crontab:
```bash
0 1 * * * cd /path/to/drift && python3 scripts/fetch_latest.py
```
