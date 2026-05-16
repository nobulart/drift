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
import { buildSelectedSeriesCsvRows, createCsvExportConfig, plotlyXRange, WideCsvSeries } from '@/lib/plotlyCsvExport';
import { useTimeStore } from '@/store/timeStore';
import { useStore } from '@/store/useStore';
import { useChartTitle } from '@/lib/chartTitles';
import {
  DEFAULT_PHASE_ESCAPE_MODELS,
  PhaseEscapeCompositeKey,
  computePhaseDrift,
  energyBarrierRatio,
  escapeEnergyBarrier,
  phaseTotalEnergy,
  radiansToDegrees,
  smoothExp,
} from '@/lib/phaseEscapeModel';
import { computeQDriftProxy } from '@/lib/matsuyamaProxy';

const CORE_SIGNALS = {
  xp: { label: 'xp' },
  yp: { label: 'yp' },
  ut1_utc: { label: 'UT1-UTC' },
  lod: { label: 'LOD' },
  drift: { label: 'Drift' },
  theta: { label: 'θ (Phase)' },
  omega: { label: 'ω (Angular Velocity)' },
  R: { label: 'R(t)' },
  kp: { label: 'Kp' },
  ap: { label: 'ap' },
  qDriftProxy: { label: 'DRIFT proxy Q' },
} as const;

interface PhaseEscapeRecord {
  t: string;
  misalignment: Record<PhaseEscapeCompositeKey, number | null>;
}

interface PhaseEscapeDataset {
  records: PhaseEscapeRecord[];
}

const MATSUYAMA_COMPOSITE: PhaseEscapeCompositeKey = 'Venus_Mars';

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

function getCoreSignalSeries(
  key: string,
  rollingStats: any,
  data: Array<{ t: string; xp?: number | null; yp?: number | null; ut1_utc?: number | null; lod?: number | null; kp?: number | null; ap?: number | null }>,
  matsuyamaProxyByDate: Record<string, number | null>
): number[] | undefined {
  switch (key) {
    case 'xp':
      return data.map(d => d.xp ?? NaN);
    case 'yp':
      return data.map(d => d.yp ?? NaN);
    case 'ut1_utc':
      return data.map(d => d.ut1_utc ?? NaN);
    case 'lod':
      return data.map(d => d.lod ?? NaN);
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
    case 'qDriftProxy':
      return data.map(d => matsuyamaProxyByDate[d.t.slice(0, 10)] ?? NaN);
    default:
      return undefined;
  }
}

