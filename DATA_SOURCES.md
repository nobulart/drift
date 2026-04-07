# DRIFT Data Sources

## Overview

The DRIFT dashboard integrates data from multiple scientific sources:

## Data Sources

| Source | URL | Update Frequency | Current Date Range | Notes |
|-- -----|-- ---|-- -------------|-- -------------|-- ----|
| IERS EOP | finals.all.json / finals.daily.txt | Daily | 1973-01-02 to 2026-04-05 | Final values with ~2-4 day delay |
| GFZ-KP | kp.gfz-potsdam.de | Real-time | 2003-01-01 to present | 3-hourly geomagnetic indices |
| GRACE | PODAAC | Monthly | 2002-04-17 to 2025-05-16 | Liquid Water Equivalent data |

## Data Freshness

### IERS EOP Data
- **Final values**: Available with ~2-4 day delay (due to data processing/validation)
- **Rapid values**: Available in near real-time but less accurate
- **Daily updates**: `finals.daily.iau1980.txt` is the recommended source

### GFZ-KP Data
- Real-time updates via web service
- Includes Kp, ap, Ap, Cp, C9 indices

### GRACE Data
- Monthly LWE (Liquid Water Equivalent) thickness
- Data from NASA GRACE/GRACE-FO missions

## Latency Notes

| Data Type | Typical Latency |
|-- ------|-- ------ |
| IERS EOP | 2-4 days |
| GFZ-KP | < 1 hour |
| GRACE | 1 month |

The UI will display the most recent date available. If EOP data is delayed, the latest date shown will reflect the IERS data availability, not the current calendar date.

## Current Status

- Last EOP update: 2026-04-05
- Today: 2026-04-06
- Data freshness: Expected due to IERS processing delay

## Adding New Data Sources

To add a new data source:

1. Create a script in `scripts/` to fetch/process the data
2. Add an API route in `src/app/api/`
3. Add a data loader in `src/lib/dataLoader.ts`
4. Update `mergeDataSources` to include the new data
5. Update the pipeline script if needed
