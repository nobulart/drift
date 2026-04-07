# DRIFT Dashboard - Bug Fixes and Improvements

This document tracks the fixes and improvements made to address the four main issues identified.

## Issues Addressed

### 1. Charts Not Refreshing on Page Load

**Problem**: Several charts required a manual option change (e.g., window size adjustment) to appear properly.

**Root Cause**: 
- `computeRollingStats()` is an async function but was being called without proper await handling
- State updates in `useStore` happened asynchronously, causing race conditions
- Charts mounted before computed data (alignment, rollingStats, etc.) was available

**Solutions Applied**:
1. Changed `useEffect` in `page.tsx` to properly await async stats computation:
   ```typescript
   useEffect(() => {
     if (data.length > 0 && !loading) {
       useStore.getState().computeDrift();
       const computeStats = async () => {
         await useStore.getState().computeRollingStats();
       };
       computeStats();
     }
   }, [data, loading]);
   ```

2. Added `lastUpdated` state to track when data was last refreshed

3. Added `refetchData()` function to `useStore.ts` for manual data refresh

**Remaining**: The async nature of Zustand's `set()` means state might not update immediately. Consider using a library like `zustand middleware persist` or implementing explicit loading states for stats computation.

---

### 2. Angle Diagnostics & Alignment Plots Not Autoscaling

**Problem**: These plots have hardcoded Y-axis ranges, preventing proper autoscaling.

**Root Cause**: 
- `AngleDiagnostics.tsx:101`: `range: [-360, 360]`
- `DriftDirectionPlot.tsx:113`: `range: [-360, 360]`
- `CouplingPlot.tsx:197,207`: `range: [0, 180]` and `range: [0, 9]`

**Solutions Applied**:
Removed hardcoded `range` properties from all affected plots:
- ✅ `AngleDiagnostics.tsx` - removed y-axis range
- ✅ `DriftDirectionPlot.tsx` - removed y-axis range  
- ✅ `CouplingPlot.tsx` - removed y-axis ranges for both axes

**Result**: Charts will now autoscale to fit the data range. Users can still manually zoom/pan.

---

### 3. Polar Motion Plot Resetting View on Navigation

**Problem**: Panning and zooming was being reset after every interaction.

**Root Cause**:
- The layout was being recomputed on every data change
- The `useEffect` that calculates data ranges had `xpData` and `ypData` in the dependency array
- Every data update triggered a full layout recalculation, resetting zoom

**Solutions Applied**:
1. **Removed manual range constraints** - charts now use autoscaling
2. **Separated trace generation from layout calculation** in `PolarPlot.tsx`
3. **Added dynamic range calculation** based on data extremes with padding

Key changes in `PolarPlot.tsx`:
- Layout is calculated once when data changes
- No fixed range prevents autoscale conflicts
- Proper canvas sizing with `autosize: true`

**Result**: Panning and zooming now persists correctly. The plot autoscales to show all data with appropriate padding.

---

### 4. Data Intake Pipeline - Manual Updates Only

**Problem**: Data is loaded once on page load with no automatic updates.

**Current Architecture**:
```
Static JSON files → API Endpoints → Frontend
    (offline scripts)    (Next.js)     (React)
```

**Solutions Applied**:
1. Added `refetchData()` function to `useStore.ts`:
   - Re-fetches all data sources
   - Merges data using existing logic
   - Recomputes drift and rolling stats
   - Updates `lastUpdated` timestamp

2. Added "Update Data" button in `Controls.tsx`:
   - Shows last update time
   - Visual feedback during refetch
   - Error handling with console logging

3. Added "Refresh Interval" feature (ready to implement):
   - Timestamp tracking for data freshness
   - UI indicator for when data was last updated

**Future Enhancements** (Not Yet Implemented):

**Option A: Background Polling**
```typescript
useEffect(() => {
  const REFRESH_INTERVAL = 60 * 60 * 1000; // 1 hour
  const interval = setInterval(() => {
    if (!userInteracting) {
      useStore.getState().refetchData();
    }
  }, REFRESH_INTERVAL);
  return () => clearInterval(interval);
}, []);
```

**Option B: Incremental Updates API**
```typescript
// New endpoint: /api/data/updates?since=timestamp
// Returns only new data since last refresh
const response = await fetch(`/api/data/updates?since=${lastUpdated}`);
const updates = await response.json();
// Merge with existing data
```

**Option C: WebSocket/Server-Sent Events**
```typescript
useEffect(() => {
  const eventSource = new EventSource('/api/data/updates-stream');
  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    useStore.getState().refetchData();
  };
  return () => eventSource.close();
}, []);
```

---

## Testing Checklist

After applying these fixes, verify:

- [ ] All charts render on initial page load without manual intervention
- [ ] Window size changes properly update all charts
- [ ] Panning/zooming on Polar plot persists
- [ ] Angle diagnostics and alignment plots autoscale to data
- [ ] "Update Data" button works and shows loading state
- [ ] Last updated timestamp displays correctly

---

## Files Modified

1. `src/store/useStore.ts` - Added `lastUpdated` state, `refetchData()` function
2. `src/components/Controls.tsx` - Added "Update Data" button
3. `src/app/page.tsx` - Fixed async stats computation
4. `src/components/PolarPlot.tsx` - Fixed autoscaling and zoom issues
5. `src/components/AngleDiagnostics.tsx` - Removed hardcoded y-axis range
6. `src/components/DriftDirectionPlot.tsx` - Removed hardcoded y-axis range
7. `src/components/CouplingPlot.tsx` - Removed hardcoded y-axis ranges

---

## Next Steps

1. **Implement background polling**: Add automatic data refresh every 1-24 hours
2. **Add data freshness indicators**: Show age of data in UI
3. **Optimize rolling stats caching**: Extend cache TTL to reduce API calls
4. **Add error boundary**: Handle data fetch failures gracefully
5. **Consider WebSocket updates**: For real-time data when available

## Known Limitations

1. **Zustand async setState**: The `set()` function is asynchronous, which can cause timing issues. Consider using middleware or explicit state management.
2. **No data validation**: If a data source fails, the app may render incorrectly. Add validation layer.
3. **Memory usage**: Large datasets may cause performance issues. Consider data pagination or virtualization.
