"use client";

import { useEffect, useState, useMemo, useRef } from 'react';
import type { MouseEvent } from 'react';
import Plot from 'react-plotly.js';
import { useTimeStore } from '@/store/timeStore';
import { extractPlotlyDateRange } from '@/lib/timeRange';
import { usePlotDisplayHeight } from '@/components/usePlotDisplayHeight';
import { createCsvExportConfig } from '@/lib/plotlyCsvExport';
import { useChartTitle } from '@/lib/chartTitles';
import { useStore } from '@/store/useStore';
import { buildMarkerLayout, getContextMenuDate, getMarkerDeleteToleranceDays, getPlotClickDate } from '@/lib/chartMarkers';

interface PolarPlotProps {
  xpData: number[];
  ypData: number[];
  dates?: string[];
  rollingStats?: {
    turningPoints?: number[];
  } | null;
}

export default function PolarPlot({
  xpData,
  ypData,
  dates = [],
  rollingStats
}: PolarPlotProps) {
  const { timeRange, timeLockEnabled, setTimeRange } = useTimeStore();
  const isInternalUpdate = useRef(false);
  const [traces, setTraces] = useState<Plotly.Data[]>([]);
  const plotHeight = usePlotDisplayHeight(500, 860);
  const chartTitle = useChartTitle('Polar Motion (xp, yp)', dates);
  const chartMarkers = useStore((state) => state.chartMarkers);
  const markerPlacementEnabled = useStore((state) => state.markerPlacementEnabled);
  const addChartMarker = useStore((state) => state.addChartMarker);
  const deleteNearestChartMarker = useStore((state) => state.deleteNearestChartMarker);

  const turningPoints = useMemo(() => rollingStats?.turningPoints || [], [rollingStats]);

  useEffect(() => {
    const mask = timeLockEnabled && timeRange
      ? dates.map((_, i) => {
          if (!dates[i]) return false;
          const ts = new Date(dates[i]).getTime();
          return ts >= timeRange[0] && ts <= timeRange[1];
        })
      : new Array(dates.length).fill(true);

    const filteredXp = xpData.filter((_, i) => mask[i]);
    const filteredYp = ypData.filter((_, i) => mask[i]);
    const filteredDates = dates.filter((_, i) => mask[i]);

    const ghostXp = xpData.filter((_, i) => !mask[i]);
    const ghostYp = ypData.filter((_, i) => !mask[i]);
    const ghostDates = dates.filter((_, i) => !mask[i]);

    const xpTrace: Plotly.Data = {
      x: filteredDates,
      y: filteredXp,
      mode: 'lines+markers',
      type: 'scatter',
      name: 'xp (mas)',
      yaxis: 'y1',
      line: { color: '#3b82f6', width: 2 },
      marker: { size: 3, color: '#3b82f6' }
    };

    const ypTrace: Plotly.Data = {
      x: filteredDates,
      y: filteredYp,
      mode: 'lines+markers',
      type: 'scatter',
      name: 'yp (mas)',
      yaxis: 'y2',
      line: { color: '#ef4444', width: 2 },
      marker: { size: 3, color: '#ef4444' }
    };

    const data: Plotly.Data[] = [xpTrace, ypTrace];

    if (turningPoints.length > 0 && dates.length > 0) {
      const turningDates = turningPoints.map(i => dates[i]);

      const turningXp = turningPoints.map(i => xpData[i]);
      const turningXpTrace: Plotly.Data = {
        x: turningDates,
        y: turningXp,
        mode: 'markers',
        type: 'scatter',
        name: 'Turning Points (xp)',
        yaxis: 'y1',
        marker: { color: '#22c55e', size: 8, symbol: 'x' }
      };
      data.push(turningXpTrace);

      const turningYp = turningPoints.map(i => ypData[i]);
      const turningYpTrace: Plotly.Data = {
        x: turningDates,
        y: turningYp,
        mode: 'markers',
        type: 'scatter',
        name: 'Turning Points (yp)',
        yaxis: 'y2',
        marker: { color: '#22c55e', size: 8, symbol: 'x' }
      };
      data.push(turningYpTrace);
    }

    setTraces(data);
  }, [xpData, ypData, dates, turningPoints, timeLockEnabled, timeRange]);

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
      title: { text: 'xp (mas)', standoff: 20 },
      titlefont: { color: '#3b82f6' },
      tickfont: { color: '#3b82f6' },
      gridcolor: '#374151',
      zerolinecolor: '#4b5563'
    },
    yaxis2: {
      title: { text: 'yp (mas)', standoff: 20 },
      titlefont: { color: '#ef4444' },
      tickfont: { color: '#ef4444' },
      gridcolor: '#374151',
      zerolinecolor: '#4b5563',
      overlaying: 'y',
      side: 'right' as const
    },
    height: plotHeight,
    margin: { l: 80, r: 80, t: 60, b: 80 },
    showlegend: true,
    legend: {
      orientation: 'h',
      yanchor: 'top',
      y: -0.2,
      xanchor: 'center',
      x: 0.5
    },
    hovermode: 'closest',
    plot_bgcolor: '#111827',
    paper_bgcolor: '#0b1220',
    font: { color: '#e5e7eb' },
    autosize: true
  } as any), [chartTitle, plotHeight]);

  const layoutWithRange = useMemo(() => {
    const axisRange = timeLockEnabled && timeRange
      ? [new Date(timeRange[0]), new Date(timeRange[1])]
      : dates.length > 0
        ? [new Date(dates[0]), new Date(dates[dates.length - 1])]
      : undefined;
    const markerLayout = buildMarkerLayout(chartMarkers, layout);

    return {
      ...layout,
      ...markerLayout,
      uirevision: axisRange
        ? `${axisRange[0].toISOString()}-${axisRange[1].toISOString()}`
        : 'polar-free-zoom',
      xaxis: {
        ...layout.xaxis,
        range: axisRange
      }
    };
  }, [chartMarkers, dates, layout, timeLockEnabled, timeRange]);

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
        config={createCsvExportConfig('polar-motion.csv', { displayModeBar: true, responsive: true, scrollZoom: true, doubleClick: 'reset+autosize' })}
        style={{ width: '100%', height: `${plotHeight}px` }}
        useResizeHandler
      />
    </div>
  );
}
