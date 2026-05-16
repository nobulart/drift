'use client';

import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/store/useStore';
import {
  DEFAULT_PHASE_ESCAPE_MODELS,
  PhaseEscapeCompositeKey,
  classifyEnergyState,
  computePhaseDrift,
  energyBarrierRatio,
  escapeEnergyBarrier,
  kramersLikeEscapeIndex,
  phaseKineticEnergy,
  phasePotentialEnergy,
  phaseTotalEnergy,
  radiansToDegrees,
  smoothExp,
} from '@/lib/phaseEscapeModel';
import {
  MATSUYAMA_PROXY_DESCRIPTION,
  computeQDriftProxy,
  formatQDriftProxy,
} from '@/lib/matsuyamaProxy';

interface PhaseEscapeRecord {
  t: string;
  thetaResidual: number | null;
  rRatio: number | null;
  misalignment: Record<PhaseEscapeCompositeKey, number | null>;
}

interface PhaseEscapeDataset {
  records: PhaseEscapeRecord[];
}

interface ProxySample {
  t: string;
  kineticEnergy: number;
  potentialEnergy: number;
  totalPhaseEnergy: number;
  barrier: number;
  barrierRatio: number | null;
  qDriftProxy: number | null;
  energyState: string;
  kramersIndex: number | null;
}

const SELECTED_COMPOSITE: PhaseEscapeCompositeKey = 'Venus_Mars';
const SPARKLINE_POINTS = 72;
const THRESHOLDS = [0, 0.25, 0.5, 0.8, 1];
const HELP_TEXT =
  'Matsuyama et al. use Q to compare load forcing against remnant-bulge stabilization. DRIFT’s proxy compares phase energy against estimated basin barrier.';

function regimeTone(regime: string) {
  if (regime === 'deeply sub-barrier') return 'border-[#1d4ed8] bg-[#172554] text-[#bfdbfe]';
  if (regime === 'sub-barrier') return 'border-[#0891b2] bg-[#083344] text-[#a5f3fc]';
  if (regime === 'elevated') return 'border-[#92400e] bg-[#451a03] text-[#fed7aa]';
  if (regime === 'near-threshold') return 'border-[#f97316] bg-[#431407] text-[#fed7aa]';
  if (regime === 'super-barrier proxy') return 'border-[#b91c1c] bg-[#450a0a] text-[#fecaca]';
  return 'border-[#4b5563] bg-[#1f2937] text-[#d1d5db]';
}

function formatEnergy(value: number) {
  return Number.isFinite(value) ? value.toFixed(4) : 'n/a';
}

function markerPosition(q: number | null) {
  if (q === null || !Number.isFinite(q)) {
    return null;
  }

  return `${Math.max(0, Math.min(1, q)) * 100}%`;
}

function buildSparklinePath(values: Array<number | null>) {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (finite.length < 2) {
    return null;
  }

  const max = Math.max(1, ...finite);
  const width = 100;
  const height = 32;
  const lastIndex = Math.max(1, values.length - 1);
  const commands: string[] = [];

  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      return;
    }

    const x = (index / lastIndex) * width;
    const y = height - (Math.max(0, Math.min(max, value)) / max) * height;
    commands.push(`${commands.length === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`);
  });

  return commands.length >= 2 ? commands.join(' ') : null;
}

