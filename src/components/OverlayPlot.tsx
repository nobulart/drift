'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
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
import { useChartTitle } from '@/lib/chartTitles';
import {
  DEFAULT_OVERLAY_PLOT_MODE,
  DEFAULT_OVERLAY_SIGNALS,
  OVERLAY_SIGNAL_RESET_EVENT,
  readOverlayPlotMode,
  readOverlaySignals,
  writeOverlayPlotMode,
  writeOverlaySignals,
} from '@/lib/overlayPreferences';
import { buildMarkerLayout, getContextMenuDate, getMarkerDeleteToleranceDays, getPlotClickDate } from '@/lib/chartMarkers';

interface CoreSignalConfig {
  label: string;
}

const LINE_CHART_MODE = DEFAULT_OVERLAY_PLOT_MODE;

const HEATMAP_PALETTES = [
  { value: 'Viridis', label: 'Viridis' },
  { value: 'Cividis', label: 'Cividis' },
  { value: 'Plasma', label: 'Plasma' },
  { value: 'Inferno', label: 'Inferno' },
  { value: 'Magma', label: 'Magma' },
  { value: 'Turbo', label: 'Turbo' },
  { value: 'Spectral', label: 'Spectral' },
  { value: 'Jet', label: 'Jet' },
  { value: 'Hot', label: 'Hot' },
  { value: 'Electric', label: 'Electric' },
  { value: 'Earth', label: 'Earth' },
  { value: 'Rainbow', label: 'Rainbow' },
];

const HEATMAP_COLOR_SCALES: Record<string, Array<[number, string]>> = {
  Viridis: [
    [0, '#440154'],
    [0.13, '#482878'],
    [0.25, '#3e4989'],
    [0.38, '#31688e'],
    [0.5, '#26828e'],
    [0.63, '#1f9e89'],
    [0.75, '#35b779'],
    [0.88, '#6ece58'],
    [1, '#fde725'],
  ],
  Cividis: [
    [0, '#00204c'],
    [0.13, '#173b6d'],
    [0.25, '#4a5772'],
    [0.38, '#6d6f74'],
    [0.5, '#8a8878'],
    [0.63, '#a8a178'],
    [0.75, '#c8bd73'],
    [0.88, '#e5d96d'],
    [1, '#fff838'],
  ],
  Plasma: [
    [0, '#0d0887'],
    [0.13, '#46039f'],
    [0.25, '#7201a8'],
    [0.38, '#9c179e'],
    [0.5, '#bd3786'],
    [0.63, '#d8576b'],
    [0.75, '#ed7953'],
    [0.88, '#fb9f3a'],
    [1, '#f0f921'],
  ],
  Inferno: [
    [0, '#000004'],
    [0.13, '#1b0c41'],
    [0.25, '#4a0c6b'],
    [0.38, '#781c6d'],
    [0.5, '#a52c60'],
    [0.63, '#cf4446'],
    [0.75, '#ed6925'],
    [0.88, '#fb9b06'],
    [1, '#fcffa4'],
  ],
  Magma: [
    [0, '#000004'],
    [0.13, '#180f3d'],
    [0.25, '#440f76'],
    [0.38, '#721f81'],
    [0.5, '#9e2f7f'],
    [0.63, '#cd4071'],
    [0.75, '#f1605d'],
    [0.88, '#fd9668'],
    [1, '#fcfdbf'],
  ],
  Turbo: [
    [0, '#30123b'],
    [0.13, '#4145ab'],
    [0.25, '#4675ed'],
    [0.38, '#39a2fc'],
    [0.5, '#1bcfd4'],
    [0.63, '#24eca6'],
    [0.75, '#a4fc3c'],
    [0.88, '#f5c83b'],
    [1, '#7a0403'],
  ],
  Spectral: [
    [0, '#9e0142'],
    [0.13, '#d53e4f'],
    [0.25, '#f46d43'],
    [0.38, '#fdae61'],
    [0.5, '#ffffbf'],
    [0.63, '#abdda4'],
    [0.75, '#66c2a5'],
    [0.88, '#3288bd'],
    [1, '#5e4fa2'],
  ],
  Jet: [
    [0, '#000083'],
    [0.35, '#003cff'],
    [0.5, '#00ff66'],
    [0.65, '#ffff00'],
    [1, '#800000'],
  ],
  Hot: [
    [0, '#000000'],
    [0.35, '#b00000'],
    [0.7, '#ffff00'],
    [1, '#ffffff'],
  ],
  Electric: [
    [0, '#000000'],
    [0.15, '#1e0063'],
    [0.35, '#5500ff'],
    [0.55, '#00c2ff'],
    [0.75, '#00ff85'],
    [1, '#ffffff'],
  ],
  Earth: [
    [0, '#102f4a'],
    [0.18, '#236477'],
    [0.35, '#4f8f66'],
    [0.52, '#8f9b54'],
    [0.7, '#c19a5b'],
    [0.86, '#d8c49a'],
    [1, '#f6f0d8'],
  ],
  Rainbow: [
    [0, '#6e40aa'],
    [0.17, '#be3caf'],
    [0.33, '#fe4b83'],
    [0.5, '#ff7847'],
    [0.67, '#e2b72f'],
    [0.83, '#8bd646'],
    [1, '#1ac7c2'],
  ],
};

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

