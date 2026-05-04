"use client";

import { useMemo, useRef } from 'react';
import Plot from 'react-plotly.js';
import { useTimeStore } from '@/store/timeStore';
import { extractPlotlyDateRange } from '@/lib/timeRange';
import { usePlotDisplayHeight } from '@/components/usePlotDisplayHeight';
import { createCsvExportConfig } from '@/lib/plotlyCsvExport';

interface LoopCenterAngularVelocityPlotProps {
  xpData: number[];
  ypData: number[];
  dates: string[];
}

interface ResidualPoint {
  date: string;
  day: number;
  year: number;
  x: number;
  y: number;
}

const DAYS_PER_YEAR = 365.25;
const PEAK_DISTANCE_DAYS = 200;
const LOW_CONFIDENCE_CENTER_RADIUS = 25;

function toDay(date: string, fallback: number): number {
  const time = new Date(date).getTime();
  return Number.isFinite(time) ? time / 86400000 : fallback;
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

function dateFromMidpoint(dayA: number, dayB: number): string {
  const midpoint = 0.5 * (dayA + dayB);
  return new Date(midpoint * 86400000).toISOString().slice(0, 10);
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

function median(values: number[]) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) {
    return NaN;
  }

  const mid = Math.floor(finite.length / 2);
  return finite.length % 2 === 0 ? 0.5 * (finite[mid - 1] + finite[mid]) : finite[mid];
}

function standardDeviation(values: number[]) {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) {
    return 0;
  }

  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  const variance = finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / finite.length;
  return Math.sqrt(variance);
}

function unwrap(values: number[]) {
  if (values.length === 0) {
    return [];
  }

  const out = [...values];
  for (let index = 1; index < out.length; index++) {
    let diff = out[index] - out[index - 1];
    while (diff > Math.PI) {
      out[index] -= 2 * Math.PI;
      diff = out[index] - out[index - 1];
    }
    while (diff < -Math.PI) {
      out[index] += 2 * Math.PI;
      diff = out[index] - out[index - 1];
    }
  }

  return out;
}

function solve3x3(matrix: number[][], rhs: number[]) {
  const a = matrix.map((row, index) => [...row, rhs[index]]);

  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) {
        pivot = row;
      }
    }

    if (Math.abs(a[pivot][col]) < 1e-12) {
      return null;
    }

    [a[col], a[pivot]] = [a[pivot], a[col]];
    const divisor = a[col][col];
    for (let j = col; j < 4; j++) {
      a[col][j] /= divisor;
    }

    for (let row = 0; row < 3; row++) {
      if (row === col) {
        continue;
      }
      const factor = a[row][col];
      for (let j = col; j < 4; j++) {
        a[row][j] -= factor * a[col][j];
      }
    }
  }

  return [a[0][3], a[1][3], a[2][3]];
}

function quadraticSmooth(values: number[], maxWindow = 9) {
  const n = values.length;
  if (n < 5) {
    return [...values];
  }

  const window = Math.max(5, Math.min(maxWindow, n % 2 === 0 ? n - 1 : n));
  const half = Math.floor(window / 2);

  return values.map((value, index) => {
    const start = Math.max(0, Math.min(index - half, n - window));
    const end = Math.min(n, start + window);
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    let s4 = 0;
    let y0 = 0;
    let y1 = 0;
    let y2 = 0;

    for (let i = start; i < end; i++) {
      const x = i - index;
      const y = values[i];
      if (!Number.isFinite(y)) {
        continue;
      }
      const x2 = x * x;
      s0 += 1;
      s1 += x;
      s2 += x2;
      s3 += x2 * x;
      s4 += x2 * x2;
      y0 += y;
      y1 += x * y;
      y2 += x2 * y;
    }

    const solution = solve3x3(
      [
        [s0, s1, s2],
        [s1, s2, s3],
        [s2, s3, s4],
      ],
      [y0, y1, y2]
    );

    return solution ? solution[0] : value;
  });
}

