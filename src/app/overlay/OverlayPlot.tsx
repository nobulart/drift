'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Plot from 'react-plotly.js';
import { loadEphemerisData } from '@/lib/dataLoader';
import {
  EPHEMERIS_BODY_CONFIG,
  EPHEMERIS_METRIC_CONFIG,
  getEphemerisSignalLabel,
} from '@/lib/ephemeris';
import { extractPlotlyDateRange } from '@/lib/timeRange';
import { EphemerisDataset, EphemerisRecord, LagResult } from '@/lib/types';
import { useTimeStore } from '@/store/timeStore';
import { useStore } from '@/store/useStore';

const CORE_SIGNALS = {
  drift: { label: 'Drift' },
  theta: { label: 'θ (Phase)' },
  omega: { label: 'ω (Angular Velocity)' },
  R: { label: 'R(t)' },
  kp: { label: 'Kp' },
  ap: { label: 'ap' },
} as const;

function normalize(series: number[]): number[] {
  const valid = series.filter(v => Number.isFinite(v));
  if (valid.length === 0) return series;

  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const variance = valid.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / valid.length;
  const std = Math.sqrt(variance);

  return series.map(v => {
    if (!Number.isFinite(v)) return NaN;
    return (v - mean) / (std || 1);
  });
}

function getCoreSignalSeries(key: string, rollingStats: any, data: Array<{ kp?: number | null; ap?: number | null }>): number[] | undefined {
  switch (key) {
    case 'drift':
      return rollingStats.driftAxis?.map((d: [number, number, number]) =>
        (Math.atan2(d[1], d[0]) * 180 / Math.PI) + 90
      );
    case 'theta':
      return rollingStats.theta;
    case 'omega':
      return rollingStats.omega;
    case 'R':
      return rollingStats.rRatio;
    case 'kp':
      return data.map(d => d.kp ?? NaN);
    case 'ap':
      return data.map(d => d.ap ?? NaN);
    default:
      return undefined;
  }
}

function getEphemerisSignalSeries(
  key: string,
  timestamps: string[],
  ephemerisByDate: Record<string, EphemerisRecord['bodies']>
): number[] | undefined {
  const [bodyKey, metricKey] = key.split(':');
  if (!bodyKey || !metricKey) {
    return undefined;
  }

  return timestamps.map(timestamp => {
    const dateKey = timestamp.split('T')[0];
    return ephemerisByDate[dateKey]?.[bodyKey]?.[metricKey as keyof EphemerisRecord['bodies'][string]] ?? NaN;
  });
}

