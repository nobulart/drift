"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import Plot from 'react-plotly.js';
import { useTimeStore } from '@/store/timeStore';
import { usePlotDisplayHeight } from '@/components/usePlotDisplayHeight';
import { createCsvExportConfig } from '@/lib/plotlyCsvExport';
import { useChartTitle } from '@/lib/chartTitles';
import { getMarkerLabel, getMarkerLabelSize, getPlotPointDate, useVisibleChartMarkers } from '@/lib/chartMarkers';
import {
  DEFAULT_PATH_COLOR_SCALE,
  HEATMAP_COLOR_SCALES,
  HEATMAP_PALETTES,
  PATH_COLOR_SCALE_RESET_EVENT,
  readPathColorScale,
  writePathColorScale,
} from '@/lib/colorScales';
import { useStore } from '@/store/useStore';

interface ResidualPolarMotionPlotProps {
  xpData: number[];
  ypData: number[];
  dates: string[];
  rollingStats?: {
    turningPoints?: number[];
  } | null;
}

interface ResidualPoint {
  index: number;
  date: string;
  year: number;
  x: number;
  y: number;
  cx: number | null;
  cy: number | null;
}

const DAYS_PER_YEAR = 365.25;
const ROLLING_WINDOW = 365;

function toDay(date: string, fallback: number): number {
  const time = new Date(date).getTime();
  return Number.isFinite(time) ? time / 86400000 : fallback;
}

function linearFit(x: number[], y: number[]) {
  const n = Math.min(x.length, y.length);
  if (n < 2) {
    return { slope: 0, intercept: y[0] ?? 0 };
  }

  const meanX = x.reduce((sum, value) => sum + value, 0) / n;
  const meanY = y.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denominator = 0;

  for (let index = 0; index < n; index++) {
    const dx = x[index] - meanX;
    numerator += dx * (y[index] - meanY);
    denominator += dx * dx;
  }

  const slope = denominator > 0 ? numerator / denominator : 0;
  return { slope, intercept: meanY - slope * meanX };
}

function detrend(values: number[]) {
  const x = values.map((_, index) => index);
  const fit = linearFit(x, values);
  return values.map((value, index) => value - (fit.slope * index + fit.intercept));
}

function centredRollingMean(values: number[], window: number): Array<number | null> {
  const half = Math.floor(window / 2);
  const out: Array<number | null> = new Array(values.length).fill(null);
  let sum = 0;

  for (let index = 0; index < values.length; index++) {
    sum += values[index];
    if (index >= window) {
      sum -= values[index - window];
    }
    if (index >= window - 1) {
      out[index - half] = sum / window;
    }
  }

  return out;
}

function principalAxis(x: number[], y: number[]): [number, number] {
  const n = Math.min(x.length, y.length);
  if (n < 2) {
    return [1, 0];
  }

  const meanX = x.reduce((sum, value) => sum + value, 0) / n;
  const meanY = y.reduce((sum, value) => sum + value, 0) / n;
  let xx = 0;
  let yy = 0;
  let xy = 0;

  for (let index = 0; index < n; index++) {
    const dx = x[index] - meanX;
    const dy = y[index] - meanY;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }

  const trace = xx + yy;
  const det = xx * yy - xy * xy;
  const lambda = (trace + Math.sqrt(Math.max(trace * trace - 4 * det, 0))) / 2;
  let vx = Math.abs(xy) > 1e-12 ? xy : 1;
  let vy = Math.abs(xy) > 1e-12 ? lambda - xx : 0;
  const mag = Math.hypot(vx, vy) || 1;
  vx /= mag;
  vy /= mag;

  if (vx > 0) {
    vx = -vx;
    vy = -vy;
  }

  return [vx, vy];
}

function formatLongitudeHemisphere(lon: number) {
  const normalized = ((lon % 360) + 360) % 360;
  const eastWestLon = normalized > 180 ? normalized - 360 : normalized;
  const hemisphere = eastWestLon < 0 ? 'W' : 'E';

  return `${Math.abs(eastWestLon).toFixed(1)}°${hemisphere}`;
}

