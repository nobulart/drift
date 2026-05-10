"use client";

import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import Plot from 'react-plotly.js';
import { useTimeStore } from '@/store/timeStore';
import { PanelFullscreenContext } from '@/components/LayoutPanel';
import { usePlotDisplayHeight } from '@/components/usePlotDisplayHeight';
import { createCsvExportConfig } from '@/lib/plotlyCsvExport';
import { useChartTitle } from '@/lib/chartTitles';
import { getMarkerLabel, getMarkerLabelSize, getPlotPointDate } from '@/lib/chartMarkers';
import {
  DEFAULT_PATH_COLOR_SCALE,
  HEATMAP_COLOR_SCALES,
  HEATMAP_PALETTES,
  PATH_COLOR_SCALE_RESET_EVENT,
  readPathColorScale,
  writePathColorScale,
} from '@/lib/colorScales';
import { useStore } from '@/store/useStore';

interface PolarMotionTrajectoryPlotProps {
  xpData: number[];
  ypData: number[];
  dates: string[];
  rollingStats?: {
    turningPoints?: number[];
  } | null;
}

interface TrajectoryPoint {
  index: number;
  date: string;
  year: number;
  xPole: number;
  yPole: number;
}

function decimalYear(date: string): number {
  const parsed = new Date(date);
  if (!Number.isFinite(parsed.getTime())) {
    return NaN;
  }

  const year = parsed.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const next = Date.UTC(year + 1, 0, 1);
  return year + (parsed.getTime() - start) / (next - start);
}

