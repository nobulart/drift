'use client';

import { useMemo, useRef } from 'react';
import Plot from 'react-plotly.js';
import { useStore } from '@/store/useStore';
import { useTimeStore } from '@/store/timeStore';
import { usePlotDisplayHeight } from '@/components/usePlotDisplayHeight';
import { useChartTitle } from '@/lib/chartTitles';
import { extractPlotlyDateRange } from '@/lib/timeRange';
import { createCsvExportConfig } from '@/lib/plotlyCsvExport';
import { buildPhasePortraitSeries } from '@/lib/phase';
import { PhaseStabilitySample, PhaseStabilityState } from '@/lib/types';

function formatValue(value?: number | null, digits = 3) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : 'n/a';
}

function stateLabel(state?: string | null) {
  return (state || 'insufficient_data').replace('_', ' ');
}

function stateClass(state?: PhaseStabilityState | string | null) {
  switch (state) {
    case 'stable':
      return 'border-[#0f766e] bg-[#042f2e] text-[#99f6e4]';
    case 'watch':
      return 'border-[#a16207] bg-[#422006] text-[#fde68a]';
    case 'excursion':
      return 'border-[#c2410c] bg-[#431407] text-[#fed7aa]';
    case 'escape_candidate':
      return 'border-[#a21caf] bg-[#3b0764] text-[#f5d0fe]';
    default:
      return 'border-[#4b5563] bg-[#1f2937] text-[#d1d5db]';
  }
}

function StatCard({ label, value, title, state }: { label: string; value: string; title?: string; state?: PhaseStabilityState | string | null }) {
  return (
    <div className={`rounded-lg border p-3 ${stateClass(state)}`} title={title}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#93a4bb]">{label}</p>
      <p className="mt-1 break-words text-lg font-semibold leading-snug">{value}</p>
    </div>
  );
}

function recentWindow(samples: PhaseStabilitySample[], days = 180) {
  const latest = samples[samples.length - 1];
  if (!latest) return [];
  const latestTime = new Date(latest.date).getTime();
  if (!Number.isFinite(latestTime)) return samples.slice(-days);
  return samples.filter(sample => {
    const time = new Date(sample.date).getTime();
    return Number.isFinite(time) && latestTime - time <= days * 24 * 60 * 60 * 1000;
  });
}

