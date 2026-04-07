'use client';

import { useEffect, useRef, useState } from 'react';
import Plot from 'react-plotly.js';
import { useTimeStore } from '@/store/timeStore';
import { useStore } from '@/store/useStore';
import { LagResult } from '@/lib/types';

const SIGNALS = {
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

export default function OverlayPage() {
  const [selectedSignals, setSelectedSignals] = useState<string[]>(['drift', 'alignment']);
  const [showTurningPoints, setShowTurningPoints] = useState(false);
  const [lagResult, setLagResult] = useState<LagResult | null>(null);
  const isInternalUpdate = useRef(false);
  
  const { timeRange, timeLockEnabled, setTimeRange } = useTimeStore();
  const rollingStats = useStore(state => state.rollingStats);
  const data = useStore(state => state.data);
  const [traces, setTraces] = useState<Plotly.Data[]>([]);
  const [lagTraces, setLagTraces] = useState<Plotly.Data[]>([]);

  useEffect(() => {
    if (rollingStats?.lagModel) {
      setLagResult(rollingStats.lagModel);
    }
  }, [rollingStats]);

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

    if (showTurningPoints && rollingStats.turningPoints?.length) {
      const tpFiltered = rollingStats.turningPoints.filter(
        tp => filteredIndices.includes(tp)
      );
      const tpTimes = tpFiltered.map(i => filteredTime[i]);

      newTraces.push({
        x: tpTimes,
        y: tpTimes.map(() => 0),
        mode: 'markers',
        name: 'Turning Points',
        marker: { color: 'red', size: 8 }
      } as any);
    }

    setTraces(newTraces);
  }, [selectedSignals, rollingStats, data, timeRange, timeLockEnabled, showTurningPoints]);

  const handleRelayout = (event: any) => {
    if (!timeLockEnabled || isInternalUpdate.current) return;

    if (event['xaxis.range[0]'] && event['xaxis.range[1]']) {
      isInternalUpdate.current = true;
      const t0 = new Date(event['xaxis.range[0]']).getTime();
      const t1 = new Date(event['xaxis.range[1]']).getTime();
      setTimeRange([t0, t1]);
      setTimeout(() => { isInternalUpdate.current = false; }, 0);
    }
  };

  useEffect(() => {
    if (!lagResult) return;

    setLagTraces([
      {
        x: lagResult.lags,
        y: lagResult.signal,
        name: 'Turning Point Response',
        line: { color: 'cyan', width: 2 }
      },
      {
        x: lagResult.lags,
        y: lagResult.baseline,
        name: 'Baseline',
        line: { color: 'gray', dash: 'dot', width: 2 }
      }
    ]);
  }, [lagResult]);

  const overlayLayout: any = {
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
      yanchor: 'top',
      y: -0.2,
      xanchor: 'center',
      x: 0.5
    },
    plot_bgcolor: '#111827',
    paper_bgcolor: '#0b1220',
    font: { color: '#e5e7eb' }
  };

  const lagLayout: any = {
    title: { text: 'Lag Response Function' },
    xaxis: { 
      title: { text: 'Lag (days)', standoff: 20 },
      gridcolor: '#374151',
      zerolinecolor: '#4b5563'
    },
    yaxis: { 
      title: { text: 'Normalized Response', standoff: 20 },
      gridcolor: '#374151',
      zerolinecolor: '#4b5563'
    },
    legend: {
      orientation: 'h',
      yanchor: 'top',
      y: -0.2,
      xanchor: 'center',
      x: 0.5
    },
    template: 'plotly_dark',
    plot_bgcolor: '#111827',
    paper_bgcolor: '#0b1220',
    font: { color: '#e5e7eb' }
  };

  return (
    <div className="p-6 bg-[#0b1220] min-h-screen">
      <h2 className="text-2xl font-bold mb-6 text-[#e5e7eb]">Overlay Analysis</h2>

      <div className="mb-6 flex flex-wrap gap-4 items-center">
        <div>
          <label className="text-sm text-[#9ca3af] mr-2">Signals:</label>
          <select
            multiple
            value={selectedSignals}
            onChange={(e) => setSelectedSignals(
              Array.from(e.target.selectedOptions, o => o.value)
            )}
            className="bg-[#1f2937] text-[#e5e7eb] rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
          >
            {(Object.keys(SIGNALS) as Array<keyof typeof SIGNALS>).map(key => (
              <option key={key} value={key}>
                {SIGNALS[key].label}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showTurningPoints}
            onChange={(e) => setShowTurningPoints(e.target.checked)}
            className="w-4 h-4 rounded border-gray-600 text-[#3b82f6] focus:ring-[#3b82f6]"
          />
          <span className="text-sm text-[#e5e7eb]">Show Turning Points</span>
        </label>
      </div>

      <div className="mb-8">
        <Plot
          data={traces}
          layout={overlayLayout}
          config={{ displayModeBar: true }}
          style={{ width: '100%', height: '500px' }}
          onRelayout={handleRelayout}
        />
      </div>

      {lagResult && lagResult.lags.length > 0 && (
        <div>
          <h3 className="text-xl font-semibold mb-4 text-[#e5e7eb]">
            Turning Point → Response Lag
          </h3>
          <Plot
            data={lagTraces}
            layout={lagLayout}
            config={{ displayModeBar: true }}
            style={{ width: '100%', height: '400px' }}
          />
          <p className="mt-4 text-sm text-[#9ca3af]">
            <span className="text-cyan-400">Signal</span> above <span className="text-gray-400">baseline</span> indicates Turning Point → delayed system response
          </p>
        </div>
      )}
    </div>
  );
}