function buildTrajectory(xpData: number[], ypData: number[], dates: string[]) {
  return dates
    .map((date, index) => ({
      index,
      date,
      year: decimalYear(date),
      xPole: xpData[index] * 1000,
      yPole: ypData[index] * 1000,
    }))
    .filter((point) => (
      Number.isFinite(point.year) &&
      Number.isFinite(point.xPole) &&
      Number.isFinite(point.yPole)
    ))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export default function PolarMotionTrajectoryPlot({ xpData, ypData, dates, rollingStats }: PolarMotionTrajectoryPlotProps) {
  const { timeRange, timeLockEnabled } = useTimeStore();
  const isFullscreen = useContext(PanelFullscreenContext);
  const containerRef = useRef<HTMLDivElement>(null);
  const fallbackHeight = usePlotDisplayHeight(560, 1800);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const measuredLimit = isFullscreen && containerSize.width > 0 && containerSize.height > 0
    ? Math.min(containerSize.width, containerSize.height)
    : (containerSize.width || fallbackHeight);
  const plotSize = Math.round(Math.min(measuredLimit, fallbackHeight));
  const chartTitle = useChartTitle('Polar Motion Trajectory', dates);
  const chartMarkers = useStore((state) => state.chartMarkers);
  const chartMarkerSize = useStore((state) => state.chartMarkerSize);
  const markerPlacementEnabled = useStore((state) => state.markerPlacementEnabled);
  const addChartMarker = useStore((state) => state.addChartMarker);
  const [colorScale, setColorScale] = useState(() => readPathColorScale('polar-motion-trajectory'));

  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      setContainerSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    writePathColorScale('polar-motion-trajectory', colorScale);
  }, [colorScale]);

  useEffect(() => {
    const handleReset = () => setColorScale(DEFAULT_PATH_COLOR_SCALE);
    window.addEventListener(PATH_COLOR_SCALE_RESET_EVENT, handleReset);
    return () => window.removeEventListener(PATH_COLOR_SCALE_RESET_EVENT, handleReset);
  }, []);

  const points = useMemo(
    () => buildTrajectory(xpData, ypData, dates),
    [dates, xpData, ypData]
  );
  const turningPointIndices = useMemo(
    () => new Set(rollingStats?.turningPoints || []),
    [rollingStats]
  );

  const visiblePoints = useMemo(() => {
    if (!timeLockEnabled || !timeRange) {
      return points;
    }

    const dataTimes = points
      .map((point) => new Date(point.date).getTime())
      .filter(Number.isFinite);
    const dataStart = Math.min(...dataTimes);
    const dataEnd = Math.max(...dataTimes);

    if (!Number.isFinite(dataStart) || !Number.isFinite(dataEnd) || timeRange[1] < dataStart || timeRange[0] > dataEnd) {
      return points;
    }

    return points.filter((point) => {
      const ts = new Date(point.date).getTime();
      return Number.isFinite(ts) && ts >= timeRange[0] && ts <= timeRange[1];
    });
  }, [points, timeLockEnabled, timeRange]);

  const traces = useMemo(() => {
    if (visiblePoints.length === 0) {
      return [];
    }

    const origin = visiblePoints[0];
    const displayPoints = visiblePoints.map((point) => ({
      ...point,
      displayXPole: point.xPole - origin.xPole,
      displayYPole: point.yPole - origin.yPole,
    }));
    const pathTrace: Plotly.Data = {
      x: displayPoints.map((point) => point.displayXPole),
      y: displayPoints.map((point) => point.displayYPole),
      customdata: displayPoints.map((point) => [point.date, point.displayXPole, point.displayYPole]),
      mode: 'lines+markers',
      type: 'scatter',
      name: 'Polar motion path',
      line: { color: 'rgba(96, 165, 250, 0.45)', width: 1.4 },
      marker: {
        size: 4,
        color: visiblePoints.map((point) => point.year),
        colorscale: HEATMAP_COLOR_SCALES[colorScale],
        showscale: true,
        colorbar: {
          title: { text: 'Calendar year', side: 'right' },
          thickness: 14,
          len: 0.82,
        },
        opacity: 0.78,
      },
      hovertemplate: '%{customdata[0]}<br>x_pole - start %{customdata[1]:.1f} mas<br>y_pole - start %{customdata[2]:.1f} mas<extra></extra>',
    };
    const turningPoints = displayPoints.filter((point) => turningPointIndices.has(point.index));

    const data: Plotly.Data[] = [pathTrace];

    if (turningPoints.length > 0) {
      data.push({
        x: turningPoints.map((point) => point.displayXPole),
        y: turningPoints.map((point) => point.displayYPole),
        customdata: turningPoints.map((point) => [point.date, point.displayXPole, point.displayYPole]),
        mode: 'markers',
        type: 'scatter',
        name: 'Turning points',
        marker: {
          size: 8,
          color: '#ef4444',
          opacity: 0.95,
          line: { color: '#fee2e2', width: 1 },
        },
        hovertemplate: 'Turning point %{customdata[0]}<br>x_pole - start %{customdata[1]:.1f} mas<br>y_pole - start %{customdata[2]:.1f} mas<extra></extra>',
      });
    }

    const markerPoints = chartMarkers
      .map((marker) => {
        const point = visiblePoints.reduce<TrajectoryPoint | null>((nearest, candidate) => {
          const markerTime = new Date(`${marker.date}T00:00:00Z`).getTime();
          const candidateTime = new Date(`${candidate.date}T00:00:00Z`).getTime();
          if (!Number.isFinite(markerTime) || !Number.isFinite(candidateTime)) {
            return nearest;
          }

          if (!nearest) {
            return candidate;
          }

          const nearestTime = new Date(`${nearest.date}T00:00:00Z`).getTime();
          return Math.abs(candidateTime - markerTime) < Math.abs(nearestTime - markerTime)
            ? candidate
            : nearest;
        }, null);

        return point ? { marker, point } : null;
      })
      .filter((entry): entry is { marker: typeof chartMarkers[number]; point: TrajectoryPoint } => entry !== null);

    if (markerPoints.length > 0) {
      data.push({
        x: markerPoints.map(({ point }) => point.xPole - origin.xPole),
        y: markerPoints.map(({ point }) => point.yPole - origin.yPole),
        text: markerPoints.map(({ marker }) => marker.emoji),
        customdata: markerPoints.map(({ marker, point }) => [marker.label || marker.date, point.date, point.xPole - origin.xPole, point.yPole - origin.yPole]),
        mode: 'text',
        type: 'scatter',
        name: 'Markers',
        textfont: { size: chartMarkerSize },
        textposition: 'middle center',
        hovertemplate: '%{customdata[0]}<br>%{customdata[1]}<br>x_pole - start %{customdata[2]:.1f} mas<br>y_pole - start %{customdata[3]:.1f} mas<extra></extra>',
      });

      const labeledMarkers = markerPoints.filter(({ marker }) => getMarkerLabel(marker));
      if (labeledMarkers.length > 0) {
        data.push({
          x: labeledMarkers.map(({ point }) => point.xPole - origin.xPole),
          y: labeledMarkers.map(({ point }) => point.yPole - origin.yPole),
          text: labeledMarkers.map(({ marker }) => getMarkerLabel(marker)),
          customdata: labeledMarkers.map(({ marker, point }) => [marker.date, point.date, point.xPole - origin.xPole, point.yPole - origin.yPole]),
          mode: 'text',
          type: 'scatter',
          name: 'Marker labels',
          textfont: { size: getMarkerLabelSize(chartMarkerSize), color: '#fef3c7' },
          textposition: 'middle right',
          hovertemplate: '%{customdata[0]}<br>%{customdata[1]}<br>x_pole - start %{customdata[2]:.1f} mas<br>y_pole - start %{customdata[3]:.1f} mas<extra></extra>',
        });
      }
    }

    return data;
  }, [chartMarkerSize, chartMarkers, colorScale, turningPointIndices, visiblePoints]);

  const axisRanges = useMemo(() => {
    if (visiblePoints.length === 0) {
      return { x: [-1, 1], y: [-1, 1] };
    }

    const origin = visiblePoints[0];
    const extents = visiblePoints.flatMap((point) => [
      Math.abs(point.xPole - origin.xPole),
      Math.abs(point.yPole - origin.yPole),
    ]);
    const half = Math.max(...extents, 1) * 1.08;

    return {
      x: [-half, half],
      y: [-half, half],
    };
  }, [visiblePoints]);

  if (traces.length === 0) {
    return (
      <div className="flex min-h-[460px] w-full items-center justify-center rounded-lg border border-[#374151] bg-[#111827]">
        <p className="text-[#9ca3af]">Polar-motion trajectory data are not available for the selected range.</p>
      </div>
    );
  }

  const handleClick = (event: Readonly<Plotly.PlotMouseEvent>) => {
    if (!markerPlacementEnabled) return;
    const date = getPlotPointDate(event);
    if (date) addChartMarker(date);
  };

  return (
    <div ref={containerRef} className="h-full w-full min-w-0">
      <div className="mb-2 flex justify-end">
        <label className="flex items-center gap-2 text-xs text-[#e5e7eb]">
          <span className="text-[#9ca3af]">Palette</span>
          <select
            value={colorScale}
            onChange={(event) => setColorScale(event.target.value)}
            className="h-8 rounded-md border border-[#374151] bg-[#111827] px-2 text-xs text-[#e5e7eb] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
          >
            {HEATMAP_PALETTES.map((palette) => (
              <option key={palette.value} value={palette.value}>
                {palette.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Plot
        data={traces}
        layout={{
          title: chartTitle,
          xaxis: {
            title: { text: 'x_pole - path start (mas)', standoff: 18 },
            range: axisRanges.x,
            scaleanchor: 'y',
            scaleratio: 1,
            constrain: 'domain',
            gridcolor: '#374151',
            zerolinecolor: '#64748b',
          },
          yaxis: {
            title: { text: 'y_pole - path start (mas)', standoff: 18 },
            range: axisRanges.y,
            constrain: 'domain',
            gridcolor: '#374151',
            zerolinecolor: '#64748b',
          },
          height: plotSize,
          margin: { l: 70, r: 94, t: 58, b: 70 },
          showlegend: false,
          hovermode: 'closest',
          plot_bgcolor: '#111827',
          paper_bgcolor: '#0b1220',
          font: { color: '#e5e7eb' },
          autosize: true,
          uirevision: timeLockEnabled && timeRange ? `${timeRange[0]}-${timeRange[1]}` : 'polar-motion-trajectory-free',
        } as any}
        config={createCsvExportConfig('polar-motion-trajectory.csv', { displayModeBar: true, responsive: true, scrollZoom: true, doubleClick: 'reset+autosize' })}
        style={{ width: '100%', height: `${plotSize}px` }}
        useResizeHandler
        onClick={handleClick}
      />
    </div>
  );
}
