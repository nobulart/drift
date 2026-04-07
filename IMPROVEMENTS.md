# DRIFT Dashboard - Issues & Improvements Plan

## 1. Charts Not Refreshing Properly on Page Load

### Root Cause
- In `src/store/useStore.ts:84-88`, when `setWindowSize` is called, `computeRollingStats()` is async but state updates may not complete before charts render
- Charts in `page.tsx` depend on state that's computed asynchronously
- Initial data load sequence: data → computeDrift → computeRollingStats (async), but components mount before all state is ready

### Solutions
1. **Add loading states** for rolling stats computation
2. **Ensure proper await chains** - `computeRollingStats` should complete before setting state
3. **Add fallback values** for components when data isn't ready
4. **Use `useEffect` dependencies** properly to trigger re-renders

### Implementation Tasks
- [ ] Add null-safety checks in all plot components for `rollingStats`, `alignment`, etc.
- [ ] Modify `Page.tsx` to show loading indicator while `computeRollingStats()` completes
- [ ] Update `useStore.ts:computeRollingStats()` to use synchronous state updates where possible
- [ ] Add explicit loading state for stats computation

---

## 2. Angle Diagnostics & Alignment Plots Autoscaling

### Root Cause
- **AngleDiagnostics.tsx:101**: `range: [-360, 360]` hardcoded
- **AlignmentOmegaPlot.tsx:197**: `range: [0, 180]` for alignment, `range: [0, 9]` for Kp/ap
- **CouplingPlot.tsx:197,207**: Hardcoded ranges for y-axis

### Solutions
1. Remove `range` properties to enable autoscaling
2. Or compute dynamic ranges from data
3. Add zoom controls that persist ranges

### Implementation Tasks
- [ ] Remove hardcoded `range` properties from all plot layouts (or make conditional)
- [ ] Test autoscaling behavior with different data windows
- [ ] Consider adding autoscale toggle control

---

## 3. Polar Motion Plot Panning/Zooming Reset

### Root Cause
- Plotly's autosize may be triggered on navigation events
- No `fixedrange` configuration to lock axes during interaction
- The `relayout` event may be triggering automatic rescaling

### Solutions
1. Add `autorange: false` and set initial range from data
2. Use `fixedrange: true` for axes that shouldn't auto-rescale
3. Store and restore zoom state on navigation

### Implementation Tasks
- [ ] Modify `PolarPlot.tsx` to preserve zoom/pan state
- [ ] Set `fixedrange: true` on xaxis and yaxis if aspect ratio must be maintained
- [ ] Or compute range from data range: `range: [min*1.1, max*1.1]`

---

## 4. Smart Automatic Data Updates

### Current State
- Data loaded once on page load via static JSON files
- Python scripts generate data offline (`scripts/` directory)
- No automatic刷新 mechanism

### Data Sources
- **EOP**: `/api/eop` → `scripts/build_eop.py`
- **Geomagnetic**: `/api/geomag` → `scripts/build_geomag.py` 
- **GRACE**: `/api/grace` → `scripts/build_grace.py`
- **Inertia**: `/api/inertia` → `scripts/load_inertia.ts`

### Proposed Architecture

#### Option A: Background Refetch (Client-side)
```typescript
// Add polling mechanism
useEffect(() => {
  const interval = setInterval(() => {
    // Refetch data from all API endpoints
    // Merge and update store
  }, REFRESH_INTERVAL); // e.g., 1 hour
  return () => clearInterval(interval);
}, []);
```

**Pros**: Simple, works client-side  
**Cons**: May hit rate limits, requires re-fetching all data

#### Option B: Incremental Updates (Server-side)
```typescript
// Add `/api/data/updates?since=timestamp` endpoint
// Returns only new data since last update
// Frontend merges with existing data
```

**Pros**: Efficient, only fetches new data  
**Cons**: More complex backend logic

#### Option C: WebSocket/Server-Sent Events
```typescript
// Real-time data push from server
// Use SSE for push notifications when new data is available
```

**Pros**: Real-time updates  
**Cons**: Requires server infrastructure changes

### Implementation Tasks

**Phase 1: Client-side Polling (Immediate)**
- [ ] Add `refetchData` function in `useStore.ts`
- [ ] Add `lastUpdated` timestamp to store
- [ ] Implement polling with configurable interval
- [ ] Add UI indicator for last update time

**Phase 2: Smart Refresh Logic**
- [ ] Add "Update Now" button in controls
- [ ] Implement data validation (check for missing dates)
- [ ] Add refresh intervals per data source (EOP daily, GRACE monthly)

**Phase 3: Backend Integration (Future)**
- [ ] Add `/api/data/since?timestamp` endpoint
- [ ] Backend checks source files for modifications
- [ ] Return only new/changed data

---

## Priority Order

1. **High**: Fix autoscaling issues (simple config changes)
2. **High**: Fix Polar plot panning issue (affects user experience)
3. **Medium**: Fix chart refresh on load (data flow)
4. **Low-Medium**: Implement data refresh mechanism

---

## Files to Modify

### Core Store
- `src/store/useStore.ts`

### Page Components
- `src/app/page.tsx`
- `src/components/Controls.tsx` (add refresh button)

### Plot Components  
- `src/components/PolarPlot.tsx`
- `src/components/AngleDiagnostics.tsx`
- `src/components/AlignmentOmegaPlot.tsx` (if used)
- `src/components/CouplingPlot.tsx`

### API (for future)
- Add new API endpoints for incremental updates

---

## Testing Strategy

1. **Load testing**: Verify all charts render on initial load
2. **Window size testing**: Change window size, verify all charts update
3. **Interaction testing**: Zoom/pan polar plot, verify state persists
4. **Autoscale testing**: Verify y-axis scales to data range
