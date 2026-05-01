export interface PhaseEscapeCoefficients {
  beta0: number;
  betaCos: number;
  betaSin: number;
}

export interface PhaseEscapeModel extends PhaseEscapeCoefficients {
  key: string;
  label: string;
  weights: Record<string, number>;
  alpha: number;
  phi0Deg: number;
  maxMinEscapeProbabilityRatio: number;
  lrP: number;
}

export type PhaseEscapeCompositeKey =
  | 'Venus_Mars'
  | 'Venus_Mars_Jupiter'
  | 'Mercury_Venus_Mars'
  | 'All_NonSolar_Major';

export const TWO_WELL_CALIBRATION = {
  primaryDeg: 132.5,
  secondaryDeg: -102.5,
  note: 'empirical two-well residual phase potential from calibration run',
} as const;

export const DEFAULT_PHASE_ESCAPE_MODELS: Record<PhaseEscapeCompositeKey, PhaseEscapeModel> = {
  Venus_Mars: {
    key: 'Venus_Mars',
    label: 'Venus-Mars',
    weights: { venus: 1, mars: 1 },
    beta0: -1.648139,
    betaCos: 0.245000,
    betaSin: 0.059336,
    alpha: 0.252083,
    phi0Deg: 13.614173,
    maxMinEscapeProbabilityRatio: 1.525489,
    lrP: 3.275042e-16,
  },
  Venus_Mars_Jupiter: {
    key: 'Venus_Mars_Jupiter',
    label: 'Venus-Mars-Jupiter',
    weights: { venus: 1, mars: 1, jupiter: 1 },
    beta0: -1.643976,
    betaCos: 0.159756,
    betaSin: 0.092633,
    alpha: 0.184669,
    phi0Deg: 30.106873,
    maxMinEscapeProbabilityRatio: 1.362526,
    lrP: 4.667994e-09,
  },
  Mercury_Venus_Mars: {
    key: 'Mercury_Venus_Mars',
    label: 'Mercury-Venus-Mars',
    weights: { mercury: 1, venus: 1, mars: 1 },
    beta0: -1.639762,
    betaCos: 0.144485,
    betaSin: 0.103348,
    alpha: 0.177642,
    phi0Deg: 35.575624,
    maxMinEscapeProbabilityRatio: 1.346316,
    lrP: 1.994449e-08,
  },
  All_NonSolar_Major: {
    key: 'All_NonSolar_Major',
    label: 'All Non-Solar Major',
    weights: {
      mercury: 1,
      venus: 1,
      mars: 1,
      jupiter: 1,
      saturn: 1,
      uranus: 1,
      neptune: 1,
      moon: 1,
    },
    beta0: -1.636641,
    betaCos: 0.052615,
    betaSin: 0.042045,
    alpha: 0.067351,
    phi0Deg: 38.628486,
    maxMinEscapeProbabilityRatio: 1.119346,
    lrP: 7.848093e-02,
  },
};

