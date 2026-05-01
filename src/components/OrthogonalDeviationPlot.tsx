"use client";

import { useEffect, useState, useRef, useMemo } from 'react';
import Plot from 'react-plotly.js';
import { useTimeStore } from '@/store/timeStore';
import { extractPlotlyDateRange } from '@/lib/timeRange';
import { usePlotDisplayHeight } from '@/components/usePlotDisplayHeight';
import { createCsvExportConfig } from '@/lib/plotlyCsvExport';

interface OrthogonalDeviationPlotProps {
  dates: string[];
  rRatio: number[];
  turningPoints?: number[];
  windowSize?: number;
}

function savgol_filter(data: number[], windowSize: number, polyOrder: number): number[] {
  if (data.length < windowSize) return data;
  
  const halfWindow = Math.floor(windowSize / 2);
  const result = new Array(data.length).fill(0);
  
  for (let i = halfWindow; i < data.length - halfWindow; i++) {
    let sumY = 0;
    let sumX = 0;
    let sumX2 = 0;
    let sumX3 = 0;
    let sumX4 = 0;
    let sumXY = 0;
    let sumX2Y = 0;
    
    for (let j = -halfWindow; j <= halfWindow; j++) {
      const x = j;
      const y = data[i + j];
      const x2 = x * x;
      const x3 = x2 * x;
      const x4 = x2 * x2;
      
      sumY += y;
      sumX += x;
      sumX2 += x2;
      sumX3 += x3;
      sumX4 += x4;
      sumXY += x * y;
      sumX2Y += x2 * y;
    }
    
    const n = 2 * halfWindow + 1;
    const det = n * sumX2 * sumX4 + 2 * sumX * sumX2 * sumX3 - n * sumX3 * sumX3
      - sumX * sumX * sumX4 - sumX2 * sumX2 * sumX2;
    
    if (Math.abs(det) < 1e-10) {
      result[i] = data[i];
    } else {
      const a0 = (sumY * sumX2 * sumX4 + sumX * sumX3 * sumXY + sumX2 * sumX * sumX2Y
        - sumY * sumX3 * sumX3 - sumX * sumX2 * sumX2Y - sumX2 * sumX * sumXY) / det;
      const a1 = (n * sumX3 * sumXY + sumX * sumX2 * sumX2Y + sumX2 * sumY * sumX3
        - n * sumX2 * sumX2Y - sumX * sumY * sumX4 - sumX2 * sumX3 * sumXY) / det;
      
      result[i] = a0 + a1 * 0;
    }
  }
  
  for (let i = 0; i < halfWindow; i++) result[i] = result[halfWindow];
  for (let i = data.length - halfWindow; i < data.length; i++) result[i] = result[data.length - halfWindow - 1];
  
  return result;
}

