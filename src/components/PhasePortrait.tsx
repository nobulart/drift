"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import Plot from 'react-plotly.js';
import { usePlotDisplayHeight } from '@/components/usePlotDisplayHeight';
import { buildPhasePortraitSeries, computeDisplayOmega } from '@/lib/phase';
import { createCsvExportConfig } from '@/lib/plotlyCsvExport';

interface PhasePortraitProps {
  dates: string[];
  theta: number[];
  omega: number[];
  turningPoints?: number[];
}

export default function PhasePortrait({
  dates,
  theta,
  omega,
  turningPoints = []
}: PhasePortraitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fallbackHeight = usePlotDisplayHeight(500, 860);
  const [containerWidth, setContainerWidth] = useState(0);
  const plotSize = Math.round(containerWidth > 0 ? Math.min(containerWidth, fallbackHeight) : fallbackHeight);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const traces = useMemo(() => {
    if (theta.length === 0 || omega.length === 0) {
      return [];
    }

    const displayOmega = computeDisplayOmega(theta, omega, dates);

    const validIndices = theta.reduce<number[]>((acc, thetaValue, index) => {
      const omegaValue = displayOmega[index];
      if (Number.isFinite(thetaValue) && Number.isFinite(omegaValue)) {
        acc.push(index);
      }
      return acc;
    }, []);

    if (validIndices.length === 0) {
      return [];
    }

    const portraitSeries = buildPhasePortraitSeries(theta, displayOmega, dates);
    const portraitTrace: Plotly.Data = {
      x: portraitSeries.x,
      y: portraitSeries.y,
      customdata: portraitSeries.customdata,
      mode: 'lines+markers',
      type: 'scatter',
      name: 'Phase Portrait',
      line: { color: '#3b82f6', width: 1.5 },
      marker: { size: 3, color: 'rgba(59, 130, 246, 0.45)' },
      hovertemplate: '%{customdata}<br>θ %{x:.3f}<br>ω %{y:.4f}<extra></extra>'
    };

    const data: Plotly.Data[] = [portraitTrace];

    const latestIndex = validIndices[validIndices.length - 1];
    const latestDate = dates[latestIndex] ? new Date(dates[latestIndex]) : null;
    const recentIndices =
      latestDate && !Number.isNaN(latestDate.getTime())
        ? validIndices.filter((index) => {
            const pointDate = dates[index] ? new Date(dates[index]) : null;
            if (!pointDate || Number.isNaN(pointDate.getTime())) {
              return false;
            }
            return latestDate.getTime() - pointDate.getTime() <= 180 * 24 * 60 * 60 * 1000;
          })
        : validIndices.slice(Math.max(0, validIndices.length - 180));

    if (recentIndices.length > 1) {
      const recentTheta = recentIndices.map((index) => theta[index]);
      const recentOmega = recentIndices.map((index) => displayOmega[index]);
      const recentDates = recentIndices.map((index) => dates[index] ?? 'Unknown date');
      const recentSeries = buildPhasePortraitSeries(recentTheta, recentOmega, recentDates);
      data.push({
        x: recentSeries.x,
        y: recentSeries.y,
        customdata: recentSeries.customdata,
        mode: 'lines',
        type: 'scatter',
        name: 'Recent 180d Trajectory',
        line: { color: '#f59e0b', width: 3 },
        hovertemplate: 'Recent trail<br>%{customdata}<br>θ %{x:.3f}<br>ω %{y:.4f}<extra></extra>'
      });
    }

    data.push({
      x: [theta[latestIndex]],
      y: [displayOmega[latestIndex]],
      mode: 'markers',
      type: 'scatter',
      name: 'Present State',
      marker: {
        color: '#f8fafc',
        size: 13,
        symbol: 'diamond',
        line: { color: '#f59e0b', width: 2.5 }
      },
      hovertemplate: `${dates[latestIndex] ?? 'Latest sample'}<br>θ %{x:.3f}<br>ω %{y:.4f}<extra></extra>`
    });

    if (turningPoints.length > 0) {
      const validTurningPoints = turningPoints.filter((index) =>
        Number.isFinite(theta[index]) && Number.isFinite(displayOmega[index])
      );

      if (validTurningPoints.length > 0) {
        data.push({
          x: validTurningPoints.map((index) => theta[index]),
          y: validTurningPoints.map((index) => displayOmega[index]),
          customdata: validTurningPoints.map((index) => dates[index] ?? 'Unknown date'),
          mode: 'markers',
          type: 'scatter',
          name: 'Turning Points',
          marker: { color: '#ef4444', size: 8, symbol: 'circle-solid' },
          hovertemplate: 'Turning point<br>%{customdata}<br>θ %{x:.3f}<br>ω %{y:.4f}<extra></extra>'
        });
      }
    }

    return data;
  }, [dates, omega, theta, turningPoints]);

  const layout = {
    title: { text: 'Phase Portrait: θ vs ω' } as any,
    xaxis: { 
      title: { text: 'Phase Angle θ (radians)', standoff: 20 },
      gridcolor: '#374151',
      zerolinecolor: '#4b5563'
    },
    yaxis: { 
      title: { text: 'Angular Velocity ω (rad/day)', standoff: 20 },
      gridcolor: '#374151',
      zerolinecolor: '#4b5563'
    },
    height: plotSize,
    showlegend: true,
    legend: {
      orientation: 'h',
      yanchor: 'top',
      y: -0.15,
      xanchor: 'center',
      x: 0.5
    },
    hovermode: 'closest',
    plot_bgcolor: '#111827',
    paper_bgcolor: '#0b1220',
    font: { color: '#e5e7eb' },
    autosize: true,
  } as any;

  if (traces.length === 0) {
    return (
      <div className="flex items-center justify-center h-full w-full bg-[#111827] rounded-lg border border-[#374151]">
        <p className="text-[#9ca3af]">Loading...</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full w-full min-w-0">
      <Plot
        data={traces}
        layout={layout}
        config={createCsvExportConfig('phase-portrait.csv', { displayModeBar: true, responsive: true })}
        style={{ width: '100%', height: `${plotSize}px` }}
        useResizeHandler
      />
    </div>
  );
}