export function wrapPhase(rad: number): number {
  if (!Number.isFinite(rad)) {
    return NaN;
  }

  const twoPi = 2 * Math.PI;
  const wrapped = ((rad + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

export function wrapDegrees(angle: number): number {
  if (!Number.isFinite(angle)) {
    return NaN;
  }

  const wrapped = ((angle + 180) % 360 + 360) % 360 - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

export function angularDiff(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return NaN;
  }

  let diff = a - b;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return Object.is(diff, -0) ? 0 : diff;
}

export function clamp(x: number, min: number, max: number): number {
  if (!Number.isFinite(x)) {
    return NaN;
  }

  return Math.max(min, Math.min(max, x));
}

export function sigmoid(x: number): number {
  if (x >= 0) {
    return 1 / (1 + Math.exp(-x));
  }

  const z = Math.exp(x);
  return z / (1 + z);
}

export function compositePhase(phases: Record<string, number>, weights: Record<string, number>): number {
  let real = 0;
  let imaginary = 0;
  let used = 0;

  for (const [body, weight] of Object.entries(weights)) {
    const phase = phases[body];
    if (!Number.isFinite(phase) || !Number.isFinite(weight) || weight === 0) {
      continue;
    }

    real += weight * Math.cos(phase);
    imaginary += weight * Math.sin(phase);
    used += 1;
  }

  if (used === 0 || (Math.abs(real) < 1e-12 && Math.abs(imaginary) < 1e-12)) {
    return NaN;
  }

  return wrapPhase(Math.atan2(imaginary, real));
}

export function escapeProbability(phi: number, coeffs: PhaseEscapeCoefficients): number {
  if (!Number.isFinite(phi)) {
    return NaN;
  }

  return sigmoid(coeffs.beta0 + coeffs.betaCos * Math.cos(phi) + coeffs.betaSin * Math.sin(phi));
}

export function phaseMisalignment(thetaResidual: number, compositePhaseValue: number): number {
  return wrapPhase(thetaResidual - compositePhaseValue);
}

export function computeThetaResidual(thetaRaw: number, sunPhase: number): number {
  return wrapPhase(thetaRaw - sunPhase);
}

export function degToRad(degrees: number): number {
  return degrees * Math.PI / 180;
}

export function degreesToRadians(degrees: number): number {
  return degToRad(degrees);
}

export function radiansToDegrees(radians: number): number {
  return radians * 180 / Math.PI;
}

export function angularDistanceDegrees(a: number, b: number): number {
  return Math.abs(wrapDegrees(a - b));
}

export function movingAverage(series: number[], window = 7): number[] {
  const radius = Math.max(0, Math.floor(window / 2));

  return series.map((_, index) => {
    const values: number[] = [];
    for (let offset = -radius; offset <= radius; offset++) {
      const value = series[index + offset];
      if (Number.isFinite(value)) {
        values.push(value);
      }
    }

    if (values.length === 0) {
      return NaN;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
  });
}

export function smoothExp(series: number[], alpha = 0.25): number[] {
  const out: number[] = [];
  let prev = series.find(Number.isFinite) ?? NaN;

  for (const value of series) {
    if (!Number.isFinite(value)) {
      out.push(prev);
      continue;
    }

    if (!Number.isFinite(prev)) {
      prev = value;
    }

    const smoothed = alpha * value + (1 - alpha) * prev;
    out.push(smoothed);
    prev = smoothed;
  }

  return out;
}

export function computePhaseAcceleration(phiSeriesDeg: number[], timeSeriesMs: number[]): number[] {
  return phiSeriesDeg.map((_, index) => {
    if (!Number.isFinite(phiSeriesDeg[index]) || !Number.isFinite(timeSeriesMs[index])) {
      return NaN;
    }

    if (index === 0 || index === phiSeriesDeg.length - 1) {
      return NaN;
    }

    const dtForward = (timeSeriesMs[index + 1] - timeSeriesMs[index]) / (1000 * 86400);
    const dtBackward = (timeSeriesMs[index] - timeSeriesMs[index - 1]) / (1000 * 86400);
    const dt = (dtForward + dtBackward) / 2;

    if (!Number.isFinite(dt) || Math.abs(dt) < 1e-9) {
      return NaN;
    }

    const forward = angularDiff(phiSeriesDeg[index + 1], phiSeriesDeg[index]);
    const backward = angularDiff(phiSeriesDeg[index], phiSeriesDeg[index - 1]);
    return clamp((forward - backward) / (dt * dt), -50, 50);
  });
}

export function computePhaseDrift(phiSeriesDeg: number[], timeSeriesMs: number[]): number[] {
  return phiSeriesDeg.map((_, index) => {
    if (!Number.isFinite(phiSeriesDeg[index]) || !Number.isFinite(timeSeriesMs[index])) {
      return NaN;
    }

    const prevIndex = index === 0 ? 0 : index - 1;
    const nextIndex = index === phiSeriesDeg.length - 1 ? phiSeriesDeg.length - 1 : index + 1;

    if (prevIndex === nextIndex) {
      return NaN;
    }

    const dtDays = (timeSeriesMs[nextIndex] - timeSeriesMs[prevIndex]) / (1000 * 86400);
    if (!Number.isFinite(dtDays) || Math.abs(dtDays) < 1e-9) {
      return NaN;
    }

    const dphi = angularDiff(phiSeriesDeg[nextIndex], phiSeriesDeg[prevIndex]);
    return clamp(dphi / dtDays, -30, 30);
  });
}

export function classifyAcceleration(dphiDegPerDay: number, d2phiDegPerDay2: number): string {
  if (!Number.isFinite(dphiDegPerDay) || !Number.isFinite(d2phiDegPerDay2)) {
    return 'unknown';
  }

  if (Math.abs(d2phiDegPerDay2) < 0.05) {
    return 'linear drift';
  }

  return Math.sign(dphiDegPerDay) === Math.sign(d2phiDegPerDay2)
    ? 'accelerating'
    : 'decelerating';
}

export function curvatureSignal(
  phiDeg: number,
  phi0Deg: number,
  dphiDegPerDay: number,
  d2phiDegPerDay2: number
): string {
  if (
    !Number.isFinite(phiDeg) ||
    !Number.isFinite(phi0Deg) ||
    !Number.isFinite(dphiDegPerDay) ||
    !Number.isFinite(d2phiDegPerDay2)
  ) {
    return 'neutral curvature';
  }

  const delta = angularDiff(phi0Deg, phiDeg);
  const movingToward = Math.sign(delta) === Math.sign(dphiDegPerDay);
  const curvatureToward = Math.sign(delta) === Math.sign(d2phiDegPerDay2);

  if (!movingToward && curvatureToward) {
    return 'curving toward preferred phase';
  }

  if (movingToward && curvatureToward) {
    return 'accelerating toward preferred phase';
  }

  if (!curvatureToward && Math.abs(d2phiDegPerDay2) > 0.1) {
    return 'curving away';
  }

  return 'neutral curvature';
}

export function instabilityIndicator(
  phiDeg: number,
  phi0Deg: number,
  dphiDegPerDay: number,
  d2phiDegPerDay2: number
): string {
  return curvatureSignal(phiDeg, phi0Deg, dphiDegPerDay, d2phiDegPerDay2);
}

export type PhaseDirection = 'approaching' | 'receding' | 'stationary' | 'unknown';

export function classifyPhaseDirection(phiNowDeg: number, phi0Deg: number, dphiDegPerDay: number): PhaseDirection {
  if (!Number.isFinite(phiNowDeg) || !Number.isFinite(phi0Deg) || !Number.isFinite(dphiDegPerDay)) {
    return 'unknown';
  }

  if (Math.abs(dphiDegPerDay) <= 1e-9) {
    return 'stationary';
  }

  const deltaForward = wrapDegrees(phi0Deg - phiNowDeg);
  if (Math.abs(deltaForward) <= 1e-9) {
    return 'stationary';
  }

  return Math.sign(deltaForward) === Math.sign(dphiDegPerDay)
    ? 'approaching'
    : 'receding';
}

export function detectOscillatory(phiSeries: number[]): boolean {
  let signChanges = 0;

  for (let index = 2; index < phiSeries.length; index++) {
    const d1 = angularDiff(phiSeries[index - 1], phiSeries[index - 2]);
    const d2 = angularDiff(phiSeries[index], phiSeries[index - 1]);
    if (Math.sign(d1) !== Math.sign(d2)) {
      signChanges += 1;
    }
  }

  return signChanges > 3;
}

export function stabilityScore(dphiDegPerDay: number, d2phiDegPerDay2: number): number {
  if (!Number.isFinite(dphiDegPerDay) || !Number.isFinite(d2phiDegPerDay2)) {
    return NaN;
  }

  return 1 / (1 + Math.abs(dphiDegPerDay) + 0.5 * Math.abs(d2phiDegPerDay2));
}

export function phaseKineticEnergy(dphiDegPerDay: number): number {
  if (!Number.isFinite(dphiDegPerDay)) {
    return NaN;
  }

  const omega = degToRad(dphiDegPerDay);
  return 0.5 * omega * omega;
}

export function phasePotentialEnergy(phiDeg: number, phi0Deg: number, alpha: number): number {
  if (!Number.isFinite(phiDeg) || !Number.isFinite(phi0Deg) || !Number.isFinite(alpha)) {
    return NaN;
  }

  const offset = degToRad(angularDiff(phiDeg, phi0Deg));
  return alpha * (1 - Math.cos(offset));
}

export function phaseTotalEnergy(
  phiDeg: number,
  phi0Deg: number,
  dphiDegPerDay: number,
  alpha: number
): number {
  const kinetic = phaseKineticEnergy(dphiDegPerDay);
  const potential = phasePotentialEnergy(phiDeg, phi0Deg, alpha);

  if (!Number.isFinite(kinetic) || !Number.isFinite(potential)) {
    return NaN;
  }

  return kinetic + potential;
}

export function escapeEnergyBarrier(alpha: number): number {
  return Number.isFinite(alpha) ? 2 * alpha : NaN;
}

export function energyBarrierRatio(totalEnergy: number, barrier: number): number | null {
  if (!Number.isFinite(totalEnergy) || !Number.isFinite(barrier) || barrier <= 0) {
    return null;
  }

  return totalEnergy / barrier;
}

export function classifyEnergyState(ratio: number | null): string {
  if (ratio === null) {
    return 'unknown';
  }
  if (ratio < 0.25) {
    return 'deeply sub-barrier';
  }
  if (ratio < 0.50) {
    return 'sub-barrier';
  }
  if (ratio < 0.80) {
    return 'near-barrier';
  }
  if (ratio < 1.00) {
    return 'barrier approach';
  }
  return 'super-barrier';
}

export function kramersLikeEscapeIndex(totalEnergy: number, barrier: number, noiseProxy: number): number | null {
  if (!Number.isFinite(totalEnergy) || !Number.isFinite(barrier) || !Number.isFinite(noiseProxy)) {
    return null;
  }

  const diffusionProxy = Math.max(0.001, Math.abs(noiseProxy));
  return Math.exp(-(barrier - totalEnergy) / diffusionProxy);
}

export function escapeGradient(phiDeg: number, betaCos: number, betaSin: number): number {
  const phi = degreesToRadians(phiDeg);
  return -betaCos * Math.sin(phi) + betaSin * Math.cos(phi);
}

export function classifyPhaseRegion(deltaPhi: number): string {
  if (deltaPhi <= 20) {
    return 'near escape peak';
  }
  if (deltaPhi <= 60) {
    return 'shoulder region';
  }
  return 'background phase';
}

export function computeAlignmentStatus(direction: PhaseDirection, deltaPhi: number): string {
  if (deltaPhi <= 20) {
    return 'near preferred phase';
  }
  if (direction === 'approaching') {
    return 'approaching preferred phase';
  }
  if (direction === 'receding') {
    return 'receding from preferred phase';
  }
  return 'phase-stationary';
}

export function estimateTimeToAlignmentDays(
  phiNowDeg: number,
  phi0Deg: number,
  dphiDegPerDay: number,
  direction: PhaseDirection = classifyPhaseDirection(phiNowDeg, phi0Deg, dphiDegPerDay),
  minRateDegPerDay = 0.01,
  maxDays = 3650
): number | null {
  if (!Number.isFinite(phiNowDeg) || !Number.isFinite(phi0Deg) || !Number.isFinite(dphiDegPerDay)) {
    return null;
  }

  const delta = angularDistanceDegrees(phiNowDeg, phi0Deg);
  if (delta <= 1e-9) {
    return 0;
  }

  if (direction !== 'approaching') {
    return null;
  }

  if (Math.abs(dphiDegPerDay) <= minRateDegPerDay) {
    return null;
  }

  const days = delta / Math.abs(dphiDegPerDay);
  return days > maxDays ? null : days;
}

export function getPhaseEscapeCalibration() {
  return DEFAULT_PHASE_ESCAPE_MODELS;
}

export async function computePhaseEscapeCalibration(
  _startDate: string,
  _endDate: string,
  _options: Record<string, unknown> = {}
) {
  throw new Error('Phase escape calibration recomputation is not implemented yet; use the internal DB + DE442 calibration pipeline.');
}

export function assignMetastablePhaseWell(thetaResidual: number) {
  const primaryDistance = Math.abs(wrapPhase(thetaResidual - degreesToRadians(TWO_WELL_CALIBRATION.primaryDeg)));
  const secondaryDistance = Math.abs(wrapPhase(thetaResidual - degreesToRadians(TWO_WELL_CALIBRATION.secondaryDeg)));

  return primaryDistance <= secondaryDistance
    ? { id: 'primary', label: `Primary well near ${TWO_WELL_CALIBRATION.primaryDeg.toFixed(1)} deg`, distanceRad: primaryDistance }
    : { id: 'secondary', label: `Secondary well near ${TWO_WELL_CALIBRATION.secondaryDeg.toFixed(1)} deg`, distanceRad: secondaryDistance };
}
