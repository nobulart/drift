'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import Plot from 'react-plotly.js';
import { useTimeStore } from '@/store/timeStore';
import { useStore } from '@/store/useStore';
import { extractPlotlyDateRange } from '@/lib/timeRange';

interface SignalConfig {
  label: string;
  key: string;
}

const SIGNALS: Record<string, SignalConfig> = {
  drift: { label: 'Drift', key: 'lon' },
  alignment: { label: 'Alignment', key: 'alignment' },
  theta: { label: 'θ (Phase)', key: 'theta' },
  omega: { label: 'ω (Angular Velocity)', key: 'omega' },
  R: { label: 'R(t)', key: 'rRatio' },
  kp: { label: 'Kp', key: 'kp' },
  ap: { label: 'ap', key: 'ap' }
};

function normalize(series: number[]): number[] {
  const valid = series.filter(v => !isNaN(v) && v !== null);
  if (valid.length === 0) return series;
  
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const variance = valid.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / valid.length;
  const std = Math.sqrt(variance);
  
  return series.map(v => {
    if (isNaN(v!) || v === null) return NaN;
    return (v! - mean) / (std || 1);
  });
}

export default function OverlayPlot() {
  const [selectedSignals, setSelectedSignals] = useState<string[]>(['drift', 'alignment']);
  const isInternalUpdate = useRef(false);
  
  const { timeRange, timeLockEnabled, setTimeRange } = useTimeStore();
  const rollingStats = useStore(state => state.rollingStats);
  const data = useStore(state => state.data);
  const [traces, setTraces] = useState<Plotly.Data[]>([]);

  useEffect(() => {
    if (!rollingStats || data.length === 0) {
      setTraces([]);
      return;
    }

    const time = data.map(d => d.t);

    let filteredIndices: number[];
    if (timeLockEnabled && timeRange) {
      filteredIndices = time.map((_, i) => i).filter(i => {
        const t = new Date(time[i]).getTime();
        return t >= timeRange[0] && t <= timeRange[1];
      });
    } else {
      filteredIndices = time.map((_, i) => i);
    }

    const filteredTime = filteredIndices.map(i => time[i]);

    const newTraces = selectedSignals.map((key, i) => {
      let raw: number[] | undefined;

      switch (key) {
        case 'drift':
          raw = rollingStats.driftAxis?.map(d =>
            (Math.atan2(d[1], d[0]) * 180 / Math.PI) + 90
          );
          break;
        case 'alignment':
          raw = rollingStats.alignment;
          break;
        case 'theta':
          raw = rollingStats.theta;
          break;
        case 'omega':
          raw = rollingStats.omega;
          break;
        case 'R':
          raw = rollingStats.rRatio;
          break;
        case 'kp':
          raw = data.map(d => d.kp).filter((k): k is number => k !== null);
          break;
        case 'ap':
          raw = data.map(d => d.ap).filter((a): a is number => a !== null);
          break;
      }

      if (!raw) return null;

      const filtered = filteredIndices.map(i => raw![i]);
      const norm = normalize(filtered);

      return {
        x: filteredTime,
        y: norm,
        mode: 'lines',
        name: SIGNALS[key as keyof typeof SIGNALS].label,
        line: { width: 2 }
      } as any;
    }).filter(Boolean);

    setTraces(newTraces);
  }, [selectedSignals, rollingStats, data, timeRange, timeLockEnabled]);

  const handleRelayout = (event: any) => {
    if (isInternalUpdate.current || !timeLockEnabled) return;
    const range = extractPlotlyDateRange(event);
    if (!range) return;
    isInternalUpdate.current = true;
    setTimeRange(range);
    setTimeout(() => { isInternalUpdate.current = false; }, 0);
  };

  const overlayLayout = useMemo(() => ({
    template: 'plotly_dark',
    xaxis: { 
      title: { text: 'Date', standoff: 20 },
      gridcolor: '#374151',
      zerolinecolor: '#4b5563'
    },
    yaxis: { 
      title: { text: 'Normalized Value (z-score)', standoff: 20 },
      gridcolor: '#374151',
      zerolinecolor: '#4b5563'
    },
    legend: { 
      orientation: 'h' as const,
      yanchor: 'top' as const,
      y: -0.2,
      xanchor: 'center' as const,
      x: 0.5
    },
    margin: { l: 60, r: 20, t: 40, b: 60 },
    plot_bgcolor: '#111827',
    paper_bgcolor: '#0b1220',
    font: { color: '#e5e7eb' },
    height: 500,
    autosize: true
  }), []);

  return (
    <div className="p-4 bg-[#0b1220] h-full w-full min-w-0">
      <div className="flex flex-wrap gap-4 items-center mb-4">
        {(Object.keys(SIGNALS) as Array<keyof typeof SIGNALS>).map(key => (
          <label key={key} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={selectedSignals.includes(key)}
              onChange={() => {
                if (selectedSignals.includes(key)) {
                  setSelectedSignals(prev => prev.filter(s => s !== key));
                } else {
                  setSelectedSignals(prev => [...prev, key]);
                }
              }}
              className="w-4 h-4 rounded border-gray-600 text-[#3b82f6] focus:ring-[#3b82f6]"
            />
            <span className="text-sm text-[#e5e7eb]">{SIGNALS[key].label}</span>
          </label>
        ))}
      </div>
      <div className="w-full min-w-0">
        <Plot
          data={traces}
          layout={{
            ...overlayLayout,
            uirevision: timeLockEnabled && timeRange
              ? `${new Date(timeRange[0]).toISOString()}-${new Date(timeRange[1]).toISOString()}`
              : 'overlay-free-zoom'
          } as any}
          config={{ displayModeBar: true, responsive: true, scrollZoom: true, doubleClick: 'reset+autosize' }}
          style={{ width: '100%', height: '500px' }}
          useResizeHandler
          onRelayout={handleRelayout}
        />
      </div>
    </div>
  );
}
