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
import { EphemerisDataset, EphemerisRecord } from '@/lib/types';
import { usePlotDisplayHeight } from '@/components/usePlotDisplayHeight';
import { buildSelectedSeriesCsvRows, createCsvExportConfig, plotlyXRange, WideCsvSeries } from '@/lib/plotlyCsvExport';
import { useTimeStore } from '@/store/timeStore';
import { useStore } from '@/store/useStore';
import {
  DEFAULT_OVERLAY_SIGNALS,
  OVERLAY_SIGNAL_RESET_EVENT,
  readOverlaySignals,
  writeOverlaySignals,
} from '@/lib/overlayPreferences';

interface CoreSignalConfig {
  label: string;
}

const CORE_SIGNALS: Record<string, CoreSignalConfig> = {
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
};

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
  data: Array<{ xp?: number | null; yp?: number | null; ut1_utc?: number | null; lod?: number | null; kp?: number | null; ap?: number | null }>
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

function getEphemerisTraceSeries(
  key: string,
  records: EphemerisRecord[]
): { x: string[]; raw: number[] } | undefined {
  const [bodyKey, metricKey] = key.split(':');
  if (!bodyKey || !metricKey) {
    return undefined;
  }

  return {
    x: records.map(record => record.t),
    raw: records.map(record =>
      record.bodies[bodyKey]?.[metricKey as keyof EphemerisRecord['bodies'][string]] ?? NaN
    ),
  };
}

