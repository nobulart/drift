# DRIFT Dashboard - Data Date Range Analysis

## Issue
UI showing data only up to 2 April 2026, but today is 6 April 2026.

## Root Cause
The EOP (Earth Orientation Parameters) data source `data/finals.all.json` only contains data up to **2026-04-02**.

## Analysis

### Current Data Sources
| File | Date Range | Source |
|-- ----|-- ------|-- -----|
| `finals.all.json` | 1973-01-02 to 2026-04-02 | IERS (snapshotted) |
| `finals.daily.iau1980.txt` | 1973-01-02 to 2026-07-05 | IERS (daily updates) |

### Problem
The `build_eop.py` script uses `finals.all.json` which is:
1. A static snapshot (not updated daily)
2. Behind the `finals.daily` file by several days
3. Missing data for 3-6 April 2026

### IERS Data Files Overview
IERS provides multiple EOP data files:
- **`finals.all`**: Historical archive (monthly snapshots)
- **`finals.daily`**: Daily updates with most recent data
- **`finals.data`**: Daily data files
- **`bulletinA`**: Rapid data (3-day forecast)

The `build_eop.py` script currently only handles `finals.all.json`.

## Solution Options

### Option A: Fetch `finals.daily.iau1980.txt` (RECOMMENDED)
Update `build_eop.py` to also fetch and parse the daily file which has the latest data.

**Pros**:
- Simple change to add one more data source
- Gets up-to-date EOP data
- Minimal code changes

**Cons**:
- Need to merge two data sources
- Potential duplicate dates to handle

### Option B: Use IERS rapid/EOP endpoint
Update `fetch_iers_rapid()` to use correct URL that returns actual data.

**Pros**:
- Gets latest rapid data (includes forecast)

**Cons**:
- URL returns 404 currently
- Rapid data may be less reliable (predictions)

### Option C: Combine multiple sources
Use both `finals.all.json` (for historical) and `finals.daily` (for recent).

**Pros**:
- Most complete data coverage

**Cons**:
- More complex parsing and merging logic

## Recommended Approach: Option A

Modify `build_eop.py` to:
1. Check if `finals.all.json` exists, if not fetch it
2. Also fetch `finals.daily.iau1980.txt`
3. Parse both files
4. Merge, keeping recent values from `finals.daily` when dates overlap

## Data Files to Add to Scripts

The scripts need to handle these IERS endpoints:
```
https://datacenter.iers.org/data/latestVersion/finals.all.iau1980.txt
https://datacenter.iers.org/data/latestVersion/finals.daily.iau1980.txt
```

## Testing Plan

After implementing the fix:
1. Run `python scripts/build_eop.py` 
2. Verify last date is 2026-07-05 (or current date)
3. Run full pipeline: `./scripts/run_pipeline.sh --compute-stats`
4. Verify UI shows correct dates

## Files to Modify

1. **`scripts/build_eop.py`**:
   - Add `fetch_finals_daily()` function
   - Merge daily data with existing data
   - Handle date overlaps

2. **`scripts/run_pipeline.sh`**:
   - Add warning message about IERS delay if needed

3. **`SCRIPTS_DOCUMENTATION.md`**:
   - Document the date range limitation
   - Explain IERS data availability
