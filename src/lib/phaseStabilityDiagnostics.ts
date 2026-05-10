import {
  HistoricalAnalogue,
  PhaseStabilityEnvelopeBin,
  PhaseStabilityResult,
  PhaseStabilitySample,
  PhaseStabilityState,
} from './types';

export const Z_WATCH_THRESHOLD = 1.5;
export const Z_EXCURSION_THRESHOLD = 2.5;
export const Z_ESCAPE_THRESHOLD = 3.5;
export const CURVATURE_WATCH_THRESHOLD = 0.4;
export const CURVATURE_EXCURSION_THRESHOLD = 0.6;
export const CURVATURE_ESCAPE_THRESHOLD = 0.8;
export const COUPLING_WATCH_THRESHOLD = 0.25;
export const COUPLING_EXCURSION_THRESHOLD = 0.5;
export const COUPLING_ESCAPE_THRESHOLD = 0.75;

const DEFAULT_BIN_COUNT = 72;
const DEFAULT_RECENT_DAYS = 180;
const MIN_BIN_COUNT = 5;
const SIGMA_FLOOR = 1e-5;
const DAY_MS = 24 * 60 * 60 * 1000;
const EPSILON = 1e-9;

export interface PhaseConditionedInputSample {
  date: string;
  theta: number;
  omega: number;
}

export interface PhaseStabilityOptions {
  historicalStartDate?: string;
  historicalEndDate?: string;
  recentDays?: number;
  binCount?: number;
}