function scaleHeatmapRow(series: number[]): number[] {
  const valid = series.filter(v => Number.isFinite(v));
  if (valid.length === 0) return series;

  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const span = max - min;
  if (span === 0) {
    return series.map(v => Number.isFinite(v) ? 0 : NaN);
  }

  return series.map(v => {
    if (!Number.isFinite(v)) return NaN;
    return ((v - min) / span) * 2 - 1;
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

function getEphemerisTraceSeries(
  key: string,
  records: EphemerisRecord[]
): { x: string[]; raw: number[] } | undefined {
  const [bodyKey, metricKey] = key.split(':');
  if (!bodyKey || !metricKey) {
    return undefined;
  }

  if (bodyKey === 'net') {
    return {
      x: records.map(record => record.t),
      raw: records.map(record =>
        record.bodies['net']?.[metricKey as keyof EphemerisRecord['bodies'][string]] ?? NaN
      ),
    };
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
  const [plotMode, setPlotMode] = useState<string>(readOverlayPlotMode);
  const [ephemerisByDate, setEphemerisByDate] = useState<Record<string, EphemerisRecord['bodies']>>({});
  const [ephemerisRecords, setEphemerisRecords] = useState<EphemerisRecord[]>([]);
  const isInternalUpdate = useRef(false);
  const plotHeight = usePlotDisplayHeight(550, 946);
  const isHeatmapMode = plotMode !== LINE_CHART_MODE;

  const { timeRange, timeLockEnabled, setTimeRange } = useTimeStore();
  const rollingStats = useStore(state => state.rollingStats);
  const data = useStore(state => state.data);
  const chartMarkers = useStore((state) => state.chartMarkers);
  const markerPlacementEnabled = useStore((state) => state.markerPlacementEnabled);
  const addChartMarker = useStore((state) => state.addChartMarker);
  const deleteNearestChartMarker = useStore((state) => state.deleteNearestChartMarker);
  const [traces, setTraces] = useState<Plotly.Data[]>([]);
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
    return sources;
  }, [selectedSignals]);

  const chartTitle = useChartTitle('Overlay Plot', undefined, overlaySources);

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
        raw = getCoreSignalSeries(signalKey, rollingStats, data);
      }

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
        setEphemerisRecords(dataset.records);
      })
      .catch(error => {
        console.error('Failed to load ephemeris data:', error);
      });

    return () => {
      active = false;
    };
  }, [ephemerisWindow]);

  useEffect(() => {
    writeOverlaySignals(selectedSignals);
  }, [selectedSignals]);

  useEffect(() => {
    writeOverlayPlotMode(plotMode);
  }, [plotMode]);

  useEffect(() => {
    const handleReset = () => {
      setTraces([]);
      setSelectedSignals([...DEFAULT_OVERLAY_SIGNALS]);
      setPlotMode(DEFAULT_OVERLAY_PLOT_MODE);
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

    if (isHeatmapMode) {
      const hasCoreSignals = selectedSignals.some(signalKey => !signalKey.includes(':'));
      const heatmapTime = hasCoreSignals
        ? filteredTime
        : ephemerisRecords.map(record => record.t).filter(rangeFilter);

      const heatmapSeries = selectedSignals.map(signalKey => {
        if (signalKey.includes(':')) {
          const series = getEphemerisTraceSeries(signalKey, ephemerisRecords);
          if (!series) {
            return null;
          }

          const valueByDate = new Map(
            series.x.map((timestamp, index) => [timestamp.split('T')[0], series.raw[index] ?? NaN])
          );

          return {
            label: getEphemerisSignalLabel(signalKey),
            values: normalize(heatmapTime.map(timestamp => valueByDate.get(timestamp.split('T')[0]) ?? NaN)),
          };
        }

        const series = selectedSeries.find(entry => entry.key === signalKey);
        if (!series) {
          return null;
        }

        return {
          label: series.label,
          values: normalize(filteredIndices.map(i => series.raw[i] ?? NaN)),
        };
      }).filter(Boolean) as Array<{ label: string; values: number[] }>;

      setTraces(heatmapSeries.length > 0 ? [{
        x: heatmapTime,
        y: heatmapSeries.map(series => series.label),
        z: heatmapSeries.map(series => scaleHeatmapRow(series.values)),
        customdata: heatmapSeries.map(series => series.values),
        type: 'heatmap',
        colorscale: HEATMAP_COLOR_SCALES[plotMode],
        colorbar: {
          title: { text: 'row range' },
          thickness: 14,
        },
        hovertemplate: '%{y}<br>%{x}<br>z=%{customdata:.3f}<extra></extra>',
        zmin: -1,
        zmax: 1,
        zmid: 0,
      } as Plotly.Data] : []);
      return;
    }

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
  }, [data, ephemerisRecords, isHeatmapMode, plotMode, rollingStats, selectedSeries, selectedSignals, timeLockEnabled, timeRange]);

  const nowIso = useMemo(() => new Date().toISOString(), []);

  const overlayLayout = useMemo(() => {
    const markerLayout = buildMarkerLayout(chartMarkers, {
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
    });

    return {
      title: chartTitle as any,
      template: 'plotly_dark',
      xaxis: {
        title: { text: 'Date', standoff: 20 },
        type: 'date' as const,
        gridcolor: '#374151',
        zerolinecolor: '#4b5563',
        ...(visibleXRange ? { range: visibleXRange } : {}),
      },
      yaxis: {
        title: { text: isHeatmapMode ? 'Selected Data' : 'Normalized Value (z-score)', standoff: 20 },
        type: isHeatmapMode ? 'category' as const : 'linear' as const,
        gridcolor: '#374151',
        zerolinecolor: '#4b5563',
        ...(isHeatmapMode ? { automargin: true } : {}),
      },
      legend: {
        orientation: 'h' as const,
        yanchor: 'top' as const,
        y: -0.2,
        xanchor: 'center' as const,
        x: 0.5,
      },
      showscale: isHeatmapMode,
      ...markerLayout,
      margin: { l: isHeatmapMode ? 140 : 60, r: isHeatmapMode ? 70 : 20, t: 78, b: 60 },
      plot_bgcolor: '#111827',
      paper_bgcolor: '#0b1220',
      font: { color: '#e5e7eb' },
      height: plotHeight,
      autosize: true,
    };
  }, [chartMarkers, chartTitle, isHeatmapMode, nowIso, plotHeight, visibleXRange]);

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

  const handleClick = (event: Readonly<Plotly.PlotMouseEvent>) => {
    if (!markerPlacementEnabled) return;
    const date = getPlotClickDate(event);
    if (date) addChartMarker(date);
  };

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    const range = overlayLayout.xaxis?.range as Array<Date | string | number> | undefined;
    const date = getContextMenuDate(event, range);
    if (!date) return;
    event.preventDefault();
    deleteNearestChartMarker(date, getMarkerDeleteToleranceDays(range));
  };

  const toggleSignal = (signalKey: string) => {
    setSelectedSignals(prev => (
      prev.includes(signalKey)
        ? prev.filter(entry => entry !== signalKey)
        : [...prev, signalKey]
    ));
  };

  const handlePlotModeChange = (nextMode: string) => {
    setTraces([]);
    setPlotMode(nextMode);
  };

  return (
    <div className="p-4 bg-[#0b1220] h-full w-full min-w-0">
      <div className="mb-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
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

          <label className="flex items-center gap-2 text-sm text-[#e5e7eb]">
            <span className="text-[#9ca3af]">Plot</span>
            <select
              value={plotMode}
              onChange={(event) => handlePlotModeChange(event.target.value)}
              className="h-9 rounded-md border border-[#374151] bg-[#111827] px-3 text-sm text-[#e5e7eb] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
            >
              <option value={LINE_CHART_MODE}>Line Chart</option>
              {HEATMAP_PALETTES.map(palette => (
                <option key={palette.value} value={palette.value}>
                  {palette.label}
                </option>
              ))}
            </select>
          </label>
        </div>

      </div>

      <div className="w-full min-w-0" onContextMenu={handleContextMenu}>
        <Plot
          key={`overlay-plot-${plotMode}`}
          data={traces}
          layout={{
            ...overlayLayout,
            uirevision: timeLockEnabled && timeRange
              ? `${plotMode}-${new Date(timeRange[0]).toISOString()}-${new Date(timeRange[1]).toISOString()}`
              : `overlay-free-zoom-${plotMode}`,
          } as any}
          config={overlayCsvConfig}
          style={{ width: '100%', height: `${plotHeight}px` }}
          useResizeHandler
          onRelayout={handleRelayout}
          onClick={handleClick}
        />
      </div>

      <div className="mt-4 rounded-lg border border-[#1f2937] bg-[#111827] p-3">
        <div className="mb-2 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-[#e5e7eb]">DE442 Geocentric Ephemerides</p>
            <p className="text-xs text-[#9ca3af]">Overlay planetary distance, angular motion, longitude, radial speed, and torque proxy for each major body plus a combined Net row.</p>
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
            {EPHEMERIS_BODY_CONFIG.filter(body => body.key !== 'net').map(body => (
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
            <div className="contents">
              <div className="sticky left-0 z-10 bg-[#0b1220] px-2 py-1.5 font-bold text-[#fbbf24] border-t-2 border-[#fbbf24]">
                Net
              </div>
              {EPHEMERIS_METRIC_CONFIG.map(metric => {
                const signalKey = `net:${metric.key}`;
                return (
                  <label
                    key={signalKey}
                    className="flex cursor-pointer items-center justify-center bg-[#0b1220] px-2 py-1.5 transition-colors hover:bg-[#1f2937]"
                    title={`Net combined ${metric.label}`}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Net ${metric.shortLabel}`}
                      checked={selectedSignals.includes(signalKey)}
                      onChange={() => toggleSignal(signalKey)}
                      className="h-4 w-4 rounded border-gray-600 text-[#fbbf24] focus:ring-[#fbbf24]"
                    />
                  </label>
                );
              })}
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs text-[#9ca3af]">
          Torque Proxy is a heuristic mass / r^3 * angular speed. The Net torque row sums each non-Sun/non-Moon body after temporal normalization by its body-specific cache-wide peak, emphasizing timing relationships over intensity.
        </p>
      </div>
    </div>
  );
}