function buildMatsuyamaProxyByDate(records: PhaseEscapeRecord[]): Record<string, number | null> {
  const model = DEFAULT_PHASE_ESCAPE_MODELS[MATSUYAMA_COMPOSITE];
  const phiSeriesDeg = records.map(record => {
    const phi = record.misalignment?.[MATSUYAMA_COMPOSITE];
    return typeof phi === 'number' && Number.isFinite(phi) ? radiansToDegrees(phi) : NaN;
  });
  const phiSmoothDeg = smoothExp(phiSeriesDeg, 0.25);
  const timeSeriesMs = records.map(record => new Date(record.t).getTime());
  const phaseDriftSeries = computePhaseDrift(phiSmoothDeg, timeSeriesMs);
  const barrier = escapeEnergyBarrier(model.alpha);

  return records.reduce<Record<string, number | null>>((acc, record, index) => {
    const phiDeg = phiSeriesDeg[index];
    const totalPhaseEnergy = phaseTotalEnergy(phiDeg, model.phi0Deg, phaseDriftSeries[index], model.alpha);
    const barrierRatio = energyBarrierRatio(totalPhaseEnergy, barrier);
    acc[record.t.slice(0, 10)] = computeQDriftProxy({ totalPhaseEnergy, barrier, barrierRatio }).qDriftProxy;
    return acc;
  }, {});
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

function getNetEphemerisSignalSeries(
  metricKey: string,
  timestamps: string[],
  ephemerisByDate: Record<string, EphemerisRecord['bodies']>
): number[] | undefined {
  return timestamps.map(timestamp => {
    const dateKey = timestamp.split('T')[0];
    const netBody = ephemerisByDate[dateKey]?.['net'];
    if (!netBody) {
      return NaN;
    }
    return netBody[metricKey as keyof EphemerisRecord['bodies'][string]] ?? NaN;
  });
}

export default function OverlayPage() {
  const [selectedSignals, setSelectedSignals] = useState<string[]>(['drift']);
  const [showTurningPoints, setShowTurningPoints] = useState(false);
  const [lagResult, setLagResult] = useState<LagResult | null>(null);
  const [ephemerisByDate, setEphemerisByDate] = useState<Record<string, EphemerisRecord['bodies']>>({});
  const [matsuyamaProxyByDate, setMatsuyamaProxyByDate] = useState<Record<string, number | null>>({});
  const isInternalUpdate = useRef(false);

  const { timeRange, timeLockEnabled, setTimeRange } = useTimeStore();
  const rollingStats = useStore(state => state.rollingStats);
  const data = useStore(state => state.data);
  const windowSize = useStore(state => state.windowSize);
  const turnThreshold = useStore(state => state.turnThreshold);
  const eopDataset = useStore(state => state.eopDataset);
  const [traces, setTraces] = useState<Plotly.Data[]>([]);
  const [lagTraces, setLagTraces] = useState<Plotly.Data[]>([]);
  const observationRange = useMemo<[string, string] | null>(() => {
    if (data.length === 0) {
      return null;
    }

    return [data[0].t.slice(0, 10), data[data.length - 1].t.slice(0, 10)];
  }, [data]);

  const visibleXRange = useMemo<[string, string] | undefined>(() => {
    if (timeLockEnabled && timeRange) {
      return [new Date(timeRange[0]).toISOString(), new Date(timeRange[1]).toISOString()];
    }

    return observationRange ?? undefined;
  }, [observationRange, timeLockEnabled, timeRange]);

  const overlaySources = useMemo(() => {
    const sources: string[] = [];
    if (selectedSignals.some(signal => signal.includes(':'))) {
      sources.push('JPL DE442');
    }
    if (selectedSignals.some(signal => signal === 'kp' || signal === 'ap')) {
      sources.push('GFZ Kp');
    }
    if (selectedSignals.includes('qDriftProxy')) {
      sources.push('DRIFT phase escape');
    }
    return sources;
  }, [selectedSignals]);

  const overlayTitle = useChartTitle('Overlay Plot', undefined, overlaySources);
  const lagTitle = useChartTitle('Lag Response Function', undefined, [], { showDateRange: false });

  const ephemerisWindow = useMemo<{ start: string; end: string } | undefined>(() => {
    if (timeLockEnabled && timeRange) {
      return {
        start: new Date(timeRange[0]).toISOString().slice(0, 10),
        end: new Date(timeRange[1]).toISOString().slice(0, 10),
      };
    }

    if (!observationRange) {
      return undefined;
    }

    return {
      start: observationRange[0],
      end: observationRange[1],
    };
  }, [observationRange, timeLockEnabled, timeRange]);

  const selectedSeries = useMemo(() => {
    if (!rollingStats || data.length === 0) {
      return [];
    }

    const timestamps = data.map(d => d.t);
    return selectedSignals.map(signalKey => {
      let raw: number[] | undefined;

      if (signalKey.startsWith('net:')) {
        const metricKey = signalKey.split(':')[1];
        raw = getNetEphemerisSignalSeries(metricKey, timestamps, ephemerisByDate);
      } else if (signalKey.includes(':')) {
        raw = getEphemerisSignalSeries(signalKey, timestamps, ephemerisByDate);
      } else {
        raw = getCoreSignalSeries(signalKey, rollingStats, data, matsuyamaProxyByDate);
      }

      if (!raw) {
        return null;
      }

      return {
        key: signalKey,
        label: signalKey.includes(':') ? getEphemerisSignalLabel(signalKey) : CORE_SIGNALS[signalKey as keyof typeof CORE_SIGNALS]?.label ?? signalKey,
        raw,
        normalized: normalize(raw),
      };
    }).filter(Boolean) as Array<WideCsvSeries & { key: string }>;
  }, [data, ephemerisByDate, matsuyamaProxyByDate, rollingStats, selectedSignals]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const params = new URLSearchParams({
      windowSize: String(windowSize),
      turnThreshold: String(turnThreshold),
      smoothDays: '31',
      dataset: eopDataset,
      view: 'panel',
      composite: MATSUYAMA_COMPOSITE,
    });

    fetch(`/api/phase-escape?${params.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to load Matsuyama proxy overlay data');
        }
        return response.json();
      })
      .then((payload: PhaseEscapeDataset) => {
        if (active) {
          setMatsuyamaProxyByDate(buildMatsuyamaProxyByDate(payload.records ?? []));
        }
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        console.error('Failed to load Matsuyama proxy overlay data:', error);
        if (active) {
          setMatsuyamaProxyByDate({});
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [eopDataset, turnThreshold, windowSize]);

  useEffect(() => {
    if (rollingStats?.lagModel) {
      setLagResult(rollingStats.lagModel);
    }
  }, [rollingStats]);

  useEffect(() => {
    let active = true;

    loadEphemerisData(ephemerisWindow)
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
  }, [ephemerisWindow]);

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

    const nextTraces = selectedSeries.map(series => {
      const filtered = filteredIndices.map(i => series.raw[i] ?? NaN);
      return {
        x: filteredTime,
        y: normalize(filtered),
        mode: 'lines',
        name: series.label,
        line: { width: 2 },
      } as Plotly.Data;
    });

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
  }, [data, rollingStats, selectedSeries, showTurningPoints, timeLockEnabled, timeRange]);

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
    title: overlayTitle as any,
    template: 'plotly_dark',
    xaxis: {
      title: { text: 'Date', standoff: 20 },
      gridcolor: '#374151',
      zerolinecolor: '#4b5563',
      ...(visibleXRange ? { range: visibleXRange } : {}),
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
    margin: { l: 60, r: 20, t: 96, b: 60 },
  }), [overlayTitle, visibleXRange]);

  const lagLayout = useMemo(() => ({
    title: lagTitle as any,
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
    margin: { l: 60, r: 20, t: 78, b: 60 },
  }), [lagTitle]);

  const signalOptions = useMemo(() => ([
    ...Object.entries(CORE_SIGNALS).map(([key, config]) => ({ key, label: config.label })),
    ...EPHEMERIS_BODY_CONFIG.filter(body => body.key !== 'net').flatMap(body =>
      EPHEMERIS_METRIC_CONFIG.map(metric => ({
        key: `${body.key}:${metric.key}`,
        label: `${body.label} ${metric.shortLabel}`,
      }))
    ),
    ...EPHEMERIS_METRIC_CONFIG.map(metric => ({
      key: `net:${metric.key}`,
      label: `Net ${metric.shortLabel}`,
    })),
  ]), []);

  const overlayCsvConfig = useMemo(() => createCsvExportConfig(
    'overlay-plot.csv',
    { displayModeBar: true, responsive: true, scrollZoom: true, doubleClick: 'reset+autosize' },
    (graphDiv) => {
      const xRange = plotlyXRange(graphDiv);
      return buildSelectedSeriesCsvRows(data, selectedSeries, xRange);
    }
  ), [data, selectedSeries]);

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
          <p className="mt-1 text-sm text-[#9ca3af]">Geocentric overlays include distance, angular velocity, radial velocity, ecliptic longitude, and torque proxy for each major body plus a combined Net row.</p>
          <p className="mt-2 text-xs text-[#6b7280]">Torque proxy = mass / r^3 * angular speed. The Net torque row sums each non-Sun/non-Moon body after temporal normalization by its body-specific cache-wide peak, emphasizing timing relationships over intensity.</p>
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
          config={overlayCsvConfig}
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
            config={createCsvExportConfig('overlay-lag-response.csv', { displayModeBar: true, responsive: true })}
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
