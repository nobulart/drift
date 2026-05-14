"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import Plot from 'react-plotly.js';
import { usePlotDisplayHeight } from '@/components/usePlotDisplayHeight';
import { buildPhasePortraitSeries, computeDisplayOmega } from '@/lib/phase';
import { createCsvExportConfig } from '@/lib/plotlyCsvExport';
import { useChartTitle } from '@/lib/chartTitles';
import { findNearestDateIndex, getMarkerLabel, getMarkerLabelSize, getPlotPointDate, useVisibleChartMarkers } from '@/lib/chartMarkers';
import { useStore } from '@/store/useStore';

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
  const [showEnvelope, setShowEnvelope] = useState(true);
  const [envelopeLevel, setEnvelopeLevel] = useState(2);
  const [recentColorBy, setRecentColorBy] = useState<'none' | 'zOmega' | 'curvature' | 'manifold' | 'coupling'>('none');
  const plotSize = Math.round(containerWidth > 0 ? Math.min(containerWidth, fallbackHeight) : fallbackHeight);
  const chartTitle = useChartTitle('Phase Portrait: theta vs omega', dates);
  const phaseStability = useStore((state) => state.rollingStats?.phaseStability);
  const chartMarkers = useVisibleChartMarkers();
  const chartMarkerSize = useStore((state) => state.chartMarkerSize);
  const markerPlacementEnabled = useStore((state) => state.markerPlacementEnabled);
  const addChartMarker = useStore((state) => state.addChartMarker);

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

    const data: Plotly.Data[] = [];

    if (showEnvelope && phaseStability?.envelope?.length) {
      const envelope = phaseStability.envelope.filter(bin => bin.muOmega !== null && bin.sigmaOmega !== null);
      const thetaEnvelope = envelope.map(bin => bin.theta);
      const upper = envelope.map(bin => (bin.muOmega ?? 0) + envelopeLevel * (bin.sigmaOmega ?? 0));
      const lower = envelope.map(bin => (bin.muOmega ?? 0) - envelopeLevel * (bin.sigmaOmega ?? 0));

      data.push({
        x: [...thetaEnvelope, ...thetaEnvelope.slice().reverse()],
        y: [...upper, ...lower.slice().reverse()],
        type: 'scatter',
        mode: 'lines',
        name: `Historical ±${envelopeLevel}σ envelope`,
        fill: 'toself',
        fillcolor: 'rgba(56, 189, 248, 0.12)',
        line: { color: 'rgba(56, 189, 248, 0.20)', width: 1 },
        hoverinfo: 'skip',
      });
      data.push({
        x: thetaEnvelope,
        y: envelope.map(bin => bin.muOmega),
        type: 'scatter',
        mode: 'lines',
        name: 'Historical median ω|θ',
        line: { color: 'rgba(125, 211, 252, 0.85)', width: 1.3 },
        hovertemplate: 'Historical corridor<br>θ %{x:.3f}<br>median ω %{y:.4f}<extra></extra>',
      });
    }

    data.push(portraitTrace);

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

      if (recentColorBy !== 'none' && phaseStability?.samples?.length) {
        const values = recentIndices.map((index) => {
          const sample = phaseStability.samples[index];
          switch (recentColorBy) {
            case 'zOmega':
              return sample?.zOmega ?? NaN;
            case 'curvature':
              return sample?.curvatureNorm ?? NaN;
            case 'manifold':
              return sample?.manifoldDeparture ?? NaN;
            case 'coupling':
              return sample?.couplingStabilityIndex ?? NaN;
            default:
              return NaN;
          }
        });
        data.push({
          x: recentTheta,
          y: recentOmega,
          customdata: recentDates.map((date, index) => [date, values[index]]),
          mode: 'markers',
          type: 'scatter',
          name: `Recent colored by ${recentColorBy}`,
          marker: {
            size: 6,
            color: values,
            colorscale: recentColorBy === 'zOmega'
              ? [[0, '#22c55e'], [0.5, '#f59e0b'], [1, '#a855f7']]
              : [[0, '#0f766e'], [0.5, '#f97316'], [1, '#a855f7']],
            cmin: recentColorBy === 'zOmega' ? -3.5 : 0,
            cmax: recentColorBy === 'zOmega' ? 3.5 : 1,
            colorbar: { title: { text: recentColorBy } },
            line: { color: 'rgba(15, 23, 42, 0.8)', width: 0.5 },
          },
          hovertemplate: '%{customdata[0]}<br>color %{customdata[1]:.3f}<br>θ %{x:.3f}<br>ω %{y:.4f}<extra></extra>'
        });
      }
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

    const markerPoints = chartMarkers
      .map((marker) => {
        const index = findNearestDateIndex(dates, marker.date);
        if (index < 0 || !Number.isFinite(theta[index]) || !Number.isFinite(displayOmega[index])) {
          return null;
        }

        return { marker, index };
      })
      .filter((entry): entry is { marker: typeof chartMarkers[number]; index: number } => entry !== null);

    if (markerPoints.length > 0) {
      data.push({
        x: markerPoints.map(({ index }) => theta[index]),
        y: markerPoints.map(({ index }) => displayOmega[index]),
        text: markerPoints.map(({ marker }) => marker.emoji),
        customdata: markerPoints.map(({ marker, index }) => [marker.label || marker.date, dates[index]]),
        mode: 'text',
        type: 'scatter',
        name: 'Markers',
        textfont: { size: chartMarkerSize },
        textposition: 'middle center',
        hovertemplate: '%{customdata[0]}<br>%{customdata[1]}<br>θ %{x:.3f}<br>ω %{y:.4f}<extra></extra>',
      });

      const labeledMarkers = markerPoints.filter(({ marker }) => getMarkerLabel(marker));
      if (labeledMarkers.length > 0) {
        data.push({
          x: labeledMarkers.map(({ index }) => theta[index]),
          y: labeledMarkers.map(({ index }) => displayOmega[index]),
          text: labeledMarkers.map(({ marker }) => getMarkerLabel(marker)),
          customdata: labeledMarkers.map(({ marker, index }) => [marker.date, dates[index]]),
          mode: 'text',
          type: 'scatter',
          name: 'Marker labels',
          textfont: { size: getMarkerLabelSize(chartMarkerSize), color: '#fef3c7' },
          textposition: 'middle right',
          hovertemplate: '%{customdata[0]}<br>%{customdata[1]}<extra></extra>',
        });
      }
    }

    return data;
  }, [chartMarkerSize, chartMarkers, dates, envelopeLevel, omega, phaseStability, recentColorBy, showEnvelope, theta, turningPoints]);

  const layout = {
    title: chartTitle as any,
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

  const handleClick = (event: Readonly<Plotly.PlotMouseEvent>) => {
    if (!markerPlacementEnabled) return;
    const date = getPlotPointDate(event);
    if (date) addChartMarker(date);
  };

  return (
    <div ref={containerRef} className="h-full w-full min-w-0">
      <div className="mb-3 flex flex-wrap items-center gap-4 rounded-lg border border-[#1f2937] bg-[#111827] p-3 text-sm text-[#d1d5db]">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={showEnvelope}
            onChange={(event) => setShowEnvelope(event.target.checked)}
            className="h-4 w-4 rounded border-[#374151] bg-[#0b1220]"
          />
          Show historical envelope
        </label>
        <label className="inline-flex items-center gap-2">
          <span className="text-[#9ca3af]">Envelope level</span>
          <select
            value={envelopeLevel}
            onChange={(event) => setEnvelopeLevel(Number(event.target.value))}
            className="h-8 rounded-md border border-[#374151] bg-[#0b1220] px-2 text-sm text-[#e5e7eb]"
          >
            <option value={1}>±1σ</option>
            <option value={2}>±2σ</option>
            <option value={3}>±3σ</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-2">
          <span className="text-[#9ca3af]">Color recent path by</span>
          <select
            value={recentColorBy}
            onChange={(event) => setRecentColorBy(event.target.value as typeof recentColorBy)}
            className="h-8 rounded-md border border-[#374151] bg-[#0b1220] px-2 text-sm text-[#e5e7eb]"
          >
            <option value="none">none</option>
            <option value="zOmega">Zω</option>
            <option value="curvature">curvature</option>
            <option value="manifold">manifold departure</option>
            <option value="coupling">coupling stability</option>
          </select>
        </label>
      </div>
      <Plot
        data={traces}
        layout={layout}
        config={createCsvExportConfig('phase-portrait.csv', { displayModeBar: true, responsive: true })}
        style={{ width: '100%', height: `${plotSize}px` }}
        useResizeHandler
        onClick={handleClick}
      />
    </div>
  );
}
