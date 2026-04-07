"use client";

import { useEffect, useState, useRef, useMemo } from 'react';
import Plot from 'react-plotly.js';
import { useTimeStore } from '@/store/timeStore';
import { unwrap } from '@/lib/math';
import { extractPlotlyDateRange } from '@/lib/timeRange';

interface AngleDiagnosticsProps {
  dates: string[];
  theta3: number[];
  theta12: number[];
}

function smoothAndUnwrap(angle: number[]): number[] {
  const angleRad = angle.map(a => a * Math.PI / 180);
  
  const unwrappedRad = unwrap(angleRad);
  
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

  useEffect(() => {
    setSmoothedTheta3(smoothAndUnwrap(theta3));
    setSmoothedTheta12(smoothAndUnwrap(theta12));
  }, [theta3, theta12]);

  const traces = useMemo<Plotly.Data[]>(() => {
    return [{
      x: dates,
      y: smoothedTheta3,
      mode: 'lines+markers',
      name: 'θ3 (angle to e3)',
      line: { color: 'purple', width: 2 },
      marker: { size: 3 }
    }, {
      x: dates,
      y: smoothedTheta12,
      mode: 'lines+markers',
      name: 'θ12 (in-plane alignment)',
      line: { color: 'orange', width: 2 },
      marker: { size: 3 }
    }];
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
    height: 500,
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
  }), []);

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
      <Plot
        data={traces}
        layout={layoutWithRange}
        onRelayout={handleRelayout}
        config={{ displayModeBar: true, responsive: true, scrollZoom: true, doubleClick: 'reset+autosize' }}
        style={{ width: '100%', height: '500px' }}
        useResizeHandler
      />
    </div>
  );
}
