"use client";

import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import Plot from 'react-plotly.js';
import { useTimeStore } from '@/store/timeStore';
import { PanelFullscreenContext } from '@/components/LayoutPanel';
import { usePlotDisplayHeight } from '@/components/usePlotDisplayHeight';
import { createCsvExportConfig } from '@/lib/plotlyCsvExport';

interface PolarMotionTrajectoryPlotProps {
  xpData: number[];
  ypData: number[];
  dates: string[];
}

interface TrajectoryPoint {
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

export default function PolarMotionTrajectoryPlot({ xpData, ypData, dates }: PolarMotionTrajectoryPlotProps) {
  const { timeRange, timeLockEnabled } = useTimeStore();
  const isFullscreen = useContext(PanelFullscreenContext);
  const containerRef = useRef<HTMLDivElement>(null);
  const fallbackHeight = usePlotDisplayHeight(560, 1800);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const measuredLimit = isFullscreen && containerSize.width > 0 && containerSize.height > 0
    ? Math.min(containerSize.width, containerSize.height)
    : (containerSize.width || fallbackHeight);
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

  const points = useMemo(
    () => buildTrajectory(xpData, ypData, dates),
    [dates, xpData, ypData]
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

    return [
      {
        x: visiblePoints.map((point) => point.yPole),
        y: visiblePoints.map((point) => point.xPole),
        customdata: visiblePoints.map((point) => [point.date, point.xPole, point.yPole]),
        mode: 'lines+markers',
        type: 'scattergl',
        name: 'Polar motion path',
        line: { color: 'rgba(96, 165, 250, 0.45)', width: 1.4 },
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
          opacity: 0.78,
        },
        hovertemplate: '%{customdata[0]}<br>x pole (Greenwich/up) %{customdata[1]:.1f} mas<br>y pole (90°W/left) %{customdata[2]:.1f} mas<extra></extra>',
      },
    ] as Plotly.Data[];
  }, [visiblePoints]);

  const axisRanges = useMemo(() => {
    if (visiblePoints.length === 0) {
      return { x: [-1, 1], y: [-1, 1] };
    }

    const xValues = visiblePoints.map((point) => point.yPole);
    const yValues = visiblePoints.map((point) => point.xPole);
    const xMin = Math.min(...xValues);
    const xMax = Math.max(...xValues);
    const yMin = Math.min(...yValues);
    const yMax = Math.max(...yValues);
    const xMid = (xMin + xMax) / 2;
    const yMid = (yMin + yMax) / 2;
    const half = Math.max((xMax - xMin) / 2, (yMax - yMin) / 2, 1) * 1.08;

    return {
      x: [xMid + half, xMid - half],
      y: [yMid - half, yMid + half],
    };
  }, [visiblePoints]);

  if (traces.length === 0) {
    return (
      <div className="flex min-h-[460px] w-full items-center justify-center rounded-lg border border-[#374151] bg-[#111827]">
        <p className="text-[#9ca3af]">Polar-motion trajectory data are not available for the selected range.</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full w-full min-w-0">
      <Plot
        data={traces}
        layout={{
          title: { text: 'Polar Motion Trajectory' },
          xaxis: {
            title: { text: 'y pole (mas, +90°W left)', standoff: 18 },
            range: axisRanges.x,
            scaleanchor: 'y',
            scaleratio: 1,
            constrain: 'domain',
            gridcolor: '#374151',
            zerolinecolor: '#64748b',
          },
          yaxis: {
            title: { text: 'x pole (mas, +Greenwich up)', standoff: 18 },
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
      />
    </div>
  );
}