export default function PhaseStabilityPanel() {
  const rollingStats = useStore(state => state.rollingStats);
  const diagnostics = rollingStats?.phaseStability ?? null;
  const plotHeight = usePlotDisplayHeight(360, 700);
  const isInternalUpdate = useRef(false);
  const { timeRange, timeLockEnabled, setTimeRange } = useTimeStore();
  const samples = useMemo(() => diagnostics?.samples ?? [], [diagnostics]);
  const visibleSamples = useMemo(() => {
    if (timeLockEnabled && timeRange) {
      return samples.filter(sample => {
        const time = new Date(sample.date).getTime();
        return Number.isFinite(time) && time >= timeRange[0] && time <= timeRange[1];
      });
    }

    return recentWindow(samples, 180);
  }, [samples, timeLockEnabled, timeRange]);

  const latest = diagnostics?.summary?.latest ?? visibleSamples[visibleSamples.length - 1] ?? null;
  const analogue = diagnostics?.summary?.topAnalogues?.[0] ?? null;
  const chartTitle = useChartTitle('Phase Stability Diagnostics', visibleSamples.map(sample => sample.date));

  const timeSeriesData = useMemo<Plotly.Data[]>(() => [
    {
      x: visibleSamples.map(sample => sample.date),
      y: visibleSamples.map(sample => sample.zOmega ?? NaN),
      type: 'scatter',
      mode: 'lines',
      name: 'Zω',
      line: { color: '#38bdf8', width: 1.8 },
      hovertemplate: '%{x}<br>Zω %{y:.3f}<extra></extra>',
    },
    {
      x: visibleSamples.map(sample => sample.date),
      y: visibleSamples.map(sample => sample.curvatureNorm ?? NaN),
      type: 'scatter',
      mode: 'lines',
      name: 'κ̂',
      line: { color: '#facc15', width: 1.6 },
      hovertemplate: '%{x}<br>κ̂ %{y:.3f}<extra></extra>',
    },
    {
      x: visibleSamples.map(sample => sample.date),
      y: visibleSamples.map(sample => sample.manifoldDeparture ?? NaN),
      type: 'scatter',
      mode: 'lines',
      name: 'Manifold Departure',
      line: { color: '#fb923c', width: 1.8 },
      hovertemplate: '%{x}<br>Manifold Departure %{y:.3f}<extra></extra>',
    },
    {
      x: visibleSamples.map(sample => sample.date),
      y: visibleSamples.map(sample => sample.couplingStabilityIndex ?? NaN),
      type: 'scatter',
      mode: 'lines',
      name: 'Coupling Stability',
      line: { color: '#c084fc', width: 1.8 },
      hovertemplate: '%{x}<br>Coupling Stability %{y:.3f}<extra></extra>',
    },
  ], [visibleSamples]);

  const miniPortraitData = useMemo<Plotly.Data[]>(() => {
    if (!diagnostics || visibleSamples.length === 0) return [];
    const recentSeries = buildPhasePortraitSeries(
      visibleSamples.map(sample => sample.theta),
      visibleSamples.map(sample => sample.omega),
      visibleSamples.map(sample => sample.date)
    );
    const envelope = diagnostics.envelope.filter(bin => bin.muOmega !== null && bin.sigmaOmega !== null);
    return [
      {
        x: envelope.map(bin => bin.theta),
        y: envelope.map(bin => (bin.muOmega ?? 0) + 2 * (bin.sigmaOmega ?? 0)),
        type: 'scatter',
        mode: 'lines',
        name: '+2σ corridor',
        line: { color: 'rgba(56, 189, 248, 0.35)', width: 1, dash: 'dot' },
        hovertemplate: 'θ %{x:.3f}<br>+2σ %{y:.4f}<extra></extra>',
      },
      {
        x: envelope.map(bin => bin.theta),
        y: envelope.map(bin => bin.muOmega),
        type: 'scatter',
        mode: 'lines',
        name: 'Historical median',
        line: { color: 'rgba(125, 211, 252, 0.80)', width: 1.4 },
        hovertemplate: 'θ %{x:.3f}<br>median %{y:.4f}<extra></extra>',
      },
      {
        x: envelope.map(bin => bin.theta),
        y: envelope.map(bin => (bin.muOmega ?? 0) - 2 * (bin.sigmaOmega ?? 0)),
        type: 'scatter',
        mode: 'lines',
        name: '-2σ corridor',
        line: { color: 'rgba(56, 189, 248, 0.35)', width: 1, dash: 'dot' },
        hovertemplate: 'θ %{x:.3f}<br>-2σ %{y:.4f}<extra></extra>',
      },
      {
        x: recentSeries.x,
        y: recentSeries.y,
        customdata: recentSeries.customdata,
        type: 'scatter',
        mode: 'lines+markers',
        name: 'Recent trajectory',
        line: { color: '#f59e0b', width: 2 },
        marker: {
          size: 5,
          color: visibleSamples.map(sample => sample.manifoldDeparture ?? 0),
          colorscale: [[0, '#22c55e'], [0.5, '#f59e0b'], [1, '#a855f7']],
          cmin: 0,
          cmax: 1,
          colorbar: { title: { text: 'M' }, thickness: 10 },
        },
        hovertemplate: '%{customdata}<br>θ %{x:.3f}<br>ω %{y:.4f}<extra></extra>',
      },
      latest ? {
        x: [latest.theta],
        y: [latest.omega],
        type: 'scatter',
        mode: 'markers',
        name: 'Latest point',
        marker: { color: '#f8fafc', size: 11, symbol: 'diamond', line: { color: '#f59e0b', width: 2 } },
        hovertemplate: `${latest.date}<br>θ %{x:.3f}<br>ω %{y:.4f}<extra></extra>`,
      } as Plotly.Data : null,
    ].filter(Boolean) as Plotly.Data[];
  }, [diagnostics, latest, visibleSamples]);

  const handleRelayout = (event: any) => {
    if (isInternalUpdate.current || !timeLockEnabled) return;
    const range = extractPlotlyDateRange(event);
    if (!range) return;
    isInternalUpdate.current = true;
    setTimeRange(range);
    setTimeout(() => { isInternalUpdate.current = false; }, 0);
  };

  if (!diagnostics || !latest) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center bg-[#0b1220] p-4 text-sm text-[#9ca3af]">
        Phase stability diagnostics are not available yet.
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-auto bg-[#0b1220] p-4">
      <p className="mb-4 text-sm leading-6 text-[#d1d5db]">
        Quantifies whether the recent θ-ω trajectory remains inside the historical phase-conditioned manifold. Elevated values indicate off-manifold motion, abnormal curvature, hysteresis, or poor similarity to prior loop families. Treat this as a comparative stability diagnostic, not a deterministic prediction.
      </p>

      <div className="mb-4 grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Latest date" value={latest.date} />
        <StatCard label="Phase angle θ" value={formatValue(latest.theta)} />
        <StatCard label="Angular velocity ω" value={formatValue(latest.omega, 4)} />
        <StatCard label="Zω" value={formatValue(latest.zOmega)} title="Phase-conditioned angular-velocity anomaly." state={latest.state} />
        <StatCard label="Curvature κ" value={formatValue(latest.curvature)} />
        <StatCard label="Manifold Departure" value={formatValue(latest.manifoldDeparture)} title="Distance from the historical angular-velocity corridor at the same phase angle θ." state={latest.state} />
        <StatCard label="Historical Analogue" value={formatValue(latest.analogueSimilarity)} title={analogue ? `${analogue.startDate} to ${analogue.endDate}` : 'No comparable historical window available.'} />
        <StatCard label="Hysteresis Index" value={formatValue(latest.hysteresisIndex)} title="Measures whether the recent trajectory returns through the same phase sector along a displaced angular-velocity branch." />
        <StatCard label="Coupling Stability Index" value={formatValue(latest.couplingStabilityIndex)} state={latest.state} />
        <StatCard label="State classification" value={stateLabel(latest.state)} state={latest.state} />
      </div>

      <div className="mb-4 min-w-0 rounded-lg border border-[#243041] bg-[#111827] p-3">
        <Plot
          data={timeSeriesData}
          layout={{
            title: chartTitle as any,
            template: 'plotly_dark',
            xaxis: { title: { text: 'Date' }, gridcolor: '#374151' },
            yaxis: { title: { text: 'Diagnostic value' }, gridcolor: '#374151' },
            legend: { orientation: 'h', y: -0.22, x: 0.5, xanchor: 'center' },
            margin: { l: 58, r: 24, t: 78, b: 70 },
            plot_bgcolor: '#111827',
            paper_bgcolor: '#111827',
            font: { color: '#e5e7eb' },
            height: plotHeight,
            autosize: true,
            uirevision: timeLockEnabled && timeRange ? `${timeRange[0]}-${timeRange[1]}` : 'phase-stability-free',
          } as any}
          config={createCsvExportConfig('phase-stability-timeseries.csv', { displayModeBar: true, responsive: true, scrollZoom: true })}
          style={{ width: '100%', height: `${plotHeight}px` }}
          useResizeHandler
          onRelayout={handleRelayout}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="min-w-0 rounded-lg border border-[#243041] bg-[#111827] p-3">
          <Plot
            data={miniPortraitData}
            layout={{
              title: 'θ-ω Mini Portrait with Historical Corridor' as any,
              template: 'plotly_dark',
              xaxis: { title: { text: 'Phase Angle θ' }, gridcolor: '#374151' },
              yaxis: { title: { text: 'Angular Velocity ω' }, gridcolor: '#374151' },
              legend: { orientation: 'h', y: -0.24, x: 0.5, xanchor: 'center' },
              margin: { l: 58, r: 70, t: 78, b: 72 },
              plot_bgcolor: '#111827',
              paper_bgcolor: '#111827',
              font: { color: '#e5e7eb' },
              height: plotHeight,
              autosize: true,
            } as any}
            config={createCsvExportConfig('phase-stability-portrait.csv', { displayModeBar: true, responsive: true })}
            style={{ width: '100%', height: `${plotHeight}px` }}
            useResizeHandler
          />
        </div>

        <div className="rounded-lg border border-[#243041] bg-[#111827] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#93c5fd]">Closest Historical Analogues</p>
          <div className="mt-3 space-y-2 text-sm text-[#d1d5db]">
            {(diagnostics.summary?.topAnalogues ?? []).length > 0 ? diagnostics.summary!.topAnalogues.map((entry) => (
              <div key={`${entry.startDate}-${entry.endDate}`} className="flex items-center justify-between gap-3 rounded-md border border-[#1f2937] bg-[#0b1220] px-3 py-2">
                <span>{entry.startDate} to {entry.endDate}</span>
                <span className={entry.similarity < 0.3 ? 'font-semibold text-[#fca5a5]' : 'text-[#93c5fd]'}>
                  {entry.similarity.toFixed(3)}
                </span>
              </div>
            )) : (
              <p className="text-[#9ca3af]">No sufficient historical analogue window.</p>
            )}
          </div>
          {analogue && analogue.similarity < 0.3 && (
            <p className="mt-3 rounded-md border border-[#7f1d1d] bg-[#450a0a]/70 px-3 py-2 text-sm text-[#fecaca]">
              poor historical analogue
            </p>
          )}
          <p className="mt-4 text-xs leading-5 text-[#9ca3af]">
            Low Coupling Stability Index means the current trajectory remains close to the historical phase manifold. High values indicate off-manifold motion, high curvature, hysteresis, or historical novelty.
          </p>
        </div>
      </div>
    </div>
  );
}