function buildResidualSeries(xpData: number[], ypData: number[], dates: string[]) {
  const rows = dates
    .map((date, index) => ({
      date,
      day: toDay(date, index),
      year: decimalYear(date),
      xpMas: xpData[index] * 1000,
      ypMas: ypData[index] * 1000,
    }))
    .filter((row) => Number.isFinite(row.day) && Number.isFinite(row.year) && Number.isFinite(row.xpMas) && Number.isFinite(row.ypMas))
    .sort((a, b) => a.day - b.day);

  if (rows.length < PEAK_DISTANCE_DAYS * 2) {
    return [];
  }

  const originDay = rows[0].day;
  const relativeDays = rows.map((row) => row.day - originDay);
  const xFit = linearFit(relativeDays, rows.map((row) => row.xpMas));
  const yFit = linearFit(relativeDays, rows.map((row) => row.ypMas));
  const xResidual = rows.map((row, index) => row.xpMas - (xFit.slope * relativeDays[index] + xFit.intercept));
  const yResidual = rows.map((row, index) => row.ypMas - (yFit.slope * relativeDays[index] + yFit.intercept));
  const vx = detrend(xResidual.map((value) => value / DAYS_PER_YEAR));
  const vy = detrend(yResidual.map((value) => value / DAYS_PER_YEAR));

  let xSum = 0;
  let ySum = 0;
  return rows.map((row, index) => {
    const dt = index === 0 ? 0 : Math.max(row.day - rows[index - 1].day, 0);
    xSum += vx[index] * dt;
    ySum += vy[index] * dt;
    return {
      date: row.date,
      day: row.day,
      year: row.year,
      x: xSum,
      y: ySum,
    };
  });
}

function detectLoopPeaks(points: ResidualPoint[]) {
  const radius = points.map((point) => Math.hypot(point.x, point.y));
  const minDistance = PEAK_DISTANCE_DAYS;
  const prominenceThreshold = standardDeviation(radius) * 0.2;
  const candidates: Array<{ index: number; radius: number }> = [];

  for (let index = 1; index < radius.length - 1; index++) {
    if (radius[index] <= radius[index - 1] || radius[index] <= radius[index + 1]) {
      continue;
    }

    const leftStart = Math.max(0, index - minDistance);
    const rightEnd = Math.min(radius.length, index + minDistance + 1);
    const leftMin = Math.min(...radius.slice(leftStart, index + 1));
    const rightMin = Math.min(...radius.slice(index, rightEnd));
    const localProminence = radius[index] - Math.max(leftMin, rightMin);

    if (localProminence >= prominenceThreshold) {
      candidates.push({ index, radius: radius[index] });
    }
  }

  const selected: Array<{ index: number; radius: number }> = [];
  candidates
    .sort((a, b) => b.radius - a.radius)
    .forEach((candidate) => {
      if (selected.every((peak) => Math.abs(points[peak.index].day - points[candidate.index].day) >= minDistance)) {
        selected.push(candidate);
      }
    });

  return selected.sort((a, b) => a.index - b.index).map((peak) => peak.index);
}

