"use client";

import { useEffect, useState, useRef, useMemo } from 'react';
import Plot from 'react-plotly.js';
import { useTimeStore } from '@/store/timeStore';
import { unwrap } from '@/lib/math';
import { extractPlotlyDateRange } from '@/lib/timeRange';
import { usePlotDisplayHeight } from '@/components/usePlotDisplayHeight';

interface AngleDiagnosticsProps {
  dates: string[];
  theta3: number[];
  theta12: number[];
}

function hasMeaningfulVariation(values: number[]): boolean {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) {
    return false;
  }

  const min = Math.min(...finite);
  const max = Math.max(...finite);
  return Math.abs(max - min) > 1e-3;
}

function unwrapContinuous(angle: number[]): number[] {
  const unwrapped = [...angle];
  let changed = true;

  while (changed) {
    changed = false;
    for (let i = 1; i < unwrapped.length; i++) {
      const diff = unwrapped[i] - unwrapped[i - 1];
      if (diff > Math.PI) {
        unwrapped[i] = unwrapped[i - 1] + (diff - 2 * Math.PI);
        changed = true;
      } else if (diff < -Math.PI) {
        unwrapped[i] = unwrapped[i - 1] + (diff + 2 * Math.PI);
        changed = true;
      }
    }
  }

  return unwrapped;
}

function smoothAndUnwrap(angle: number[]): number[] {
  const unwrappedRad = unwrapContinuous(angle);
  const unwrapped = unwrappedRad.map(r => r * 180 / Math.PI);
  
  const windowSize = 31;
  const halfWindow = Math.floor(windowSize / 2);
  
  const smoothed: number[] = [];
  
  for (let i = 0; i < unwrapped.length; i++) {
    const start = Math.max(0, i - halfWindow);
    const end = Math.min(unwrapped.length, i + halfWindow + 1);
    const window = unwrapped.slice(start, end);
    
    if (window.length > 0) {
      const validWindow = window.filter(v => !isNaN(v));
      if (validWindow.length > 0) {
        const avg = validWindow.reduce((a, b) => a + b, 0) / validWindow.length;
        smoothed.push(avg);
      } else {
        smoothed.push(NaN);
      }
    } else {
      smoothed.push(unwrapped[i]);
    }
  }
  
  return smoothed;
}

export default function AngleDiagnostics({ dates, theta3, theta12 }: AngleDiagnosticsProps) {
  const { timeRange, timeLockEnabled, setTimeRange } = useTimeStore();
  const isInternalUpdate = useRef(false);
  const [smoothedTheta3, setSmoothedTheta3] = useState<number[]>([]);
  const [smoothedTheta12, setSmoothedTheta12] = useState<number[]>([]);
  const plotHeight = usePlotDisplayHeight(500, 860);

  useEffect(() => {
    setSmoothedTheta3(smoothAndUnwrap(theta3));
    setSmoothedTheta12(smoothAndUnwrap(theta12));
  }, [theta3, theta12]);

  const traces = useMemo<Plotly.Data[]>(() => {
    const data: Plotly.Data[] = [];

    if (hasMeaningfulVariation(smoothedTheta3)) {
      data.push({
        x: dates,
        y: smoothedTheta3,
        mode: 'lines+markers',
        name: 'θ3 (angle to e3)',
        line: { color: 'purple', width: 2 },
        marker: { size: 3 }
      });
    }

    const finiteTheta12 = smoothedTheta12.filter((value) => Number.isFinite(value));
    if (finiteTheta12.length > 0) {
      data.push({
        x: dates,
        y: smoothedTheta12,
        mode: 'lines+markers',
        name: 'θ12 (in-plane alignment)',
        line: { color: 'orange', width: 2 },
        marker: { size: 3 }
      });
    }

    return data;
  }, [dates, smoothedTheta3, smoothedTheta12]);

  const handleRelayout = (event: any) => {
    if (isInternalUpdate.current || !timeLockEnabled) return;
    const range = extractPlotlyDateRange(event);
    if (!range) return;
    isInternalUpdate.current = true;
    setTimeRange(range);
    setTimeout(() => { isInternalUpdate.current = false; }, 0);
  };

  const layout = useMemo(() => ({
    title: { text: 'Angle Diagnostics' } as any,
    xaxis: { 
      title: { text: 'Date', standoff: 20 },
      gridcolor: '#374151',
      zerolinecolor: '#4b5563'
    },
    yaxis: { 
      title: { text: 'Angle (degrees)', standoff: 20 },
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
  }), [plotHeight]);

  const layoutWithRange = useMemo(() => {
    const axisRange = timeLockEnabled && timeRange
      ? [new Date(timeRange[0]).toISOString(), new Date(timeRange[1]).toISOString()]
      : undefined;

    return {
      ...layout,
      uirevision: axisRange ? `${axisRange[0]}-${axisRange[1]}` : 'angle-diagnostics-free',
      xaxis: {
        ...layout.xaxis,
        range: axisRange
      }
    };
  }, [layout, timeLockEnabled, timeRange]);

  return (
    <div className="h-full w-full min-w-0">
      {traces.length === 0 ? (
        <div className="flex items-center justify-center h-full w-full bg-[#111827] rounded-lg border border-[#374151]">
          <p className="text-[#9ca3af]">No angle diagnostics available from the current real-data series.</p>
        </div>
      ) : (
        <Plot
          data={traces}
          layout={layoutWithRange}
          onRelayout={handleRelayout}
          config={{ displayModeBar: true, responsive: true, scrollZoom: true, doubleClick: 'reset+autosize' }}
          style={{ width: '100%', height: `${plotHeight}px` }}
          useResizeHandler
        />
      )}
    </div>
  );
}