function ThresholdGauge({ q }: { q: number | null }) {
  const left = markerPosition(q);

  return (
    <div className="mt-4" title={HELP_TEXT}>
      <div className="relative h-3 overflow-hidden rounded-full border border-[#334155] bg-[#020617]">
        <div className="absolute inset-y-0 left-0 bg-[#1d4ed8]" style={{ width: '25%' }} />
        <div className="absolute inset-y-0 left-[25%] bg-[#0891b2]" style={{ width: '25%' }} />
        <div className="absolute inset-y-0 left-[50%] bg-[#ca8a04]" style={{ width: '30%' }} />
        <div className="absolute inset-y-0 left-[80%] bg-[#f97316]" style={{ width: '20%' }} />
        {left && (
          <div
            className="absolute top-1/2 h-6 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.75)]"
            style={{ left }}
            aria-label="Current DRIFT proxy Q marker"
          />
        )}
      </div>
      <div className="mt-2 grid grid-cols-5 text-[10px] font-semibold text-[#93a4bb]">
        {THRESHOLDS.map((threshold) => (
          <span key={threshold} className="first:text-left last:text-right [&:not(:first-child):not(:last-child)]:text-center">
            {threshold.toFixed(threshold === 0 || threshold === 1 ? 0 : 2)}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function MatsuyamaProxyPanel() {
  const [dataset, setDataset] = useState<PhaseEscapeDataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const windowSize = useStore(state => state.windowSize);
  const turnThreshold = useStore(state => state.turnThreshold);
  const eopDataset = useStore(state => state.eopDataset);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      windowSize: String(windowSize),
      turnThreshold: String(turnThreshold),
      smoothDays: '31',
      dataset: eopDataset,
      view: 'panel',
      composite: SELECTED_COMPOSITE,
    });

    fetch(`/api/phase-escape?${params.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to load Matsuyama proxy inputs');
        }
        return response.json();
      })
      .then((payload: PhaseEscapeDataset) => {
        if (active) {
          setDataset(payload);
        }
      })
      .catch(err => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to load Matsuyama proxy inputs');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [eopDataset, turnThreshold, windowSize]);

  const samples = useMemo<ProxySample[]>(() => {
    const records = dataset?.records ?? [];
    const model = DEFAULT_PHASE_ESCAPE_MODELS[SELECTED_COMPOSITE];
    const phiSeriesDeg = records.map(record => {
      const phi = record.misalignment?.[SELECTED_COMPOSITE];
      return typeof phi === 'number' && Number.isFinite(phi) ? radiansToDegrees(phi) : NaN;
    });
    const phiSmoothDeg = smoothExp(phiSeriesDeg, 0.25);
    const timeSeriesMs = records.map(record => new Date(record.t).getTime());
    const phaseDriftSeries = computePhaseDrift(phiSmoothDeg, timeSeriesMs);
    const barrier = escapeEnergyBarrier(model.alpha);

    return records.map((record, index) => {
      const phiDeg = phiSeriesDeg[index];
      const dphi = phaseDriftSeries[index];
      const kineticEnergy = phaseKineticEnergy(dphi);
      const potentialEnergy = phasePotentialEnergy(phiDeg, model.phi0Deg, model.alpha);
      const totalPhaseEnergy = phaseTotalEnergy(phiDeg, model.phi0Deg, dphi, model.alpha);
      const barrierRatio = energyBarrierRatio(totalPhaseEnergy, barrier);
      const proxy = computeQDriftProxy({ totalPhaseEnergy, barrier, barrierRatio });
      const kramersIndex = kramersLikeEscapeIndex(totalPhaseEnergy, barrier, record.rRatio ?? NaN);

      return {
        t: record.t,
        kineticEnergy,
        potentialEnergy,
        totalPhaseEnergy,
        barrier,
        barrierRatio,
        qDriftProxy: proxy.qDriftProxy,
        energyState: classifyEnergyState(barrierRatio),
        kramersIndex,
      };
    });
  }, [dataset]);

  const latest = useMemo(() => {
    for (let index = samples.length - 1; index >= 0; index--) {
      if (samples[index].qDriftProxy !== null) {
        return samples[index];
      }
    }

    return samples[samples.length - 1] ?? null;
  }, [samples]);

  const proxy = computeQDriftProxy({
    totalPhaseEnergy: latest?.totalPhaseEnergy,
    barrier: latest?.barrier,
    barrierRatio: latest?.barrierRatio,
  });
  const sparklineValues = samples.slice(-SPARKLINE_POINTS).map(sample => sample.qDriftProxy);
  const sparklinePath = buildSparklinePath(sparklineValues);

  if (loading && !dataset) {
    return (
      <div className="flex h-full min-h-[260px] items-center justify-center bg-[#0b1220] p-4 text-sm text-[#9ca3af]">
        Computing Matsuyama-normalized DRIFT proxy coordinate...
      </div>
    );
  }

  if (error) {
    return <div className="bg-[#0b1220] p-4 text-sm text-red-400">{error}</div>;
  }

  if (!latest) {
    return (
      <div className="bg-[#0b1220] p-4 text-sm text-[#9ca3af]">
        Matsuyama proxy inputs are not available yet.
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-auto bg-[#0b1220] p-4">
      <div className="rounded-lg border border-[#243041] bg-[#111827] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#93c5fd]">
              Matsuyama-normalized proxy coordinate
            </p>
            <h3 className="mt-2 text-xl font-semibold text-white">
              Current Q_DRIFT proxy: {formatQDriftProxy(proxy.qDriftProxy)}
            </h3>
            <p className="mt-1 text-xs text-[#9ca3af]">Latest sample: {latest.t}</p>
          </div>
          <div className={`rounded-lg border px-3 py-2 text-sm font-semibold ${regimeTone(proxy.regime)}`} title={HELP_TEXT}>
            {proxy.regime}
          </div>
        </div>

        <ThresholdGauge q={proxy.qDriftProxy} />

        <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <div className="rounded-lg border border-[#243041] bg-[#0b1220] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#93a4bb]">Kinetic energy</p>
            <p className="mt-1 text-lg font-semibold text-[#e5e7eb]">{formatEnergy(latest.kineticEnergy)}</p>
          </div>
          <div className="rounded-lg border border-[#243041] bg-[#0b1220] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#93a4bb]">Potential energy</p>
            <p className="mt-1 text-lg font-semibold text-[#e5e7eb]">{formatEnergy(latest.potentialEnergy)}</p>
          </div>
          <div className="rounded-lg border border-[#243041] bg-[#0b1220] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#93a4bb]">Total phase energy</p>
            <p className="mt-1 text-lg font-semibold text-[#e5e7eb]">{formatEnergy(latest.totalPhaseEnergy)}</p>
          </div>
          <div className="rounded-lg border border-[#243041] bg-[#0b1220] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#93a4bb]">Barrier</p>
            <p className="mt-1 text-lg font-semibold text-[#e5e7eb]">{formatEnergy(latest.barrier)}</p>
          </div>
          <div className="rounded-lg border border-[#243041] bg-[#0b1220] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#93a4bb]">Energy state</p>
            <p className="mt-1 break-words text-lg font-semibold leading-snug text-[#e5e7eb]">{latest.energyState}</p>
          </div>
          <div className="rounded-lg border border-[#243041] bg-[#0b1220] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#93a4bb]">Kramers-like index</p>
            <p className="mt-1 text-lg font-semibold text-[#e5e7eb]">{latest.kramersIndex !== null ? latest.kramersIndex.toExponential(2) : 'n/a'}</p>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-[#243041] bg-[#0b1220] p-3" title={HELP_TEXT}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#93a4bb]">
              Recent proxy trace
            </p>
            <span className="text-[11px] text-[#64748b]">derived from phase-energy / barrier series</span>
          </div>
          {sparklinePath ? (
            <svg viewBox="0 0 100 32" className="h-12 w-full overflow-visible" role="img" aria-label="Recent Q_DRIFT proxy sparkline">
              <line x1="0" x2="100" y1="0" y2="0" stroke="#ef4444" strokeWidth="0.8" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
              <path d={sparklinePath} fill="none" stroke="#38bdf8" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
          ) : (
            <p className="text-sm text-[#9ca3af]">Historical proxy support is not available for this view yet.</p>
          )}
        </div>

        <p className="mt-4 text-sm leading-6 text-[#d1d5db]">{MATSUYAMA_PROXY_DESCRIPTION}</p>
        <p className="mt-2 text-xs leading-5 text-[#93a4bb]" title={HELP_TEXT}>
          {HELP_TEXT}
        </p>
      </div>
    </div>
  );
}