function computeAngularVelocity(xpData: number[], ypData: number[], dates: string[]) {
  const points = buildResidualSeries(xpData, ypData, dates);
  const peaks = detectLoopPeaks(points);
  const centerX: number[] = [];
  const centerY: number[] = [];
  const centerYears: number[] = [];
  const centerDays: number[] = [];

  const addCenter = (start: number, end: number) => {
    const segment = points.slice(start, end);
    if (segment.length < 10) {
      return;
    }

    centerX.push(segment.reduce((sum, point) => sum + point.x, 0) / segment.length);
    centerY.push(segment.reduce((sum, point) => sum + point.y, 0) / segment.length);
    centerYears.push(points[start].year);
    centerDays.push(points[start].day);
  };

  for (let index = 0; index < peaks.length - 1; index++) {
    const start = peaks[index];
    const end = peaks[index + 1];
    addCenter(start, end);
  }

  const lastPeak = peaks[peaks.length - 1];
  const hasLivePartial = Number.isFinite(lastPeak) && lastPeak < points.length - 10;

  if (centerYears.length < 5) {
    return { traces: [] as Plotly.Data[], yRange: undefined as [number, number] | undefined, pointCount: 0 };
  }

  const theta = unwrap(centerX.map((x, index) => Math.atan2(centerY[index], x)));
  const tMidYears: number[] = [];
  const tMidDates: string[] = [];
  const omegaRaw: number[] = [];

  for (let index = 0; index < theta.length - 1; index++) {
    const dt = centerYears[index + 1] - centerYears[index];
    if (dt <= 0) {
      continue;
    }
    tMidYears.push(0.5 * (centerYears[index] + centerYears[index + 1]));
    tMidDates.push(dateFromMidpoint(centerDays[index], centerDays[index + 1]));
    omegaRaw.push((theta[index + 1] - theta[index]) / dt);
  }

  const omegaSmooth = quadraticSmooth(omegaRaw, 9);
  const residual = omegaRaw.map((value, index) => value - omegaSmooth[index]);
  const residualMedian = median(residual);
  const mad = median(residual.map((value) => Math.abs(value - residualMedian)));
  const sigma = Number.isFinite(mad) ? 1.4826 * mad : 0;
  const upper = omegaSmooth.map((value) => value + 2 * sigma);
  const lower = omegaSmooth.map((value) => value - 2 * sigma);

  const customdata = tMidYears.map((year, index) => [year, omegaRaw[index], lower[index], upper[index]]);

  const bandTrace: Plotly.Data = {
    x: [...tMidDates, ...tMidDates.slice().reverse()],
    y: [...upper, ...lower.slice().reverse()],
    type: 'scatter',
    mode: 'lines',
    fill: 'toself',
    fillcolor: 'rgba(96, 165, 250, 0.24)',
    line: { color: 'rgba(96, 165, 250, 0)' },
    hoverinfo: 'skip',
    name: '±2σ robust band',
  };

  const velocityTrace: Plotly.Data = {
    x: tMidDates,
    y: omegaSmooth,
    customdata,
    type: 'scatter',
    mode: 'lines',
    name: 'ω(t), completed loops',
    line: { color: '#38bdf8', width: 3 },
    hovertemplate: 'Year %{customdata[0]:.2f}<br>ω %{y:.4f} rad/year<br>raw %{customdata[1]:.4f}<br>±2σ [%{customdata[2]:.4f}, %{customdata[3]:.4f}]<extra></extra>',
  };

  const traces: Plotly.Data[] = [bandTrace, velocityTrace];
  const yValues = [...lower, ...upper, ...omegaSmooth, 0];

  if (hasLivePartial) {
    const liveSegment = points.slice(lastPeak, points.length);
    const liveCenterX = liveSegment.reduce((sum, point) => sum + point.x, 0) / liveSegment.length;
    const liveCenterY = liveSegment.reduce((sum, point) => sum + point.y, 0) / liveSegment.length;
    const liveCenterRadius = Math.hypot(liveCenterX, liveCenterY);
    const latestPoint = points[points.length - 1];
    let liveTheta = Math.atan2(liveCenterY, liveCenterX);
    const previousTheta = theta[theta.length - 1];

    while (liveTheta - previousTheta > Math.PI) {
      liveTheta -= 2 * Math.PI;
    }
    while (liveTheta - previousTheta < -Math.PI) {
      liveTheta += 2 * Math.PI;
    }

    const liveDt = latestPoint.year - centerYears[centerYears.length - 1];
    if (liveDt > 0) {
      const liveYear = 0.5 * (centerYears[centerYears.length - 1] + latestPoint.year);
      const liveDate = dateFromMidpoint(centerDays[centerDays.length - 1], latestPoint.day);
      const liveOmega = (liveTheta - previousTheta) / liveDt;
      const angularSensitivity = liveCenterRadius > 0 ? 1 / liveCenterRadius / liveDt : 0;
      const liveOmegaError = Math.hypot(2 * sigma, angularSensitivity);
      const liveConfidenceLabel = liveCenterRadius < LOW_CONFIDENCE_CENTER_RADIUS
        ? 'low-confidence provisional'
        : 'provisional';
      yValues.push(liveOmega - liveOmegaError, liveOmega, liveOmega + liveOmegaError);

      traces.push({
        x: [tMidDates[tMidDates.length - 1], liveDate],
        y: [omegaSmooth[omegaSmooth.length - 1], liveOmega],
        customdata: [
          [tMidYears[tMidYears.length - 1], omegaRaw[omegaRaw.length - 1], 'completed', null, null, null],
          [liveYear, liveOmega, liveConfidenceLabel, liveOmegaError, liveCenterRadius, liveSegment.length],
        ],
        type: 'scatter',
        mode: 'text+lines+markers',
        name: liveConfidenceLabel,
        line: { color: '#f59e0b', width: 2, dash: 'dash' },
        marker: { color: '#f59e0b', size: [0, 7] },
        text: ['', liveConfidenceLabel],
        textfont: { color: '#fbbf24', size: 11 },
        textposition: 'top right',
        error_y: {
          type: 'data',
          array: [0, liveOmegaError],
          visible: true,
          color: '#f59e0b',
          thickness: 1.5,
          width: 6,
        },
        hovertemplate: 'Year %{customdata[0]:.2f}<br>ω %{y:.4f} ± %{customdata[3]:.4f} rad/year<br>%{customdata[2]}<br>center radius %{customdata[4]:.2f} mas<br>partial samples %{customdata[5]}<extra></extra>',
      });
    }
  }

  const zeroTrace: Plotly.Data = {
    x: [tMidDates[0], tMidDates[tMidDates.length - 1]],
    y: [0, 0],
    type: 'scatter',
    mode: 'lines',
    name: 'zero',
    line: { color: '#60a5fa', width: 1.5, dash: 'dash' },
    hoverinfo: 'skip',
  };
  traces.push(zeroTrace);

  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);
  const padding = Math.max((yMax - yMin) * 0.08, 0.02);

  return {
    traces,
    yRange: [yMin - padding, yMax + padding] as [number, number],
    pointCount: tMidDates.length,
  };
}

