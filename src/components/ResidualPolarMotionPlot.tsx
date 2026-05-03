"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import Plot from 'react-plotly.js';
import { useTimeStore } from '@/store/timeStore';
import { usePlotDisplayHeight } from '@/components/usePlotDisplayHeight';
import { createCsvExportConfig } from '@/lib/plotlyCsvExport';

interface ResidualPolarMotionPlotProps {
  xpData: number[];
  ypData: number[];
  dates: string[];
}

interface ResidualPoint {
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
  return Math.atan2(-yPole, xPole) * (180 / Math.PI);
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
    date: row.date,
    year: decimalYear(row.date),
    x: xPos[index],
    y: yPos[index],
    cx: cx[index],
    cy: cy[index],
  }));

  return { points, axis, axisAngle, axisScale };
}

export default function ResidualPolarMotionPlot({ xpData, ypData, dates }: ResidualPolarMotionPlotProps) {
  const { timeRange, timeLockEnabled } = useTimeStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const fallbackHeight = usePlotDisplayHeight(620, 1800);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const measuredLimit = containerSize.width > 0 && containerSize.height > 0
    ? Math.min(containerSize.width, containerSize.height)
    : fallbackHeight;
  const plotSize = Math.round(Math.min(measuredLimit, fallbackHeight));

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

  const residual = useMemo(
    () => buildResidualSeries(xpData, ypData, dates),
    [dates, xpData, ypData]
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

    const centroidPoints = visiblePoints.filter((point) => point.cx !== null && point.cy !== null);
    const axisLongitude = eopDisplayLongitude(residual.axis[0], residual.axis[1]);

    return [
      {
        x: visiblePoints.map((point) => point.y),
        y: visiblePoints.map((point) => point.x),
        customdata: visiblePoints.map((point) => [point.date, point.x, point.y]),
        mode: 'markers',
        type: 'scatter',
        name: 'Residual path',
        marker: {
          size: 4,
          color: visiblePoints.map((point) => point.year),
          colorscale: 'Viridis',
          showscale: true,
          colorbar: {
            title: { text: 'Calendar year', side: 'right' },
            thickness: 14,
            len: 0.82,
          },
          opacity: 0.72,
        },
        hovertemplate: '%{customdata[0]}<br>x_res (Greenwich/up) %{customdata[1]:.1f} mas<br>y_res (90°W/left) %{customdata[2]:.1f} mas<extra></extra>',
      },
      {
        x: centroidPoints.map((point) => point.cy),
        y: centroidPoints.map((point) => point.cx),
        customdata: centroidPoints.map((point) => [point.date, point.cx, point.cy]),
        mode: 'lines',
        type: 'scatter',
        name: 'Centroid',
        line: { color: '#f8fafc', width: 3 },
        hovertemplate: 'Centroid<br>%{customdata[0]}<br>x_res (Greenwich/up) %{customdata[1]:.1f} mas<br>y_res (90°W/left) %{customdata[2]:.1f} mas<extra></extra>',
      },
      {
        x: [0, residual.axis[1] * residual.axisScale],
        y: [0, residual.axis[0] * residual.axisScale],
        mode: 'lines',
        type: 'scatter',
        name: `Axis (${formatLongitudeHemisphere(axisLongitude)})`,
        line: { color: '#ef4444', width: 6 },
        hovertemplate: 'PCA drift axis<br>x_res (Greenwich/up) %{y:.1f} mas<br>y_res (90°W/left) %{x:.1f} mas<extra></extra>',
      },
    ] as Plotly.Data[];
  }, [residual.axis, residual.axisScale, visiblePoints]);

  const maxExtent = useMemo(() => {
    const extents = visiblePoints.flatMap((point) => [Math.abs(point.x), Math.abs(point.y)]);
    return Math.max(...extents, residual.axisScale * 1.15, 1);
  }, [residual.axisScale, visiblePoints]);

  if (traces.length === 0) {
    return (
      <div className="flex min-h-[520px] w-full items-center justify-center rounded-lg border border-[#374151] bg-[#111827]">
        <p className="text-[#9ca3af]">Residual phase-space data are not available for the selected range.</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full w-full min-w-0">
      <Plot
        data={traces}
        layout={{
          title: { text: 'Residual Polar Motion Phase Space (XY)' },
          xaxis: {
            title: { text: 'y_res (mas, +90°W left)', standoff: 18 },
            range: [maxExtent, -maxExtent],
            scaleanchor: 'y',
            scaleratio: 1,
            constrain: 'domain',
            gridcolor: '#374151',
            zerolinecolor: '#64748b',
          },
          yaxis: {
            title: { text: 'x_res (mas, +Greenwich up)', standoff: 18 },
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
      />
    </div>
  );
}