export default function OrthogonalDeviationPlot({
  dates,
  rRatio,
  turningPoints = [],
  windowSize = 365
}: OrthogonalDeviationPlotProps) {
  const { timeRange, timeLockEnabled, setTimeRange } = useTimeStore();
  const isInternalUpdate = useRef(false);
  const [traces, setTraces] = useState<Plotly.Data[]>([]);
  const [rollingMean, setRollingMean] = useState<number[]>([]);
  const plotHeight = usePlotDisplayHeight(500, 860);

  useEffect(() => {
    if (rRatio.length === 0) {
      setTraces([]);
      return;
    }

    const window = Math.min(windowSize, rRatio.length);
    const mean: number[] = [];
    
    for (let i = 0; i < rRatio.length; i++) {
      const start = Math.max(0, i - window + 1);
      const slice = rRatio.slice(start, i + 1);
      mean.push(slice.reduce((a, b) => a + b, 0) / slice.length);
    }
    
    setRollingMean(mean);
  }, [rRatio, windowSize]);

  useEffect(() => {
    if (rRatio.length === 0) {
      setTraces([]);
      return;
    }

    // Apply savgol smoothing with proper window size
    const window = Math.min(windowSize, rRatio.length);
    const smoothed = savgol_filter(rRatio, Math.min(21, window), 3);
    
    // Clamp ratio to [0, 1]
    const rRatioClamped = rRatio.map((v) => Math.max(0, Math.min(1, v)));
    const smoothedClamped = smoothed.map((v) => Math.max(0, Math.min(1, v)));

    const rTrace: Plotly.Data = {
      x: dates,
      y: rRatioClamped,
      mode: 'markers',
      type: 'scatter',
      name: 'R(t) - Raw',
      marker: { size: 3, color: 'rgba(107, 114, 128, 0.5)' }
    };

    const smoothedTrace: Plotly.Data = {
      x: dates,
      y: smoothedClamped,
      mode: 'lines',
      type: 'scatter',
      name: 'R(t) - Smoothed',
      line: { color: '#3b82f6', width: 1.5 }
    };

    const mean = smoothedClamped.reduce((a: number, b: number) => a + b, 0) / smoothedClamped.length;
    const meanTrace: Plotly.Data = {
      x: dates,
      y: Array(dates.length).fill(mean),
      mode: 'lines',
      type: 'scatter',
      name: 'Mean',
      line: { color: '#9ca3af', width: 1, dash: 'dash' }
    };

    const data: Plotly.Data[] = [rTrace, smoothedTrace, meanTrace];

    if (turningPoints.length > 0) {
      const turningDates = turningPoints.map(i => dates[i]);
      const turningR = turningPoints.map(i => smoothedClamped[i]);

      const turningTrace: Plotly.Data = {
        x: turningDates,
        y: turningR,
        mode: 'markers',
        type: 'scatter',
        name: 'Turning Points',
        marker: { color: '#ef4444', size: 8, symbol: 'triangle-up' }
      };
      data.push(turningTrace);
    }

    setTraces(data);
  }, [dates, rRatio, turningPoints, windowSize]);

  const handleRelayout = (event: any) => {
    if (isInternalUpdate.current || !timeLockEnabled) return;
    const range = extractPlotlyDateRange(event);
    if (!range) return;
    isInternalUpdate.current = true;
    setTimeRange(range);
    setTimeout(() => { isInternalUpdate.current = false; }, 0);
  };

  const layout = useMemo(() => ({
    title: { text: 'R(t): Orthogonal Deviation Ratio' } as any,
    xaxis: { 
      title: { text: 'Date', standoff: 20 },
      gridcolor: '#374151'
    },
    yaxis: { 
      title: { text: 'R = min(λ)/max(λ)', standoff: 20 },
      range: [0, 1],
      gridcolor: '#374151'
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
    hovermode: 'closest' as const,
    plot_bgcolor: '#111827',
    paper_bgcolor: '#0b1220',
    font: { color: '#e5e7eb' },
    autosize: true
  }), [plotHeight]);

  const axisRange = timeLockEnabled && timeRange
    ? [new Date(timeRange[0]), new Date(timeRange[1])]
    : undefined;

  const layoutWithRange = {
    ...layout,
    uirevision: axisRange
      ? `${axisRange[0].toISOString()}-${axisRange[1].toISOString()}`
      : 'ortho-free-zoom',
    xaxis: {
      ...layout.xaxis,
      range: axisRange
    }
  };

  if (traces.length === 0) {
    return (
      <div className="flex items-center justify-center h-full w-full bg-[#111827] rounded-lg border border-[#374151]">
        <p className="text-[#9ca3af]">Loading...</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full min-w-0">
      <Plot
        data={traces}
        layout={layoutWithRange}
        onRelayout={handleRelayout}
        config={createCsvExportConfig('orthogonal-deviation.csv', { displayModeBar: true, responsive: true, scrollZoom: true, doubleClick: 'reset+autosize' })}
        style={{ width: '100%', height: `${plotHeight}px` }}
        useResizeHandler
      />
    </div>
  );
}