interface PreparedSample extends PhaseConditionedInputSample {
  time: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function median(values: number[]): number {
  const valid = values.filter(isFiniteNumber).sort((a, b) => a - b);
  if (valid.length === 0) return NaN;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 === 0 ? (valid[mid - 1] + valid[mid]) / 2 : valid[mid];
}

function mean(values: number[]): number {
  const valid = values.filter(isFiniteNumber);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : NaN;
}

function std(values: number[]): number {
  const valid = values.filter(isFiniteNumber);
  if (valid.length < 2) return NaN;
  const avg = mean(valid);
  return Math.sqrt(valid.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (valid.length - 1));
}

function madSigma(values: number[]): number {
  const center = median(values);
  if (!Number.isFinite(center)) return NaN;
  const mad = median(values.map(value => Math.abs(value - center)));
  return Number.isFinite(mad) ? 1.4826 * mad : NaN;
}

function robustScale(values: number[]): number {
  const robust = madSigma(values);
  const fallback = std(values);
  const selected = Number.isFinite(robust) && robust > SIGMA_FLOOR ? robust : fallback;
  return Number.isFinite(selected) ? Math.max(selected, SIGMA_FLOOR) : NaN;
}

export function wrapAngle(theta: number): number {
  if (!Number.isFinite(theta)) return NaN;
  let value = ((theta + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  if (value === -Math.PI) value = Math.PI;
  return value;
}

function thetaToBin(theta: number, binCount: number): number | null {
  const wrapped = wrapAngle(theta);
  if (!Number.isFinite(wrapped)) return null;
  const normalized = (wrapped + Math.PI) / (2 * Math.PI);
  return Math.min(binCount - 1, Math.max(0, Math.floor(normalized * binCount)));
}

function binCenter(bin: number, binCount: number): number {
  return -Math.PI + ((bin + 0.5) / binCount) * 2 * Math.PI;
}

function parseTime(date: string, fallbackIndex: number): number {
  const time = new Date(date).getTime();
  return Number.isFinite(time) ? time : fallbackIndex * DAY_MS;
}

function prepareSamples(samples: PhaseConditionedInputSample[]): PreparedSample[] {
  return samples
    .map((sample, index) => ({
      date: sample.date,
      theta: sample.theta,
      omega: sample.omega,
      time: parseTime(sample.date, index),
    }))
    .filter(sample => isFiniteNumber(sample.theta) && isFiniteNumber(sample.omega))
    .sort((a, b) => a.time - b.time);
}

function historicalSlice(samples: PreparedSample[], options: PhaseStabilityOptions): PreparedSample[] {
  const start = options.historicalStartDate ? new Date(options.historicalStartDate).getTime() : -Infinity;
  const end = options.historicalEndDate ? new Date(options.historicalEndDate).getTime() : Infinity;
  const latestTime = samples[samples.length - 1]?.time ?? Infinity;
  const recentDays = options.recentDays ?? DEFAULT_RECENT_DAYS;
  const recentStart = latestTime - recentDays * DAY_MS;
  const explicitWindow = options.historicalStartDate || options.historicalEndDate;

  return samples.filter(sample => {
    if (sample.time < start || sample.time > end) return false;
    return explicitWindow ? true : sample.time < recentStart;
  });
}

export function buildPhaseConditionedEnvelope(
  samples: PhaseConditionedInputSample[],
  options: PhaseStabilityOptions = {}
): PhaseStabilityEnvelopeBin[] {
  const binCount = options.binCount ?? DEFAULT_BIN_COUNT;
  const prepared = prepareSamples(samples);
  const history = historicalSlice(prepared, options);
  const bins = Array.from({ length: binCount }, () => [] as number[]);

  history.forEach(sample => {
    const bin = thetaToBin(sample.theta, binCount);
    if (bin !== null) bins[bin].push(sample.omega);
  });

  return bins.map((values, bin) => {
    const enough = values.length >= MIN_BIN_COUNT;
    return {
      theta: binCenter(bin, binCount),
      bin,
      count: values.length,
      muOmega: enough ? median(values) : null,
      sigmaOmega: enough ? robustScale(values) : null,
    };
  });
}

function smooth(values: number[], radius = 2): number[] {
  return values.map((_, index) => {
    const slice = values.slice(Math.max(0, index - radius), Math.min(values.length, index + radius + 1));
    return mean(slice);
  });
}

function unwrapAngles(values: number[]): number[] {
  if (values.length === 0) return [];
  const out = [values[0]];
  for (let index = 1; index < values.length; index++) {
    let value = values[index];
    const previous = out[index - 1];
    while (value - previous > Math.PI) value -= 2 * Math.PI;
    while (value - previous < -Math.PI) value += 2 * Math.PI;
    out.push(value);
  }
  return out;
}

function firstDerivative(values: number[], timeDays: number[]): number[] {
  return values.map((_, index) => {
    const prev = Math.max(0, index - 1);
    const next = Math.min(values.length - 1, index + 1);
    const dt = timeDays[next] - timeDays[prev];
    return Math.abs(dt) > EPSILON ? (values[next] - values[prev]) / dt : NaN;
  });
}

function percentileRankNormalize(values: Array<number | null>): Array<number | null> {
  const valid = values.filter(isFiniteNumber).sort((a, b) => a - b);
  if (valid.length === 0) return values.map(() => null);
  const maxIndex = Math.max(1, valid.length - 1);
  return values.map(value => {
    if (!isFiniteNumber(value)) return null;
    let lower = 0;
    while (lower < valid.length && valid[lower] <= value) lower += 1;
    return Math.min(1, Math.max(0, (lower - 1) / maxIndex));
  });
}

function computeCurvature(samples: PreparedSample[]): { raw: Array<number | null>; norm: Array<number | null> } {
  if (samples.length < 5) {
    return { raw: samples.map(() => null), norm: samples.map(() => null) };
  }

  const timeDays = samples.map(sample => sample.time / DAY_MS);
  const theta = smooth(unwrapAngles(samples.map(sample => sample.theta)));
  const omega = smooth(samples.map(sample => sample.omega));
  const thetaDot = firstDerivative(theta, timeDays);
  const omegaDot = firstDerivative(omega, timeDays);
  const thetaDDot = firstDerivative(thetaDot, timeDays);
  const omegaDDot = firstDerivative(omegaDot, timeDays);
  const raw = samples.map((_, index) => {
    const numerator = Math.abs(thetaDot[index] * omegaDDot[index] - omegaDot[index] * thetaDDot[index]);
    const denominator = (thetaDot[index] ** 2 + omegaDot[index] ** 2) ** 1.5;
    const value = numerator / Math.max(denominator, EPSILON);
    return Number.isFinite(value) ? value : null;
  });

  return { raw, norm: percentileRankNormalize(raw) };
}

function classifyZ(absZ: number | null): PhaseStabilityState {
  if (!isFiniteNumber(absZ)) return 'insufficient_data';
  if (absZ < Z_WATCH_THRESHOLD) return 'stable';
  if (absZ < Z_EXCURSION_THRESHOLD) return 'watch';
  if (absZ < Z_ESCAPE_THRESHOLD) return 'excursion';
  return 'escape_candidate';
}

function classifyCoupling(value: number | null): PhaseStabilityState {
  if (!isFiniteNumber(value)) return 'insufficient_data';
  if (value < COUPLING_WATCH_THRESHOLD) return 'stable';
  if (value < COUPLING_EXCURSION_THRESHOLD) return 'watch';
  if (value < COUPLING_ESCAPE_THRESHOLD) return 'excursion';
  return 'escape_candidate';
}

function combineStates(zState: PhaseStabilityState, couplingState: PhaseStabilityState): PhaseStabilityState {
  const rank: Record<PhaseStabilityState, number> = {
    insufficient_data: -1,
    stable: 0,
    watch: 1,
    excursion: 2,
    escape_candidate: 3,
  };
  return rank[couplingState] >= rank[zState] ? couplingState : zState;
}

function computeHysteresis(
  recent: PreparedSample[],
  envelope: PhaseStabilityEnvelopeBin[],
  binCount: number
): { raw: number | null; norm: number | null; note?: string } {
  if (recent.length < 12) {
    return { raw: null, norm: null, note: 'insufficient return path' };
  }

  const unwrapped = unwrapAngles(recent.map(sample => sample.theta));
  const first = unwrapped[0];
  const last = unwrapped[unwrapped.length - 1];
  const direction = last >= first ? 1 : -1;
  const extremes = unwrapped.map((theta, index) => ({ theta, index })).sort((a, b) => direction * (b.theta - a.theta));
  const turnIndex = extremes[0]?.index ?? -1;
  if (turnIndex < 3 || turnIndex > recent.length - 4) {
    return { raw: null, norm: null, note: 'insufficient return path' };
  }

  const outbound = recent.slice(0, turnIndex + 1);
  const inbound = recent.slice(turnIndex + 1);
  const binValues = new Map<number, { out: number[]; in: number[] }>();
  outbound.forEach(sample => {
    const bin = thetaToBin(sample.theta, binCount);
    if (bin === null) return;
    const entry = binValues.get(bin) ?? { out: [], in: [] };
    entry.out.push(sample.omega);
    binValues.set(bin, entry);
  });
  inbound.forEach(sample => {
    const bin = thetaToBin(sample.theta, binCount);
    if (bin === null) return;
    const entry = binValues.get(bin) ?? { out: [], in: [] };
    entry.in.push(sample.omega);
    binValues.set(bin, entry);
  });

  const scores: number[] = [];
  binValues.forEach((entry, bin) => {
    if (entry.out.length < 2 || entry.in.length < 2) return;
    const sigma = envelope[bin]?.sigmaOmega;
    if (!isFiniteNumber(sigma) || sigma <= 0) return;
    scores.push(Math.abs(median(entry.out) - median(entry.in)) / sigma);
  });

  if (scores.length === 0) {
    return { raw: null, norm: null, note: 'insufficient return path' };
  }

  const raw = median(scores);
  return { raw, norm: Math.min(raw / 3, 1) };
}

function resamplePath(samples: PreparedSample[], points: number): Array<[number, number]> {
  if (samples.length === 0) return [];
  if (samples.length === 1) return Array.from({ length: points }, () => [samples[0].theta, samples[0].omega]);
  const theta = unwrapAngles(samples.map(sample => sample.theta));
  return Array.from({ length: points }, (_, outputIndex) => {
    const position = (outputIndex / Math.max(1, points - 1)) * (samples.length - 1);
    const low = Math.floor(position);
    const high = Math.min(samples.length - 1, Math.ceil(position));
    const fraction = position - low;
    return [
      theta[low] + (theta[high] - theta[low]) * fraction,
      samples[low].omega + (samples[high].omega - samples[low].omega) * fraction,
    ];
  });
}

function normalizePath(path: Array<[number, number]>): Array<[number, number]> {
  const theta = path.map(point => point[0]);
  const omega = path.map(point => point[1]);
  const thetaMean = mean(theta);
  const omegaMean = mean(omega);
  const thetaScale = std(theta) || 1;
  const omegaScale = std(omega) || 1;
  return path.map(point => [(point[0] - thetaMean) / thetaScale, (point[1] - omegaMean) / omegaScale]);
}

function pathDistance(a: Array<[number, number]>, b: Array<[number, number]>): number {
  const count = Math.min(a.length, b.length);
  if (count === 0) return Infinity;
  const total = Array.from({ length: count }, (_, index) => {
    const dx = a[index][0] - b[index][0];
    const dy = a[index][1] - b[index][1];
    return Math.sqrt(dx * dx + dy * dy);
  }).reduce((sum, value) => sum + value, 0);
  return total / count;
}

function computeHistoricalAnalogues(
  samples: PreparedSample[],
  recent: PreparedSample[],
  recentDays: number
): HistoricalAnalogue[] {
  if (recent.length < 12) return [];
  const latestTime = samples[samples.length - 1]?.time ?? Infinity;
  const recentStart = latestTime - recentDays * DAY_MS;
  const windowLength = recent.length;
  const step = Math.max(1, Math.floor(windowLength / 4));
  const target = normalizePath(resamplePath(recent, 64));
  const analogues: HistoricalAnalogue[] = [];

  for (let start = 0; start + windowLength <= samples.length; start += step) {
    const candidate = samples.slice(start, start + windowLength);
    if (candidate[candidate.length - 1].time >= recentStart) continue;
    const candidatePath = normalizePath(resamplePath(candidate, 64));
    const distance = pathDistance(target, candidatePath);
    if (!Number.isFinite(distance)) continue;
    const similarity = Math.exp(-distance / 0.65);
    analogues.push({
      startDate: candidate[0].date,
      endDate: candidate[candidate.length - 1].date,
      similarity: Math.max(0, Math.min(1, similarity)),
      distance,
    });
  }

  return analogues.sort((a, b) => b.similarity - a.similarity).slice(0, 3);
}

function weightedCouplingIndex(values: {
  absZNorm: number | null;
  curvatureNorm: number | null;
  manifoldDeparture: number | null;
  hysteresisNorm: number | null;
  analogueSimilarity: number | null;
}): number | null {
  const weighted = [
    { value: values.absZNorm, weight: 0.30 },
    { value: values.curvatureNorm, weight: 0.20 },
    { value: values.manifoldDeparture, weight: 0.25 },
    { value: values.hysteresisNorm, weight: 0.10 },
    { value: isFiniteNumber(values.analogueSimilarity) ? 1 - values.analogueSimilarity : null, weight: 0.15 },
  ].filter(entry => isFiniteNumber(entry.value));

  const weightSum = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (weightSum <= 0) return null;
  return weighted.reduce((sum, entry) => sum + (entry.value as number) * entry.weight, 0) / weightSum;
}

export function computePhaseConditionedAnomaly(
  samples: PhaseConditionedInputSample[],
  options: PhaseStabilityOptions = {}
): PhaseStabilityResult {
  const binCount = options.binCount ?? DEFAULT_BIN_COUNT;
  const recentDays = options.recentDays ?? DEFAULT_RECENT_DAYS;
  const prepared = prepareSamples(samples);
  if (prepared.length === 0) {
    return { samples: [], envelope: [], summary: null };
  }

  const envelope = buildPhaseConditionedEnvelope(prepared, { ...options, binCount });
  const latestTime = prepared[prepared.length - 1].time;
  const recentStart = latestTime - recentDays * DAY_MS;
  const recent = prepared.filter(sample => sample.time >= recentStart);
  const curvature = computeCurvature(prepared);
  const hysteresis = computeHysteresis(recent, envelope, binCount);
  const topAnalogues = computeHistoricalAnalogues(prepared, recent, recentDays);
  const bestAnalogue = topAnalogues[0]?.similarity ?? null;

  const diagnosticSamples: PhaseStabilitySample[] = prepared.map((sample, index) => {
    const thetaBin = thetaToBin(sample.theta, binCount);
    const bin = thetaBin !== null ? envelope[thetaBin] : null;
    const sigma = bin?.sigmaOmega ?? null;
    const mu = bin?.muOmega ?? null;
    const zOmega = isFiniteNumber(mu) && isFiniteNumber(sigma) && sigma > 0 ? (sample.omega - mu) / sigma : null;
    const absZNorm = isFiniteNumber(zOmega) ? Math.min(Math.abs(zOmega) / Z_ESCAPE_THRESHOLD, 1) : null;
    const manifoldDeparture = absZNorm;
    const isRecent = sample.time >= recentStart;
    const couplingStabilityIndex = weightedCouplingIndex({
      absZNorm,
      curvatureNorm: curvature.norm[index],
      manifoldDeparture,
      hysteresisNorm: isRecent ? hysteresis.norm : null,
      analogueSimilarity: isRecent ? bestAnalogue : null,
    });
    const zState = classifyZ(isFiniteNumber(zOmega) ? Math.abs(zOmega) : null);
    const state = zState === 'insufficient_data'
      ? 'insufficient_data'
      : combineStates(zState, classifyCoupling(couplingStabilityIndex));

    return {
      date: sample.date,
      theta: wrapAngle(sample.theta),
      omega: sample.omega,
      thetaBin,
      muOmega: mu,
      sigmaOmega: sigma,
      zOmega,
      absZNorm,
      curvature: curvature.raw[index],
      curvatureNorm: curvature.norm[index],
      manifoldDeparture,
      hysteresisIndex: isRecent ? hysteresis.raw : null,
      analogueSimilarity: isRecent ? bestAnalogue : null,
      couplingStabilityIndex,
      state,
    };
  });

  const latest = diagnosticSamples[diagnosticSamples.length - 1];
  return {
    samples: diagnosticSamples,
    envelope,
    summary: latest ? {
      latestDate: latest.date,
      latest,
      topAnalogues,
      hysteresisIndex: hysteresis.raw,
      state: latest.state,
    } : null,
  };
}

export const computePhaseStabilityDiagnostics = computePhaseConditionedAnomaly;