export default function OverlayPage() {
  const [selectedSignals, setSelectedSignals] = useState<string[]>(['drift']);
  const [showTurningPoints, setShowTurningPoints] = useState(false);
  const [lagResult, setLagResult] = useState<LagResult | null>(null);
  const [ephemerisByDate, setEphemerisByDate] = useState<Record<string, EphemerisRecord['bodies']>>({});
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
    let active = true;

    loadEphemerisData()
      .then((dataset: EphemerisDataset) => {
        if (!active || !dataset?.records) {
          return;
        }

        const nextMap = dataset.records.reduce<Record<string, EphemerisRecord['bodies']>>((acc, record) => {
          acc[record.t] = record.bodies;
          return acc;
        }, {});
        setEphemerisByDate(nextMap);
      })
      .catch(error => {
        console.error('Failed to load ephemeris data:', error);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!rollingStats || data.length === 0) {
      setTraces([]);
      return;
    }

    const timestamps = data.map(d => d.t);
    const filteredIndices = (timeLockEnabled && timeRange)
      ? timestamps.map((_, i) => i).filter(i => {
          const t = new Date(timestamps[i]).getTime();
          return t >= timeRange[0] && t <= timeRange[1];
        })
      : timestamps.map((_, i) => i);
    const filteredTime = filteredIndices.map(i => timestamps[i]);

    const nextTraces = selectedSignals.map(signalKey => {
      const raw = signalKey.includes(':')
        ? getEphemerisSignalSeries(signalKey, timestamps, ephemerisByDate)
        : getCoreSignalSeries(signalKey, rollingStats, data);

      if (!raw) {
        return null;
      }

      const filtered = filteredIndices.map(i => raw[i] ?? NaN);
      return {
        x: filteredTime,
        y: normalize(filtered),
        mode: 'lines',
        name: signalKey.includes(':') ? getEphemerisSignalLabel(signalKey) : CORE_SIGNALS[signalKey as keyof typeof CORE_SIGNALS]?.label ?? signalKey,
        line: { width: 2 },
      } as Plotly.Data;
    }).filter(Boolean) as Plotly.Data[];

    if (showTurningPoints && rollingStats.turningPoints?.length) {
      const tpTimes = rollingStats.turningPoints
        .filter(index => filteredIndices.includes(index))
        .map(index => timestamps[index]);

      nextTraces.push({
        x: tpTimes,
        y: tpTimes.map(() => 0),
        mode: 'markers',
        name: 'Turning Points',
        marker: { color: 'red', size: 8 },
      } as Plotly.Data);
    }

    setTraces(nextTraces);
  }, [data, ephemerisByDate, rollingStats, selectedSignals, showTurningPoints, timeLockEnabled, timeRange]);

  const handleRelayout = (event: any) => {
    if (isInternalUpdate.current || !timeLockEnabled) return;
    const range = extractPlotlyDateRange(event);
    if (!range) return;
    isInternalUpdate.current = true;
    setTimeRange(range);
    setTimeout(() => { isInternalUpdate.current = false; }, 0);
  };

  useEffect(() => {
    if (!lagResult) return;

    setLagTraces([
      {
        x: lagResult.lags,
        y: lagResult.signal,
        name: 'Turning Point Response',
        line: { color: 'cyan', width: 2 },
      },
      {
        x: lagResult.lags,
        y: lagResult.baseline,
        name: 'Baseline',
        line: { color: 'gray', dash: 'dot', width: 2 },
      },
    ]);
  }, [lagResult]);

  const overlayLayout = useMemo(() => ({
    template: 'plotly_dark',
    xaxis: {
      title: { text: 'Date', standoff: 20 },
      gridcolor: '#374151',
      zerolinecolor: '#4b5563',
    },
    yaxis: {
      title: { text: 'Normalized Value (z-score)', standoff: 20 },
      gridcolor: '#374151',
      zerolinecolor: '#4b5563',
    },
    legend: {
      orientation: 'h' as const,
      yanchor: 'top' as const,
      y: -0.2,
      xanchor: 'center' as const,
      x: 0.5,
    },
    plot_bgcolor: '#111827',
    paper_bgcolor: '#0b1220',
    font: { color: '#e5e7eb' },
  }), []);

  const lagLayout = useMemo(() => ({
    title: { text: 'Lag Response Function' },
    xaxis: {
      title: { text: 'Lag (days)', standoff: 20 },
      gridcolor: '#374151',
      zerolinecolor: '#4b5563',
    },
    yaxis: {
      title: { text: 'Normalized Response', standoff: 20 },
      gridcolor: '#374151',
      zerolinecolor: '#4b5563',
    },
    legend: {
      orientation: 'h' as const,
      yanchor: 'top' as const,
      y: -0.2,
      xanchor: 'center' as const,
      x: 0.5,
    },
    template: 'plotly_dark',
    plot_bgcolor: '#111827',
    paper_bgcolor: '#0b1220',
    font: { color: '#e5e7eb' },
  }), []);

  const signalOptions = useMemo(() => ([
    ...Object.entries(CORE_SIGNALS).map(([key, config]) => ({ key, label: config.label })),
    ...EPHEMERIS_METRIC_CONFIG.flatMap(metric =>
      EPHEMERIS_BODY_CONFIG.map(body => ({
        key: `${body.key}:${metric.key}`,
        label: `${body.label} ${metric.shortLabel}`,
      }))
    ),
  ]), []);

  return (
    <div className="p-6 bg-[#0b1220] min-h-screen">
      <h2 className="text-2xl font-bold mb-6 text-[#e5e7eb]">Overlay Analysis</h2>

      <div className="mb-6 flex flex-wrap gap-4 items-start">
        <div>
          <label className="text-sm text-[#9ca3af] mr-2">Signals:</label>
          <select
            multiple
            value={selectedSignals}
            onChange={(e) => setSelectedSignals(Array.from(e.target.selectedOptions, option => option.value))}
            className="min-h-48 bg-[#1f2937] text-[#e5e7eb] rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
          >
            {signalOptions.map(option => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="max-w-md rounded-lg border border-[#1f2937] bg-[#111827] px-4 py-3">
          <p className="text-sm font-medium text-[#e5e7eb]">DE442 dataset</p>
          <p className="mt-1 text-sm text-[#9ca3af]">Geocentric overlays include distance, angular velocity, radial velocity, ecliptic longitude, and a heuristic torque proxy for each major body.</p>
          <p className="mt-2 text-xs text-[#6b7280]">Torque proxy = mass / r^3 * angular speed. Useful for correlation hunting, not a closed-form physical torque.</p>
        </div>

        <label className="flex items-center gap-2 cursor-pointer pt-2">
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
          layout={overlayLayout as any}
          config={{ displayModeBar: true, responsive: true, scrollZoom: true, doubleClick: 'reset+autosize' }}
          style={{ width: '100%', height: '500px' }}
          useResizeHandler
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
            layout={lagLayout as any}
            config={{ displayModeBar: true, responsive: true }}
            style={{ width: '100%', height: '400px' }}
            useResizeHandler
          />
          <p className="mt-4 text-sm text-[#9ca3af]">
            <span className="text-cyan-400">Signal</span> above <span className="text-gray-400">baseline</span> indicates Turning Point → delayed system response
          </p>
        </div>
      )}
    </div>
  );
}