export default function OverlayPlot() {
  const [selectedSignals, setSelectedSignals] = useState<string[]>(readOverlaySignals);
  const [ephemerisByDate, setEphemerisByDate] = useState<Record<string, EphemerisRecord['bodies']>>({});
  const [ephemerisRecords, setEphemerisRecords] = useState<EphemerisRecord[]>([]);
  const isInternalUpdate = useRef(false);
  const plotHeight = usePlotDisplayHeight(500, 860);

  const { timeRange, timeLockEnabled, setTimeRange } = useTimeStore();
  const rollingStats = useStore(state => state.rollingStats);
  const data = useStore(state => state.data);
  const [traces, setTraces] = useState<Plotly.Data[]>([]);
  const observationRange = useMemo<[string, string] | null>(() => {
    if (data.length === 0) {
      return null;
    }

    return [data[0].t, data[data.length - 1].t];
  }, [data]);

  const selectedSeries = useMemo(() => {
    if (!rollingStats || data.length === 0) {
      return [];
    }

    const timestamps = data.map(d => d.t);
    return selectedSignals.map(signalKey => {
      const raw = signalKey.includes(':')
        ? getEphemerisSignalSeries(signalKey, timestamps, ephemerisByDate)
        : getCoreSignalSeries(signalKey, rollingStats, data);

      if (!raw) {
        return null;
      }

      return {
        key: signalKey,
        label: signalKey.includes(':') ? getEphemerisSignalLabel(signalKey) : CORE_SIGNALS[signalKey]?.label ?? signalKey,
        raw,
        normalized: normalize(raw),
      };
    }).filter(Boolean) as Array<WideCsvSeries & { key: string }>;
  }, [data, ephemerisByDate, rollingStats, selectedSignals]);

  useEffect(() => {
    let active = true;

    loadEphemerisData(
      observationRange
        ? { start: observationRange[0], end: observationRange[1] }
        : undefined
    )
      .then((dataset: EphemerisDataset) => {
        if (!active || !dataset?.records) {
          return;
        }

        const nextMap = dataset.records.reduce<Record<string, EphemerisRecord['bodies']>>((acc, record) => {
          acc[record.t] = record.bodies;
          return acc;
        }, {});
        setEphemerisByDate(nextMap);
        setEphemerisRecords(dataset.records);
      })
      .catch(error => {
        console.error('Failed to load ephemeris data:', error);
      });

    return () => {
      active = false;
    };
  }, [observationRange]);

  useEffect(() => {
    writeOverlaySignals(selectedSignals);
  }, [selectedSignals]);

  useEffect(() => {
    const handleReset = () => {
      setSelectedSignals([...DEFAULT_OVERLAY_SIGNALS]);
    };

    window.addEventListener(OVERLAY_SIGNAL_RESET_EVENT, handleReset);
    return () => window.removeEventListener(OVERLAY_SIGNAL_RESET_EVENT, handleReset);
  }, []);

  useEffect(() => {
    if (!rollingStats || data.length === 0) {
      setTraces([]);
      return;
    }

    const rangeFilter = (timestamp: string) => {
      if (!timeLockEnabled || !timeRange) {
        return true;
      }

      const t = new Date(timestamp).getTime();
      return t >= timeRange[0] && t <= timeRange[1];
    };

    const timestamps = data.map(d => d.t);
    const filteredIndices = timestamps.map((_, i) => i).filter(i => rangeFilter(timestamps[i]));
    const filteredTime = filteredIndices.map(i => timestamps[i]);

    const nextTraces = selectedSignals.map(signalKey => {
      if (signalKey.includes(':')) {
        const series = getEphemerisTraceSeries(signalKey, ephemerisRecords);
        if (!series) {
          return null;
        }

        const filteredSamples = series.x
          .map((timestamp, index) => ({ timestamp, value: series.raw[index] ?? NaN }))
          .filter(sample => rangeFilter(sample.timestamp));

        return {
          x: filteredSamples.map(sample => sample.timestamp),
          y: normalize(filteredSamples.map(sample => sample.value)),
          mode: 'lines',
          name: getEphemerisSignalLabel(signalKey),
          line: { width: 2 },
        } as Plotly.Data;
      }

      const series = selectedSeries.find(entry => entry.key === signalKey);
      if (!series) {
        return null;
      }

      const filtered = filteredIndices.map(i => series.raw[i] ?? NaN);
      return {
        x: filteredTime,
        y: normalize(filtered),
        mode: 'lines',
        name: series.label,
        line: { width: 2 },
      } as Plotly.Data;
    }).filter(Boolean) as Plotly.Data[];

    setTraces(nextTraces);
  }, [data, ephemerisRecords, rollingStats, selectedSeries, selectedSignals, timeLockEnabled, timeRange]);

  const visibleXRange = useMemo<[string, string] | undefined>(() => {
    if (timeLockEnabled && timeRange) {
      return [new Date(timeRange[0]).toISOString(), new Date(timeRange[1]).toISOString()];
    }

    return observationRange ?? undefined;
  }, [observationRange, timeLockEnabled, timeRange]);

  const nowIso = useMemo(() => new Date().toISOString(), []);

  const overlayLayout = useMemo(() => ({
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
    shapes: [
      {
        type: 'line' as const,
        xref: 'x' as const,
        yref: 'paper' as const,
        x0: nowIso,
        x1: nowIso,
        y0: 0,
        y1: 1,
        line: { color: '#f59e0b', width: 2, dash: 'dash' as const },
      },
    ],
    annotations: [
      {
        x: nowIso,
        y: 1,
        xref: 'x' as const,
        yref: 'paper' as const,
        text: 'Now',
        showarrow: false,
        xanchor: 'left' as const,
        yanchor: 'bottom' as const,
        font: { color: '#fbbf24', size: 11 },
      },
    ],
    margin: { l: 60, r: 20, t: 40, b: 60 },
    plot_bgcolor: '#111827',
    paper_bgcolor: '#0b1220',
    font: { color: '#e5e7eb' },
    height: plotHeight,
    autosize: true,
  }), [nowIso, plotHeight, visibleXRange]);

  const overlayCsvConfig = useMemo(() => createCsvExportConfig(
    'overlay-plot.csv',
    { displayModeBar: true, responsive: true, scrollZoom: true, doubleClick: 'reset+autosize' },
    (graphDiv) => {
      const xRange = plotlyXRange(graphDiv);
      return buildSelectedSeriesCsvRows(data, selectedSeries, xRange);
    }
  ), [data, selectedSeries]);

  const handleRelayout = (event: any) => {
    if (isInternalUpdate.current || !timeLockEnabled) return;
    const range = extractPlotlyDateRange(event);
    if (!range) return;
    isInternalUpdate.current = true;
    setTimeRange(range);
    setTimeout(() => { isInternalUpdate.current = false; }, 0);
  };

  const toggleSignal = (signalKey: string) => {
    setSelectedSignals(prev => (
      prev.includes(signalKey)
        ? prev.filter(entry => entry !== signalKey)
        : [...prev, signalKey]
    ));
  };

  return (
    <div className="p-4 bg-[#0b1220] h-full w-full min-w-0">
      <div className="mb-4 space-y-4">
        <div className="flex flex-wrap gap-x-4 gap-y-2 items-center">
          {(Object.keys(CORE_SIGNALS) as Array<keyof typeof CORE_SIGNALS>).map(key => (
            <label key={key} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedSignals.includes(key)}
                onChange={() => toggleSignal(key)}
                className="w-4 h-4 rounded border-gray-600 text-[#3b82f6] focus:ring-[#3b82f6]"
              />
              <span className="text-sm text-[#e5e7eb]">{CORE_SIGNALS[key].label}</span>
            </label>
          ))}
        </div>

        <div className="rounded-lg border border-[#1f2937] bg-[#111827] p-3">
          <div className="mb-2 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-[#e5e7eb]">DE442 Geocentric Ephemerides</p>
              <p className="text-xs text-[#9ca3af]">Overlay planetary distance, angular motion, longitude, radial speed, and a torque-screening proxy.</p>
            </div>
            <p className="text-xs text-[#6b7280]">Observer: Earth geocenter</p>
          </div>
          <div className="max-h-48 overflow-auto rounded-md border border-[#1f2937]">
            <div
              className="grid min-w-[680px] items-center gap-px bg-[#1f2937] text-xs"
              style={{ gridTemplateColumns: `minmax(5.5rem, 0.9fr) repeat(${EPHEMERIS_METRIC_CONFIG.length}, minmax(5.5rem, 1fr))` }}
            >
              <div className="sticky left-0 top-0 z-20 bg-[#0b1220] px-2 py-2 font-semibold uppercase tracking-wide text-[#9ca3af]">
                Body
              </div>
              {EPHEMERIS_METRIC_CONFIG.map(metric => (
                <div key={metric.key} className="sticky top-0 z-10 bg-[#0b1220] px-2 py-2 text-center font-semibold uppercase tracking-wide text-[#60a5fa]">
                  {metric.shortLabel}
                </div>
              ))}
              {EPHEMERIS_BODY_CONFIG.map(body => (
                <div key={body.key} className="contents">
                  <div className="sticky left-0 z-10 bg-[#111827] px-2 py-1.5 font-medium text-[#d1d5db]">
                    {body.label}
                  </div>
                  {EPHEMERIS_METRIC_CONFIG.map(metric => {
                    const signalKey = `${body.key}:${metric.key}`;
                    return (
                      <label
                        key={signalKey}
                        className="flex cursor-pointer items-center justify-center bg-[#111827] px-2 py-1.5 transition-colors hover:bg-[#1f2937]"
                        title={`${body.label} ${metric.label}`}
                      >
                        <input
                          type="checkbox"
                          aria-label={`${body.label} ${metric.shortLabel}`}
                          checked={selectedSignals.includes(signalKey)}
                          onChange={() => toggleSignal(signalKey)}
                          className="h-4 w-4 rounded border-gray-600 text-[#3b82f6] focus:ring-[#3b82f6]"
                        />
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <p className="mt-3 text-xs text-[#9ca3af]">
            `Torque Proxy` is a heuristic `mass / r^3 * angular speed`, intended for screening correlations rather than physical torque closure.
          </p>
        </div>
      </div>

      <div className="w-full min-w-0">
        <Plot
          data={traces}
          layout={{
            ...overlayLayout,
            uirevision: timeLockEnabled && timeRange
              ? `${new Date(timeRange[0]).toISOString()}-${new Date(timeRange[1]).toISOString()}`
              : 'overlay-free-zoom',
          } as any}
          config={overlayCsvConfig}
          style={{ width: '100%', height: `${plotHeight}px` }}
          useResizeHandler
          onRelayout={handleRelayout}
        />
      </div>
    </div>
  );
}