function eopDisplayLongitude(xPole: number, yPole: number) {
  return Math.atan2(yPole, xPole) * (180 / Math.PI);
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

function buildResidualSeries(xpData: number[], ypData: number[], dates: string[]) {
  const rows = dates
    .map((date, index) => ({
      index,
      date,
      day: toDay(date, index),
      xpMas: xpData[index] * 1000,
      ypMas: ypData[index] * 1000,
    }))
    .filter((row) => Number.isFinite(row.day) && Number.isFinite(row.xpMas) && Number.isFinite(row.ypMas))
    .sort((a, b) => a.day - b.day);

  if (rows.length < ROLLING_WINDOW + 2) {
    return { points: [] as ResidualPoint[], axis: [1, 0] as [number, number], axisAngle: 0, axisScale: 1 };
  }

  const originDay = rows[0].day;
  const relativeDays = rows.map((row) => row.day - originDay);
  const xFit = linearFit(relativeDays, rows.map((row) => row.xpMas));
  const yFit = linearFit(relativeDays, rows.map((row) => row.ypMas));
  const xResidual = rows.map((row, index) => row.xpMas - (xFit.slope * relativeDays[index] + xFit.intercept));
  const yResidual = rows.map((row, index) => row.ypMas - (yFit.slope * relativeDays[index] + yFit.intercept));
  const vx = detrend(xResidual.map((value) => value / DAYS_PER_YEAR));
  const vy = detrend(yResidual.map((value) => value / DAYS_PER_YEAR));

  const xPos: number[] = [];
  const yPos: number[] = [];
  let xSum = 0;
  let ySum = 0;

  for (let index = 0; index < rows.length; index++) {
    const dt = index === 0 ? 0 : Math.max(rows[index].day - rows[index - 1].day, 0);
    xSum += vx[index] * dt;
    ySum += vy[index] * dt;
    xPos.push(xSum);
    yPos.push(ySum);
  }

  const cx = centredRollingMean(xPos, ROLLING_WINDOW);
  const cy = centredRollingMean(yPos, ROLLING_WINDOW);
  const centroidX: number[] = [];
  const centroidY: number[] = [];

  cx.forEach((value, index) => {
    const yValue = cy[index];
    if (value !== null && yValue !== null && Number.isFinite(value) && Number.isFinite(yValue)) {
      centroidX.push(value);
      centroidY.push(yValue);
    }
  });

  const axis = principalAxis(centroidX, centroidY);
  const axisAngle = Math.atan2(axis[1], axis[0]) * 180 / Math.PI;
  const axisScale = Math.max(...xPos.map(Math.abs), ...yPos.map(Math.abs), 1) * 0.5;
  const points = rows.map((row, index) => ({
    index: row.index,
    date: row.date,
    year: decimalYear(row.date),
    x: xPos[index],
    y: yPos[index],
    cx: cx[index],
    cy: cy[index],
  }));

  return { points, axis, axisAngle, axisScale };
}

export default function ResidualPolarMotionPlot({ xpData, ypData, dates, rollingStats }: ResidualPolarMotionPlotProps) {
  const { timeRange, timeLockEnabled } = useTimeStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const fallbackHeight = usePlotDisplayHeight(620, 1800);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const measuredLimit = containerSize.width > 0 && containerSize.height > 0
    ? Math.min(containerSize.width, containerSize.height)
    : fallbackHeight;
  const plotSize = Math.round(Math.min(measuredLimit, fallbackHeight));
  const chartTitle = useChartTitle('Residual Polar Motion Phase Space (XY)', dates);
  const chartMarkers = useVisibleChartMarkers();
  const chartMarkerSize = useStore((state) => state.chartMarkerSize);
  const markerPlacementEnabled = useStore((state) => state.markerPlacementEnabled);
  const addChartMarker = useStore((state) => state.addChartMarker);
  const [colorScale, setColorScale] = useState(() => readPathColorScale('residual-polar-motion'));

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
    writePathColorScale('residual-polar-motion', colorScale);
  }, [colorScale]);

  useEffect(() => {
    const handleReset = () => setColorScale(DEFAULT_PATH_COLOR_SCALE);
    window.addEventListener(PATH_COLOR_SCALE_RESET_EVENT, handleReset);
    return () => window.removeEventListener(PATH_COLOR_SCALE_RESET_EVENT, handleReset);
  }, []);

  const residual = useMemo(
    () => buildResidualSeries(xpData, ypData, dates),
    [dates, xpData, ypData]
  );
  const turningPointIndices = useMemo(
    () => new Set(rollingStats?.turningPoints || []),
    [rollingStats]
  );

  const visiblePoints = useMemo(() => {
    if (!timeLockEnabled || !timeRange) {
      return residual.points;
    }

    const dataTimes = residual.points
      .map((point) => new Date(point.date).getTime())
      .filter(Number.isFinite);
    const dataStart = Math.min(...dataTimes);
    const dataEnd = Math.max(...dataTimes);

    if (!Number.isFinite(dataStart) || !Number.isFinite(dataEnd) || timeRange[1] < dataStart || timeRange[0] > dataEnd) {
      return residual.points;
    }

    return residual.points.filter((point) => {
      const ts = new Date(point.date).getTime();
      return Number.isFinite(ts) && ts >= timeRange[0] && ts <= timeRange[1];
    });
  }, [residual.points, timeLockEnabled, timeRange]);

  const traces = useMemo(() => {
    if (visiblePoints.length === 0) {
      return [];
    }

    const origin = visiblePoints[0];
    const displayPoints = visiblePoints.map((point) => ({
      ...point,
      displayX: point.x - origin.x,
      displayY: point.y - origin.y,
      displayCx: point.cx === null ? null : point.cx - origin.x,
      displayCy: point.cy === null ? null : point.cy - origin.y,
    }));
    const centroidPoints = displayPoints.filter((point) => point.displayCx !== null && point.displayCy !== null);
    const turningPoints = displayPoints.filter((point) => turningPointIndices.has(point.index));
    const axisLongitude = eopDisplayLongitude(residual.axis[0], residual.axis[1]);

    const data: Plotly.Data[] = [
      {
        x: displayPoints.map((point) => point.displayX),
        y: displayPoints.map((point) => point.displayY),
        customdata: displayPoints.map((point) => [point.date, point.displayX, point.displayY]),
        mode: 'markers',
        type: 'scatter',
        name: 'Residual path',
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
          opacity: 0.72,
        },
        hovertemplate: '%{customdata[0]}<br>x_res - start %{customdata[1]:.1f} mas<br>y_res - start %{customdata[2]:.1f} mas<extra></extra>',
      },
      {
        x: centroidPoints.map((point) => point.displayCx),
        y: centroidPoints.map((point) => point.displayCy),
        customdata: centroidPoints.map((point) => [point.date, point.displayCx, point.displayCy]),
        mode: 'lines',
        type: 'scatter',
        name: 'Centroid',
        line: { color: '#f8fafc', width: 3 },
        hovertemplate: 'Centroid<br>%{customdata[0]}<br>x_res - start %{customdata[1]:.1f} mas<br>y_res - start %{customdata[2]:.1f} mas<extra></extra>',
      },
      {
        x: [0, residual.axis[0] * residual.axisScale],
        y: [0, residual.axis[1] * residual.axisScale],
        mode: 'lines',
        type: 'scatter',
        name: `Axis (${formatLongitudeHemisphere(axisLongitude)})`,
        line: { color: '#ef4444', width: 6 },
        hovertemplate: 'PCA drift axis<br>x_res direction %{x:.1f} mas<br>y_res direction %{y:.1f} mas<extra></extra>',
      },
    ];

    if (turningPoints.length > 0) {
      data.push({
        x: turningPoints.map((point) => point.displayX),
        y: turningPoints.map((point) => point.displayY),
        customdata: turningPoints.map((point) => [point.date, point.displayX, point.displayY]),
        mode: 'markers',
        type: 'scatter',
        name: 'Turning points',
        marker: {
          size: 8,
          color: '#ef4444',
          opacity: 0.95,
          line: { color: '#fee2e2', width: 1 },
        },
        hovertemplate: 'Turning point %{customdata[0]}<br>x_res - start %{customdata[1]:.1f} mas<br>y_res - start %{customdata[2]:.1f} mas<extra></extra>',
      });
    }

    const markerPoints = chartMarkers
      .map((marker) => {
        const point = visiblePoints.reduce<ResidualPoint | null>((nearest, candidate) => {
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
      .filter((entry): entry is { marker: typeof chartMarkers[number]; point: ResidualPoint } => entry !== null);

    if (markerPoints.length > 0) {
      data.push({
        x: markerPoints.map(({ point }) => point.x - origin.x),
        y: markerPoints.map(({ point }) => point.y - origin.y),
        text: markerPoints.map(({ marker }) => marker.emoji),
        customdata: markerPoints.map(({ marker, point }) => [marker.label || marker.date, point.date, point.x - origin.x, point.y - origin.y]),
        mode: 'text',
        type: 'scatter',
        name: 'Markers',
        textfont: { size: chartMarkerSize },
        textposition: 'middle center',
        hovertemplate: '%{customdata[0]}<br>%{customdata[1]}<br>x_res - start %{customdata[2]:.1f} mas<br>y_res - start %{customdata[3]:.1f} mas<extra></extra>',
      });

      const labeledMarkers = markerPoints.filter(({ marker }) => getMarkerLabel(marker));
      if (labeledMarkers.length > 0) {
        data.push({
          x: labeledMarkers.map(({ point }) => point.x - origin.x),
          y: labeledMarkers.map(({ point }) => point.y - origin.y),
          text: labeledMarkers.map(({ marker }) => getMarkerLabel(marker)),
          customdata: labeledMarkers.map(({ marker, point }) => [marker.date, point.date, point.x - origin.x, point.y - origin.y]),
          mode: 'text',
          type: 'scatter',
          name: 'Marker labels',
          textfont: { size: getMarkerLabelSize(chartMarkerSize), color: '#fef3c7' },
          textposition: 'middle right',
          hovertemplate: '%{customdata[0]}<br>%{customdata[1]}<br>x_res - start %{customdata[2]:.1f} mas<br>y_res - start %{customdata[3]:.1f} mas<extra></extra>',
        });
      }
    }

    return data;
  }, [chartMarkerSize, chartMarkers, colorScale, residual.axis, residual.axisScale, turningPointIndices, visiblePoints]);

  const maxExtent = useMemo(() => {
    const origin = visiblePoints[0];
    if (!origin) {
      return Math.max(residual.axisScale * 1.15, 1);
    }

    const extents = visiblePoints.flatMap((point) => [
      Math.abs(point.x - origin.x),
      Math.abs(point.y - origin.y),
      point.cx === null ? 0 : Math.abs(point.cx - origin.x),
      point.cy === null ? 0 : Math.abs(point.cy - origin.y),
    ]);
    return Math.max(...extents, residual.axisScale * 1.15, 1);
  }, [residual.axisScale, visiblePoints]);

  if (traces.length === 0) {
    return (
      <div className="flex min-h-[520px] w-full items-center justify-center rounded-lg border border-[#374151] bg-[#111827]">
        <p className="text-[#9ca3af]">Residual phase-space data are not available for the selected range.</p>
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
            title: { text: 'x_res - path start (mas)', standoff: 18 },
            range: [-maxExtent, maxExtent],
            scaleanchor: 'y',
            scaleratio: 1,
            constrain: 'domain',
            gridcolor: '#374151',
            zerolinecolor: '#64748b',
          },
          yaxis: {
            title: { text: 'y_res - path start (mas)', standoff: 18 },
            range: [-maxExtent, maxExtent],
            constrain: 'domain',
            gridcolor: '#374151',
            zerolinecolor: '#64748b',
          },
          height: plotSize,
          margin: { l: 76, r: 96, t: 58, b: 76 },
          showlegend: true,
          legend: {
            orientation: 'h',
            yanchor: 'top',
            y: -0.14,
            xanchor: 'center',
            x: 0.5,
          },
          hovermode: 'closest',
          plot_bgcolor: '#111827',
          paper_bgcolor: '#0b1220',
          font: { color: '#e5e7eb' },
          autosize: true,
          uirevision: timeLockEnabled && timeRange ? `${timeRange[0]}-${timeRange[1]}` : 'residual-polar-free',
        } as any}
        config={createCsvExportConfig('residual-polar-motion-xy.csv', { displayModeBar: true, responsive: true, scrollZoom: true, doubleClick: 'reset+autosize' })}
        style={{ width: '100%', height: `${plotSize}px` }}
        useResizeHandler
        onClick={handleClick}
      />
    </div>
  );
}
