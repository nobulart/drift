'use client';

import { useEffect, useMemo, useState } from 'react';
import Plot from 'react-plotly.js';
import { useStore } from '@/store/useStore';
import { usePlotDisplayHeight } from '@/components/usePlotDisplayHeight';
import { createCsvExportConfig } from '@/lib/plotlyCsvExport';
import {
  DEFAULT_PHASE_ESCAPE_MODELS,
  PhaseEscapeCompositeKey,
  TWO_WELL_CALIBRATION,
  angularDistanceDegrees,
  assignMetastablePhaseWell,
  classifyEnergyState,
  classifyPhaseDirection,
  classifyPhaseRegion,
  classifyAcceleration,
  computeAlignmentStatus,
  computePhaseAcceleration,
  computePhaseDrift,
  curvatureSignal,
  detectOscillatory,
  degreesToRadians,
  energyBarrierRatio,
  estimateTimeToAlignmentDays,
  escapeEnergyBarrier,
  escapeGradient,
  escapeProbability,
  kramersLikeEscapeIndex,
  phaseKineticEnergy,
  phasePotentialEnergy,
  phaseTotalEnergy,
  radiansToDegrees,
  smoothExp,
  stabilityScore,
  wrapPhase,
} from '@/lib/phaseEscapeModel';

interface PhaseEscapeRecord {
  t: string;
  thetaRaw: number | null;
  thetaResidual: number | null;
  sunPhase: number | null;
  rRatio: number | null;
  bodyPhases: Record<string, number | null>;
  composites: Record<PhaseEscapeCompositeKey, number | null>;
  misalignment: Record<PhaseEscapeCompositeKey, number | null>;
}

interface PhaseEscapeDataset {
  source: {
    ephemerisKernel?: string;
    observer?: string;
    smoothDays?: number;
    phaseExtraction?: string;
  };
  records: PhaseEscapeRecord[];
}

const COMPOSITE_OPTIONS = Object.keys(DEFAULT_PHASE_ESCAPE_MODELS) as PhaseEscapeCompositeKey[];

function formatDegrees(rad?: number | null) {
  if (rad === null || rad === undefined || !Number.isFinite(rad)) {
    return 'n/a';
  }

  return `${radiansToDegrees(rad).toFixed(1)} deg`;
}

function formatNumber(value?: number | null, digits = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'n/a';
  }

  return value.toFixed(digits);
}

function percentile(values: number[], q: number) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (valid.length === 0) {
    return NaN;
  }

  const index = Math.min(valid.length - 1, Math.max(0, Math.floor((valid.length - 1) * q)));
  return valid[index];
}

function StatCard({ label, value, title, tone = 'default' }: { label: string; value: string; title?: string; tone?: 'default' | 'green' | 'brightGreen' | 'orange' | 'purple' | 'cyan' }) {
  const toneClass = {
    default: 'border-[#243041] bg-[#111827] text-[#e5e7eb]',
    green: 'border-[#166534] bg-[#052e16] text-[#bbf7d0]',
    brightGreen: 'border-[#22c55e] bg-[#052e16] text-[#86efac]',
    orange: 'border-[#92400e] bg-[#451a03] text-[#fed7aa]',
    purple: 'border-[#7e22ce] bg-[#2e1065] text-[#e9d5ff]',
    cyan: 'border-[#0891b2] bg-[#083344] text-[#a5f3fc]',
  }[tone];

  return (
    <div className={`rounded-lg border p-3 ${toneClass}`} title={title}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#93a4bb]">{label}</p>
      <p className="mt-1 break-words text-lg font-semibold leading-snug">{value}</p>
    </div>
  );
}