export default function LoopCenterAngularVelocityPlot({ xpData, ypData, dates }: LoopCenterAngularVelocityPlotProps) {
  const { timeRange, timeLockEnabled, setTimeRange } = useTimeStore();
  const isInternalUpdate = useRef(false);
  const plotHeight = usePlotDisplayHeight(500, 860);
  const velocity = useMemo(() => computeAngularVelocity(xpData, ypData, dates), [dates, xpData, ypData]);

  const handleRelayout = (event: any) => {
    if (isInternalUpdate.current || !timeLockEnabled) return;
    const range = extractPlotlyDateRange(event);
    if (!range) return;
    isInternalUpdate.current = true;
    setTimeRange(range);
    setTimeout(() => { isInternalUpdate.current = false; }, 0);
  };

  const layout = useMemo(() => {
    const axisRange = timeLockEnabled && timeRange
      ? [new Date(timeRange[0]), new Date(timeRange[1])]
      : undefined;

    return {
      title: { text: 'Angular Velocity of Loop-Center Evolution' } as any,
      xaxis: {
        title: { text: 'Year', standoff: 20 },
        gridcolor: '#4b5563',
        zerolinecolor: '#64748b',
        tickformat: '%Y',
        range: axisRange,
      },
      yaxis: {
        title: { text: 'Angular velocity (rad/year)', standoff: 20 },
        gridcolor: '#4b5563',
        zerolinecolor: '#64748b',
        range: velocity.yRange,
      },
      height: plotHeight,
      showlegend: true,
      legend: {
        orientation: 'h' as const,
        yanchor: 'top' as const,
        y: -0.16,
        xanchor: 'center' as const,
        x: 0.5,
      },
      plot_bgcolor: '#111827',
      paper_bgcolor: '#0b1220',
      font: { color: '#e5e7eb' },
      margin: { l: 78, r: 28, t: 56, b: 62 },
      autosize: true,
      uirevision: axisRange
        ? `${axisRange[0].toISOString()}-${axisRange[1].toISOString()}`
        : 'loop-center-angular-velocity-free-zoom',
    };
  }, [plotHeight, timeLockEnabled, timeRange, velocity.yRange]);

  if (velocity.traces.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-lg border border-[#374151] bg-[#111827]">
        <p className="text-[#9ca3af]">Loading loop-center angular velocity...</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full min-w-0">
      <Plot
        data={velocity.traces}
        layout={layout}
        onRelayout={handleRelayout}
        config={createCsvExportConfig('loop-center-angular-velocity.csv', { displayModeBar: true, responsive: true, scrollZoom: true, doubleClick: 'reset+autosize' })}
        style={{ width: '100%', height: `${plotHeight}px` }}
        useResizeHandler
      />
    </div>
  );
}
