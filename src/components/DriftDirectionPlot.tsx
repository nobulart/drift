"use client";

import { useEffect, useState, useRef, useMemo } from 'react';
import type { MouseEvent } from 'react';
import Plot from 'react-plotly.js';
import { useTimeStore } from '@/store/timeStore';
import { extractPlotlyDateRange } from '@/lib/timeRange';
import { driftAxisLongitude } from '@/lib/transforms';
import { usePlotDisplayHeight } from '@/components/usePlotDisplayHeight';
import { createCsvExportConfig } from '@/lib/plotlyCsvExport';
import { useChartTitle } from '@/lib/chartTitles';
import { useStore } from '@/store/useStore';
import { buildMarkerLayout, getContextMenuDate, getMarkerDeleteToleranceDays, getPlotClickDate, useVisibleChartMarkers } from '@/lib/chartMarkers';

interface DriftDirectionPlotProps {
  dates: string[];
  driftAxisTimeSeries: [number, number, number][];
  e1: [number, number, number];
  e2: [number, number, number];
  windowSize?: number;
}

export default function DriftDirectionPlot({ 
  dates, 
  driftAxisTimeSeries,
  e1,
  e2,
  windowSize
}: DriftDirectionPlotProps) {
  const { timeRange, timeLockEnabled, setTimeRange } = useTimeStore();
  const isInternalUpdate = useRef(false);
  const [traces, setTraces] = useState<Plotly.Data[]>([]);
  const [driftAngles, setDriftAngles] = useState<number[]>([]);
  const [e1Angles, setE1Angles] = useState<number[]>([]);
  const [e2Angles, setE2Angles] = useState<number[]>([]);
  const plotHeight = usePlotDisplayHeight(500, 860);
  const driftLon = driftAxisTimeSeries.length > 0
    ? driftAxisLongitude(driftAxisTimeSeries[driftAxisTimeSeries.length - 1])
    : 0;
  const chartTitle = useChartTitle(`Drift Direction (Current: ${driftLon.toFixed(2)}°)`, dates);
  const chartMarkers = useVisibleChartMarkers();
  const chartMarkerSize = useStore((state) => state.chartMarkerSize);
  const markerPlacementEnabled = useStore((state) => state.markerPlacementEnabled);
  const addChartMarker = useStore((state) => state.addChartMarker);
  const deleteNearestChartMarker = useStore((state) => state.deleteNearestChartMarker);

  useEffect(() => {
      // Compute IERS XY angle in radians: +x is right, +y is up.
      const driftLonRad = driftAxisTimeSeries.map((drift) => {
        return driftAxisLongitude(drift) * Math.PI / 180;
      });
     
     // Apply numpy-style unwrap to handle 2π phase jumps
     // This iteratively applies corrections until no more 2π jumps remain
     let changed = true;
     while (changed) {
       changed = false;
       for (let i = 1; i < driftLonRad.length; i++) {
         const diff = driftLonRad[i] - driftLonRad[i - 1];
         if (diff > Math.PI) {
           driftLonRad[i] = driftLonRad[i - 1] + (diff - 2 * Math.PI);
           changed = true;
         } else if (diff < -Math.PI) {
           driftLonRad[i] = driftLonRad[i - 1] + (diff + 2 * Math.PI);
           changed = true;
         }
       }
     }
     
     // Convert to degrees in the same IERS XY frame.
     const driftLon = driftLonRad.map(lon => lon * 180 / Math.PI);
     
     setDriftAngles(driftLon);
     
     // Compute e1 and e2 longitudes in the same IERS XY frame.
     const e1LonRadBase = Math.atan2(e1[1], e1[0]);
     const e2LonRadBase = Math.atan2(e2[1], e2[0]);
     const e1Lon = e1LonRadBase * 180 / Math.PI;
     const e2Lon = e2LonRadBase * 180 / Math.PI;
     
     setE1Angles(new Array(dates.length).fill(e1Lon));
     setE2Angles(new Array(dates.length).fill(e2Lon));
   }, [driftAxisTimeSeries, e1, e2, dates.length]);

  useEffect(() => {
    const trace1: Plotly.Data = {
      x: dates,
      y: driftAngles,
      mode: 'lines+markers',
      name: `Drift (window=${windowSize}d)`,
      line: { color: 'red', width: 2 },
      marker: { size: 3 }
    };

    const data: Plotly.Data[] = [trace1];

    if (e1Angles && e1Angles.length > 0) {
      const trace2: Plotly.Data = {
        x: dates,
        y: e1Angles,
        mode: 'lines',
        name: 'e1 (principal)',
        line: { color: 'blue', width: 1, dash: 'dot' }
      };
      data.push(trace2);
    }

    if (e2Angles && e2Angles.length > 0) {
      const trace3: Plotly.Data = {
        x: dates,
        y: e2Angles,
        mode: 'lines',
        name: 'e2 (principal)',
        line: { color: 'green', width: 1, dash: 'dot' }
      };
      data.push(trace3);
    }

    setTraces(data);
  }, [dates, driftAngles, e1Angles, e2Angles, windowSize]);

  const handleRelayout = (event: any) => {
    if (isInternalUpdate.current || !timeLockEnabled) return;
    const range = extractPlotlyDateRange(event);
    if (!range) return;
    isInternalUpdate.current = true;
    setTimeRange(range);
    setTimeout(() => { isInternalUpdate.current = false; }, 0);
  };

  const layout = useMemo(() => ({
    title: chartTitle as any,
    xaxis: { 
      title: { text: 'Date', standoff: 20 },
      gridcolor: '#374151',
      zerolinecolor: '#4b5563'
    },
    yaxis: { 
      title: { text: 'IERS XY angle atan2(y, x) (degrees)', standoff: 20 },
      gridcolor: '#374151',
      zerolinecolor: '#4b5563'
    },
    height: plotHeight,
    showlegend: true,
    legend: {
      orientation: 'h' as const,
      yanchor: 'top' as const,
      y: -0.15,
      xanchor: 'center' as const,
      x: 0.5
    },
    plot_bgcolor: '#111827',
    paper_bgcolor: '#0b1220',
    font: { color: '#e5e7eb' },
    autosize: true
  }), [chartTitle, plotHeight]);

  const layoutWithRange = useMemo(() => {
    const axisRange = timeLockEnabled && timeRange
      ? [new Date(timeRange[0]), new Date(timeRange[1])]
      : dates.length > 0
        ? [new Date(dates[0]), new Date(dates[dates.length - 1])]
      : undefined;
    const markerLayout = buildMarkerLayout(chartMarkers, layout, chartMarkerSize);

    return {
      ...layout,
      ...markerLayout,
      uirevision: axisRange
        ? `${axisRange[0].toISOString()}-${axisRange[1].toISOString()}`
        : 'drift-direction-free-zoom',
      xaxis: {
        ...layout.xaxis,
        range: axisRange
      }
    };
  }, [chartMarkerSize, chartMarkers, dates, layout, timeLockEnabled, timeRange]);

  const handleClick = (event: Readonly<Plotly.PlotMouseEvent>) => {
    if (!markerPlacementEnabled) return;
    const date = getPlotClickDate(event);
    if (date) addChartMarker(date);
  };

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    const range = layoutWithRange.xaxis?.range as Array<Date | string | number> | undefined;
    const date = getContextMenuDate(event, range);
    if (!date) return;
    event.preventDefault();
    deleteNearestChartMarker(date, getMarkerDeleteToleranceDays(range));
  };

  return (
    <div className="h-full w-full min-w-0" onContextMenu={handleContextMenu}>
      <Plot
        data={traces}
        layout={layoutWithRange}
        onRelayout={handleRelayout}
        onClick={handleClick}
        config={createCsvExportConfig('drift-direction.csv', { displayModeBar: true, responsive: true, scrollZoom: true, doubleClick: 'reset+autosize' })}
        style={{ width: '100%', height: `${plotHeight}px` }}
        useResizeHandler
      />
    </div>
  );
}