function DirectionIndicator({ direction, magnitude }: { direction: string; magnitude: number }) {
  const baseDirection = direction.startsWith('approaching')
    ? 'approaching'
    : direction.startsWith('receding')
      ? 'receding'
      : 'stationary';
  const config = direction.includes('oscillatory')
    ? { symbol: '~', className: 'border-[#7e22ce] bg-[#2e1065] text-[#e9d5ff]' }
    : baseDirection === 'approaching'
    ? { symbol: '->', className: 'border-[#166534] bg-[#052e16] text-[#86efac]' }
    : baseDirection === 'receding'
      ? { symbol: '<-', className: 'border-[#92400e] bg-[#451a03] text-[#fcd34d]' }
      : { symbol: '.', className: 'border-[#4b5563] bg-[#1f2937] text-[#d1d5db]' };

  return (
    <div className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${config.className}`}>
      <span className="font-mono text-base">{config.symbol}</span>
      <span>{direction}</span>
      <span className="text-xs opacity-80">{Number.isFinite(magnitude) ? `${magnitude.toFixed(2)} deg/day` : 'n/a'}</span>
    </div>
  );
}

function ExpandChartButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-lg border border-[#374151] bg-[#0b1220] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#cbd5e1] transition-colors hover:border-[#60a5fa] hover:text-white"
      title={title}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 3h6v6" />
        <path d="M9 21H3v-6" />
        <path d="m21 3-7 7" />
        <path d="m3 21 7-7" />
      </svg>
      Expand
    </button>
  );
}

export default function PhaseEscapeModelPanel() {
  const [selectedComposite, setSelectedComposite] = useState<PhaseEscapeCompositeKey>('Venus_Mars');
  const [dataset, setDataset] = useState<PhaseEscapeDataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [daysShown, setDaysShown] = useState(730);
  const [showEnergyCurve, setShowEnergyCurve] = useState(true);
  const [showPhaseAcceleration, setShowPhaseAcceleration] = useState(true);
  const [showEnergySeries, setShowEnergySeries] = useState(true);
  const [showBarrierRatioSeries, setShowBarrierRatioSeries] = useState(false);
  const [expandedChart, setExpandedChart] = useState<'curve' | 'timeSeries' | null>(null);

  const plotHeight = usePlotDisplayHeight(380, 700);
  const rollingStats = useStore(state => state.rollingStats);
  const windowSize = useStore(state => state.windowSize);
  const turnThreshold = useStore(state => state.turnThreshold);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      windowSize: String(windowSize),
      turnThreshold: String(turnThreshold),
      smoothDays: '31',
    });

    fetch(`/api/phase-escape?${params.toString()}`, { cache: 'no-store' })
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to load phase escape model data');
        }
        return response.json();
      })
      .then((payload: PhaseEscapeDataset) => {
        if (active) {
          setDataset(payload);
        }
      })
      .catch(err => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to load phase escape model data');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [turnThreshold, windowSize]);

  const model = DEFAULT_PHASE_ESCAPE_MODELS[selectedComposite];
  const records = useMemo(() => dataset?.records ?? [], [dataset]);

  const enrichedRecords = useMemo(() => records.map(record => {
    const phi = record.misalignment?.[selectedComposite];
    return {
      ...record,
      phi,
      escapeProbability: typeof phi === 'number' ? escapeProbability(phi, model) : NaN,
    };
  }), [model, records, selectedComposite]);

  const phiSeriesDeg = useMemo(() => enrichedRecords.map(record => (
    typeof record.phi === 'number' && Number.isFinite(record.phi)
      ? radiansToDegrees(record.phi)
      : NaN
  )), [enrichedRecords]);
  const phiSmoothDeg = useMemo(() => smoothExp(phiSeriesDeg, 0.25), [phiSeriesDeg]);
  const phaseDriftSeries = useMemo(() => {
    const timeMs = enrichedRecords.map(record => new Date(record.t).getTime());

    return computePhaseDrift(phiSmoothDeg, timeMs);
  }, [enrichedRecords, phiSmoothDeg]);
  const phaseAccelerationSeries = useMemo(() => {
    const timeMs = enrichedRecords.map(record => new Date(record.t).getTime());

    return computePhaseAcceleration(phiSmoothDeg, timeMs);
  }, [enrichedRecords, phiSmoothDeg]);
  const isOscillatory = useMemo(() => detectOscillatory(phiSeriesDeg.filter(Number.isFinite)), [phiSeriesDeg]);

  const latest = useMemo(() => {
    for (let index = enrichedRecords.length - 1; index >= 0; index--) {
      const record = enrichedRecords[index];
      if (Number.isFinite(record.thetaResidual) && Number.isFinite(record.phi) && Number.isFinite(record.rRatio)) {
        return record;
      }
    }

    return enrichedRecords[enrichedRecords.length - 1] ?? null;
  }, [enrichedRecords]);

  const rThreshold = useMemo(() => percentile(enrichedRecords.map(record => record.rRatio ?? NaN), 0.95), [enrichedRecords]);
  const probabilityRiskThreshold = useMemo(() => {
    const values = Array.from({ length: 361 }, (_, index) => {
      const phi = degreesToRadians(-180 + index);
      return escapeProbability(phi, model);
    });
    return percentile(values, 0.75);
  }, [model]);

  const currentWell = latest?.thetaResidual !== null && latest?.thetaResidual !== undefined
    ? assignMetastablePhaseWell(latest.thetaResidual)
    : null;
  const nearHighRiskRegime = Boolean(
    latest &&
    Number.isFinite(latest.rRatio) &&
    Number.isFinite(latest.escapeProbability) &&
    Number.isFinite(rThreshold) &&
    latest.rRatio! >= rThreshold &&
    latest.escapeProbability >= probabilityRiskThreshold
  );
  const latestIndex = latest ? enrichedRecords.indexOf(latest) : -1;
  const phiNowDeg = latest?.phi !== null && latest?.phi !== undefined ? radiansToDegrees(latest.phi) : NaN;
  const dphiNow = latestIndex >= 0 ? phaseDriftSeries[latestIndex] : NaN;
  const latestAccelerationIndex = latestIndex >= phaseAccelerationSeries.length - 1 ? latestIndex - 1 : latestIndex;
  const d2phiNow = latestAccelerationIndex >= 0 ? phaseAccelerationSeries[latestAccelerationIndex] : NaN;
  const deltaPhi = angularDistanceDegrees(phiNowDeg, model.phi0Deg);
  const deltaPhiNorm = deltaPhi / 180;
  const phaseDirection = classifyPhaseDirection(phiNowDeg, model.phi0Deg, dphiNow);
  const directionLabel = phaseDirection === 'approaching'
    ? isOscillatory ? 'approaching (oscillatory)' : 'approaching'
    : phaseDirection === 'receding'
      ? isOscillatory ? 'receding (oscillatory)' : 'receding'
      : 'stationary';
  const timeToAlignmentDays = estimateTimeToAlignmentDays(phiNowDeg, model.phi0Deg, dphiNow, phaseDirection);
  const dPDPhi = escapeGradient(phiNowDeg, model.betaCos, model.betaSin);
  const dPDt = dPDPhi * dphiNow;
  const escapeTrend = dPDt > 0 ? 'increasing' : 'decreasing';
  const phaseRegion = classifyPhaseRegion(deltaPhi);
  const alignmentStatus = computeAlignmentStatus(phaseDirection, deltaPhi);
  const accelerationState = classifyAcceleration(dphiNow, d2phiNow);
  const curvatureState = curvatureSignal(phiNowDeg, model.phi0Deg, dphiNow, d2phiNow);
  const stability = stabilityScore(dphiNow, d2phiNow);
  const kineticEnergy = phaseKineticEnergy(dphiNow);
  const potentialEnergy = phasePotentialEnergy(phiNowDeg, model.phi0Deg, model.alpha);
  const totalEnergy = phaseTotalEnergy(phiNowDeg, model.phi0Deg, dphiNow, model.alpha);
  const barrier = escapeEnergyBarrier(model.alpha);
  const barrierRatio = energyBarrierRatio(totalEnergy, barrier);
  const energyState = classifyEnergyState(barrierRatio);
  const escapeEnergyIndex = kramersLikeEscapeIndex(totalEnergy, barrier, latest?.rRatio ?? NaN);
  const directionTone = directionLabel.includes('oscillatory')
    ? 'purple'
    : phaseDirection === 'approaching'
      ? 'green'
      : phaseDirection === 'receding'
        ? 'orange'
        : 'default';
  const accelerationTone = accelerationState === 'accelerating' ? 'brightGreen' : 'default';
  const curvatureTone = curvatureState === 'accelerating toward preferred phase'
    ? 'brightGreen'
    : curvatureState === 'curving toward preferred phase'
      ? 'cyan'
      : curvatureState === 'curving away'
        ? 'orange'
        : 'default';

  const curveData = useMemo(() => {
    const x = Array.from({ length: 361 }, (_, index) => -180 + index);
    const y = x.map(deg => escapeProbability(degreesToRadians(deg), model));
    const potentialEnergyCurve = x.map(deg => phasePotentialEnergy(deg, model.phi0Deg, model.alpha));
    const barrierEnergy = escapeEnergyBarrier(model.alpha);
    const currentPhiDeg = latest?.phi !== null && latest?.phi !== undefined ? radiansToDegrees(latest.phi) : NaN;
    const preferredDeg = model.phi0Deg;
    const oppositeDeg = radiansToDegrees(wrapPhase(degreesToRadians(preferredDeg) + Math.PI));

    const traces: Plotly.Data[] = [
      {
        x,
        y,
        type: 'scatter',
        mode: 'lines',
        name: 'Fitted escape probability',
        line: { color: '#38bdf8', width: 2 },
      },
      ...(showEnergyCurve ? [
        {
          x,
          y: potentialEnergyCurve,
          type: 'scatter',
          mode: 'lines',
          name: 'Phase potential energy',
          yaxis: 'y2',
          line: { color: '#facc15', width: 1.6 },
        },
        {
          x: [-180, 180],
          y: [barrierEnergy, barrierEnergy],
          type: 'scatter',
          mode: 'lines',
          name: 'Energy barrier',
          yaxis: 'y2',
          line: { color: '#ef4444', width: 1.2, dash: 'dash' },
        },
      ] as Plotly.Data[] : []),
      {
        x: [currentPhiDeg],
        y: [latest?.escapeProbability ?? NaN],
        type: 'scatter',
        mode: 'markers',
        name: 'Current phi',
        marker: { color: '#f97316', size: 11, symbol: 'diamond' },
      },
      {
        x: [preferredDeg, preferredDeg],
        y: [0, 1],
        type: 'scatter',
        mode: 'lines',
        name: 'Preferred phi0',
        line: { color: '#22c55e', width: 1.5, dash: 'dot' },
      },
      {
        x: [oppositeDeg, oppositeDeg],
        y: [0, 1],
        type: 'scatter',
        mode: 'lines',
        name: 'Opposite phase',
        line: { color: '#a78bfa', width: 1.5, dash: 'dash' },
      },
    ];

    return traces;
  }, [latest, model, showEnergyCurve]);

  const recentSeries = useMemo(() => {
    const startIndex = Math.max(0, enrichedRecords.length - daysShown);
    const slice = enrichedRecords.slice(startIndex);
    const dphiSlice = phaseDriftSeries.slice(startIndex);
    const energy = slice.map((record, index) => {
      const phiDeg = typeof record.phi === 'number' && Number.isFinite(record.phi)
        ? radiansToDegrees(record.phi)
        : NaN;
      return phaseTotalEnergy(phiDeg, model.phi0Deg, dphiSlice[index], model.alpha);
    });
    const currentBarrier = escapeEnergyBarrier(model.alpha);

    return {
      dates: slice.map(record => record.t),
      r: slice.map(record => record.rRatio ?? NaN),
      p: slice.map(record => record.escapeProbability),
      phi: slice.map(record => (
        typeof record.phi === 'number' && Number.isFinite(record.phi)
          ? radiansToDegrees(record.phi)
          : NaN
      )),
      dphi: dphiSlice,
      d2phi: phaseAccelerationSeries.slice(startIndex),
      energy,
      barrierRatio: energy.map(value => energyBarrierRatio(value, currentBarrier) ?? NaN),
    };
  }, [daysShown, enrichedRecords, model.alpha, model.phi0Deg, phaseAccelerationSeries, phaseDriftSeries]);

  const timeSeriesData = useMemo(() => {
    const traces: Plotly.Data[] = [
      {
        x: recentSeries.dates,
        y: recentSeries.r,
        type: 'scatter',
        mode: 'lines',
        name: 'R(t)',
        yaxis: 'y',
        line: { color: '#60a5fa', width: 1.8 },
      },
      {
        x: recentSeries.dates,
        y: recentSeries.p,
        type: 'scatter',
        mode: 'lines',
        name: 'Escape probability',
        yaxis: 'y',
        line: { color: '#fb923c', width: 1.8 },
      },
      {
        x: recentSeries.dates,
        y: recentSeries.dates.map(() => rThreshold),
        type: 'scatter',
        mode: 'lines',
        name: 'High-R threshold',
        yaxis: 'y',
        line: { color: '#f43f5e', width: 1, dash: 'dot' },
      },
      {
        x: recentSeries.dates,
        y: recentSeries.phi,
        type: 'scatter',
        mode: 'lines',
        name: 'Residual phase phi',
        yaxis: 'y2',
        line: { color: '#c084fc', width: 1.4, dash: 'dot' },
      },
      {
        x: recentSeries.dates,
        y: recentSeries.dates.map(() => model.phi0Deg),
        type: 'scatter',
        mode: 'lines',
        name: 'Preferred phi0',
        yaxis: 'y2',
        line: { color: '#22c55e', width: 1.4, dash: 'dash' },
      },
    ];

    if (showPhaseAcceleration) {
      traces.push({
        x: recentSeries.dates,
        y: recentSeries.d2phi,
        type: 'scatter',
        mode: 'lines',
        name: 'Phase acceleration',
        yaxis: 'y3',
        line: { color: '#facc15', width: 1, dash: 'dot' },
      });
    }

    if (showEnergySeries) {
      traces.push({
        x: recentSeries.dates,
        y: recentSeries.energy,
        type: 'scatter',
        mode: 'lines',
        name: 'Total phase energy',
        yaxis: 'y4',
        line: { color: '#2dd4bf', width: 1.2 },
      });
    }

    if (showBarrierRatioSeries) {
      traces.push({
        x: recentSeries.dates,
        y: recentSeries.barrierRatio,
        type: 'scatter',
        mode: 'lines',
        name: 'Barrier ratio',
        yaxis: 'y5',
        line: { color: '#f472b6', width: 1.2, dash: 'dash' },
      });
    }

    return traces;
  }, [model.phi0Deg, rThreshold, recentSeries, showBarrierRatioSeries, showEnergySeries, showPhaseAcceleration]);

  useEffect(() => {
    if (!expandedChart || typeof document === 'undefined') {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpandedChart(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [expandedChart]);

  const curveLayout = useMemo(() => ({
    title: { text: 'Phase-Dependent Escape Probability' },
    template: 'plotly_dark',
    xaxis: { title: { text: 'Residual phase misalignment phi (deg)' }, range: [-180, 180], gridcolor: '#374151' },
    yaxis: { title: { text: 'P(escape | phi)' }, range: [0, 1], gridcolor: '#374151' },
    yaxis2: { title: { text: 'Phase potential energy' }, overlaying: 'y', side: 'right', showgrid: false },
    legend: { orientation: 'h', y: -0.24, x: 0.5, xanchor: 'center' },
    margin: { l: 56, r: 78, t: 48, b: 70 },
    plot_bgcolor: '#111827',
    paper_bgcolor: '#111827',
    font: { color: '#e5e7eb' },
    height: plotHeight,
    autosize: true,
  }), [plotHeight]);

  const timeSeriesLayout = useMemo(() => ({
    title: { text: `Recent ${daysShown} Days` },
    template: 'plotly_dark',
    xaxis: { title: { text: 'Date' }, gridcolor: '#374151', domain: [0.07, 0.90] },
    yaxis: { title: { text: 'R(t) / Escape probability' }, gridcolor: '#374151', side: 'left', range: [0, 1] },
    yaxis2: {
      title: { text: 'Phi (deg)', font: { color: '#c084fc', size: 11 }, standoff: 2 },
      tickfont: { color: '#c084fc', size: 10 },
      overlaying: 'y',
      side: 'right',
      anchor: 'free',
      position: 0.91,
      range: [-180, 180],
      showgrid: false,
      zeroline: false,
    },
    yaxis3: {
      title: { text: 'Accel', font: { color: '#facc15', size: 11 }, standoff: 2 },
      tickfont: { color: '#facc15', size: 10 },
      overlaying: 'y',
      side: 'left',
      anchor: 'free',
      position: 0,
      showgrid: false,
      zeroline: false,
    },
    yaxis4: {
      title: { text: 'Energy', font: { color: '#2dd4bf', size: 11 }, standoff: 2 },
      tickfont: { color: '#2dd4bf', size: 10 },
      overlaying: 'y',
      side: 'right',
      anchor: 'free',
      position: 0.955,
      showgrid: false,
      zeroline: false,
    },
    yaxis5: {
      title: { text: 'Barrier', font: { color: '#f472b6', size: 11 }, standoff: 2 },
      tickfont: { color: '#f472b6', size: 10 },
      overlaying: 'y',
      side: 'right',
      anchor: 'free',
      position: 1,
      showgrid: false,
      zeroline: false,
    },
    legend: { orientation: 'h', y: -0.24, x: 0.5, xanchor: 'center' },
    margin: { l: 92, r: 112, t: 48, b: 70 },
    plot_bgcolor: '#111827',
    paper_bgcolor: '#111827',
    font: { color: '#e5e7eb' },
    height: plotHeight,
    autosize: true,
  }), [daysShown, plotHeight]);

  if (loading && !dataset) {
    return (
      <div className="flex h-full min-h-[360px] items-center justify-center bg-[#0b1220] p-4 text-sm text-[#9ca3af]">
        Computing phase-locked escape model from internal EOP and DE442 caches...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[#0b1220] p-4 text-sm text-red-400">
        {error}
      </div>
    );
  }

  if (!latest || !rollingStats) {
    return (
      <div className="bg-[#0b1220] p-4 text-sm text-[#9ca3af]">
        Phase-locked escape model data is not available yet.
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-auto bg-[#0b1220] p-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="text-sm text-[#9ca3af]">Composite</label>
        <select
          value={selectedComposite}
          onChange={(event) => setSelectedComposite(event.target.value as PhaseEscapeCompositeKey)}
          className="rounded-lg border border-[#374151] bg-[#111827] px-3 py-2 text-sm text-[#e5e7eb] focus:outline-none focus:ring-2 focus:ring-[#38bdf8]"
        >
          {COMPOSITE_OPTIONS.map(key => (
            <option key={key} value={key}>{DEFAULT_PHASE_ESCAPE_MODELS[key].label}</option>
          ))}
        </select>
        <label className="ml-auto text-sm text-[#9ca3af]">Recent days</label>
        <input
          type="number"
          min={90}
          max={3650}
          step={30}
          value={daysShown}
          onChange={(event) => setDaysShown(Math.max(90, Number(event.target.value) || 730))}
          className="w-24 rounded-lg border border-[#374151] bg-[#111827] px-3 py-2 text-sm text-[#e5e7eb] focus:outline-none focus:ring-2 focus:ring-[#38bdf8]"
        />
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Latest date" value={latest.t} />
        <StatCard label="R(t)" value={formatNumber(latest.rRatio)} />
        <StatCard label="Theta raw" value={formatDegrees(latest.thetaRaw)} title="Raw DRIFT phase angle from the rolling state-space pipeline." />
        <StatCard label="Theta residual" value={formatDegrees(latest.thetaResidual)} title="theta_res = wrap(theta raw - solar analytic phase)." />
        <StatCard label="Composite phase" value={formatDegrees(latest.composites[selectedComposite])} title="Equal-weight circular composite of DE442 torque-proxy analytic phases." />
        <StatCard label="Residual phi" value={formatDegrees(latest.phi)} title="Residual phase misalignment phi = wrap(theta_res - composite phase)." />
        <StatCard label="Escape probability" value={`${(latest.escapeProbability * 100).toFixed(1)}%`} title="Phase-dependent escape probability from the harmonic logistic model." />
        <StatCard label="Preferred phi0" value={`${model.phi0Deg.toFixed(1)} deg`} title="Phase of maximum fitted escape-risk modulation." />
        <StatCard label="Alpha" value={model.alpha.toFixed(3)} title="Modulation amplitude sqrt(beta_cos^2 + beta_sin^2)." />
        <StatCard label="Max/min ratio" value={model.maxMinEscapeProbabilityRatio.toFixed(3)} />
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Phase drift rate" value={Number.isFinite(dphiNow) ? `${dphiNow.toFixed(2)} deg/day` : 'n/a'} />
        <StatCard label="Phase direction" value={directionLabel} tone={directionTone} />
        <StatCard label="Alignment status" value={alignmentStatus} />
        <StatCard label="Distance to phi0" value={Number.isFinite(deltaPhi) ? `${deltaPhi.toFixed(1)} deg (${deltaPhiNorm.toFixed(2)} pi)` : 'n/a'} />
        <StatCard
          label="Local linear time to phi0"
          value={timeToAlignmentDays !== null ? `${timeToAlignmentDays.toFixed(1)} days` : phaseDirection === 'receding' ? 'N/A (receding)' : 'N/A'}
          title="Assumes constant phase velocity; does not account for curvature or oscillation in phi(t)."
        />
        <StatCard label="Escape trend" value={escapeTrend} tone={escapeTrend === 'increasing' ? 'green' : 'orange'} />
        <StatCard label="Phase region" value={phaseRegion} />
        <StatCard label="Phase acceleration" value={Number.isFinite(d2phiNow) ? `${d2phiNow.toFixed(2)} deg/day² (${(d2phiNow / 360).toFixed(4)} rev/day²)` : 'n/a'} />
        <StatCard label="Phase acceleration state" value={accelerationState} tone={accelerationTone} />
        <StatCard label="Phase curvature signal" value={curvatureState} tone={curvatureTone} />
        <StatCard label="Phase stability" value={Number.isFinite(stability) ? stability.toFixed(3) : 'n/a'} />
        <StatCard label="Phase kinetic energy" value={Number.isFinite(kineticEnergy) ? kineticEnergy.toFixed(4) : 'n/a'} />
        <StatCard label="Phase potential energy" value={Number.isFinite(potentialEnergy) ? potentialEnergy.toFixed(4) : 'n/a'} />
        <StatCard label="Total phase energy" value={Number.isFinite(totalEnergy) ? totalEnergy.toFixed(4) : 'n/a'} />
        <StatCard label="Barrier ratio" value={barrierRatio !== null ? barrierRatio.toFixed(3) : 'N/A'} />
        <StatCard label="Energy state" value={energyState} />
        <StatCard
          label="Kramers-like index"
          value={escapeEnergyIndex !== null ? escapeEnergyIndex.toExponential(2) : 'N/A'}
          title="Kramers-style relative escape index using R(t) as a noise proxy. Interpret comparatively, not as an absolute probability."
        />
      </div>

      <div className="mb-4">
        <DirectionIndicator direction={directionLabel} magnitude={Math.abs(dphiNow)} />
      </div>

      <div className={`mb-4 rounded-lg border p-3 ${nearHighRiskRegime ? 'border-[#f97316] bg-[#431407]/50' : 'border-[#243041] bg-[#111827]'}`}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#93c5fd]">Metastable phase-well state</span>
          <span className="text-sm text-[#e5e7eb]">{currentWell?.label ?? 'n/a'}</span>
          <span className="text-sm text-[#9ca3af]">
            {nearHighRiskRegime ? 'Near a high-R escape-risk regime' : 'Not currently in a high-R escape-risk regime'}
          </span>
        </div>
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        <div className="min-w-0 rounded-lg border border-[#243041] bg-[#111827] p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-xs text-[#9ca3af]">
              <input
                type="checkbox"
                checked={showEnergyCurve}
                onChange={(event) => setShowEnergyCurve(event.target.checked)}
                className="h-4 w-4 rounded border-[#374151] bg-[#0b1220]"
              />
              Show energy curve
            </label>
            <ExpandChartButton title="View phase probability chart fullscreen" onClick={() => setExpandedChart('curve')} />
          </div>
          <Plot
            data={curveData}
            layout={curveLayout as any}
            config={createCsvExportConfig('phase-escape-curve.csv', { displayModeBar: true, responsive: true })}
            style={{ width: '100%', height: `${plotHeight}px` }}
            useResizeHandler
          />
        </div>

        <div className="min-w-0 rounded-lg border border-[#243041] bg-[#111827] p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-3 text-xs text-[#9ca3af]">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showPhaseAcceleration}
                  onChange={(event) => setShowPhaseAcceleration(event.target.checked)}
                  className="h-4 w-4 rounded border-[#374151] bg-[#0b1220]"
                />
                Phase acceleration
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showEnergySeries}
                  onChange={(event) => setShowEnergySeries(event.target.checked)}
                  className="h-4 w-4 rounded border-[#374151] bg-[#0b1220]"
                />
                Energy
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showBarrierRatioSeries}
                  onChange={(event) => setShowBarrierRatioSeries(event.target.checked)}
                  className="h-4 w-4 rounded border-[#374151] bg-[#0b1220]"
                />
                Barrier ratio
              </label>
            </div>
            <ExpandChartButton title="View recent dynamics chart fullscreen" onClick={() => setExpandedChart('timeSeries')} />
          </div>
          <Plot
            data={timeSeriesData}
            layout={timeSeriesLayout as any}
            config={createCsvExportConfig('phase-escape-timeseries.csv', { displayModeBar: true, responsive: true })}
            style={{ width: '100%', height: `${plotHeight}px` }}
            useResizeHandler
          />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-lg border border-[#243041] bg-[#111827] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#93c5fd]">Phase-Well / Potential Summary</p>
          <div className="mt-3 grid gap-2 text-sm text-[#d1d5db]">
            <div>Primary well near {TWO_WELL_CALIBRATION.primaryDeg.toFixed(1)} deg</div>
            <div>Secondary well near {TWO_WELL_CALIBRATION.secondaryDeg.toFixed(1)} deg</div>
            <div className="text-xs text-[#9ca3af]">{TWO_WELL_CALIBRATION.note}</div>
          </div>
        </div>

        <div className="rounded-lg border border-[#243041] bg-[#111827] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#93c5fd]">Interpretation</p>
          <p className="mt-3 text-sm leading-6 text-[#d1d5db]">
            The phase-locked escape model estimates whether the current DRIFT state lies near a phase relation historically associated with elevated transition probability. It is a metastable escape-risk diagnostic, not a deterministic forecast. In the calibration run, the Venus-Mars composite produced the strongest phase modulation of escape probability, while broad all-planet composites diluted the signal.
          </p>
          <p className="mt-3 text-sm leading-6 text-[#d1d5db]">
            Phase drift indicates whether the system is moving toward or away from the phase region historically associated with elevated transition probability. Estimated time-to-alignment reflects geometric proximity under current phase velocity and does not imply deterministic timing.
          </p>
          <p className="mt-3 text-sm leading-6 text-[#d1d5db]">
            The escape-energy formulation treats residual phase motion as movement in a modulated phase potential. Kinetic energy is estimated from phase velocity, potential energy from angular offset relative to the preferred escape phase, and the barrier ratio gives a normalized indication of proximity to an escape-favorable state. The Kramers-like index uses R(t) as a noise proxy and should be interpreted comparatively rather than as an absolute escape probability.
          </p>
          <p className="mt-3 text-xs text-[#9ca3af]">
            Source: internal DRIFT EOP state plus DE442 {dataset?.source?.ephemerisKernel ?? 'ephemeris'} cache; {dataset?.source?.smoothDays ?? 31}-day smoothing before analytic phase extraction.
          </p>
        </div>
      </div>

      {expandedChart && (
        <>
          <div
            className="fixed inset-0 z-[9998] bg-[#0b1220]/95"
            onClick={() => setExpandedChart(null)}
          />
          <div className="fixed left-1/2 top-1/2 z-[9999] flex max-h-[90vh] w-[min(88vw,1920px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-[#374151] bg-[#111827] p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="truncate pr-2 text-sm font-bold uppercase tracking-wider text-[#e5e7eb]">
                {expandedChart === 'curve' ? 'Phase-Dependent Escape Probability Fullscreen' : `Recent ${daysShown} Days Fullscreen`}
              </h3>
              <button
                type="button"
                onClick={() => setExpandedChart(null)}
                className="rounded p-2 text-[#9ca3af] transition-colors hover:bg-[#374151] hover:text-[#e5e7eb]"
                title="Close fullscreen chart"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <Plot
                data={expandedChart === 'curve' ? curveData : timeSeriesData}
                layout={{
                  ...(expandedChart === 'curve' ? curveLayout : timeSeriesLayout),
                  height: undefined,
                  autosize: true,
                  margin: expandedChart === 'curve'
                    ? { l: 72, r: 92, t: 54, b: 82 }
                    : { l: 104, r: 132, t: 54, b: 82 },
                } as any}
                config={createCsvExportConfig(
                  expandedChart === 'curve' ? 'phase-escape-curve.csv' : 'phase-escape-timeseries.csv',
                  { displayModeBar: true, responsive: true }
                )}
                style={{ width: '100%', height: 'calc(86vh - 112px)' }}
                useResizeHandler
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
