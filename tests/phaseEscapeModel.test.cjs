const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_PHASE_ESCAPE_MODELS,
  angularDiff,
  angularDistanceDegrees,
  classifyEnergyState,
  classifyPhaseDirection,
  classifyPhaseRegion,
  classifyAcceleration,
  clamp,
  computeAlignmentStatus,
  computePhaseAcceleration,
  compositePhase,
  computePhaseDrift,
  detectOscillatory,
  energyBarrierRatio,
  degreesToRadians,
  estimateTimeToAlignmentDays,
  escapeEnergyBarrier,
  escapeGradient,
  escapeProbability,
  instabilityIndicator,
  kramersLikeEscapeIndex,
  movingAverage,
  phaseKineticEnergy,
  phaseMisalignment,
  phasePotentialEnergy,
  phaseTotalEnergy,
  smoothExp,
  stabilityScore,
  wrapDegrees,
  wrapPhase,
} = require('/private/tmp/drift-phase-test/phaseEscapeModel.js');

const EPSILON = 1e-12;

test('wrapPhase keeps values inside [-pi, pi)', () => {
  assert.equal(wrapPhase(0), 0);
  assert.ok(Math.abs(wrapPhase(Math.PI) + Math.PI) < EPSILON);
  assert.ok(Math.abs(wrapPhase(-Math.PI) + Math.PI) < EPSILON);
  assert.ok(Math.abs(wrapPhase(3 * Math.PI) + Math.PI) < EPSILON);
  assert.ok(Math.abs(wrapPhase(-3 * Math.PI) + Math.PI) < EPSILON);
});

test('compositePhase returns known circular means', () => {
  assert.ok(Math.abs(compositePhase({ a: 0, b: 0 }, { a: 1, b: 1 })) < EPSILON);
  assert.ok(Math.abs(compositePhase({ a: Math.PI / 2, b: Math.PI / 2 }, { a: 1, b: 1 }) - Math.PI / 2) < EPSILON);
  assert.ok(Math.abs(compositePhase({ a: 0, b: Math.PI / 2 }, { a: 1, b: 1 }) - Math.PI / 4) < EPSILON);
});

test('escapeProbability matches harmonic logistic coefficients', () => {
  const coeffs = { beta0: -1, betaCos: 0.5, betaSin: 0.25 };
  const expected = 1 / (1 + Math.exp(-(-1 + 0.5 * Math.cos(Math.PI / 3) + 0.25 * Math.sin(Math.PI / 3))));
  assert.ok(Math.abs(escapeProbability(Math.PI / 3, coeffs) - expected) < EPSILON);
});

test('phaseMisalignment wraps theta residual minus composite phase', () => {
  const result = phaseMisalignment(170 * Math.PI / 180, -170 * Math.PI / 180);
  assert.ok(Math.abs(result - (-20 * Math.PI / 180)) < EPSILON);
});

test('Venus_Mars phi0 is near max probability and opposite phase is near min', () => {
  const model = DEFAULT_PHASE_ESCAPE_MODELS.Venus_Mars;
  const phi0 = degreesToRadians(model.phi0Deg);
  const maxProbability = escapeProbability(phi0, model);
  const minProbability = escapeProbability(phi0 + Math.PI, model);
  const ratio = maxProbability / minProbability;

  assert.ok(maxProbability > minProbability);
  assert.ok(Math.abs(ratio - model.maxMinEscapeProbabilityRatio) < 0.01);
});

test('wrapDegrees keeps phase misalignment in [-180, 180]', () => {
  for (const angle of [-1080, -181, -180, -179, 0, 179, 180, 181, 1080]) {
    const wrapped = wrapDegrees(angle);
    assert.ok(wrapped >= -180);
    assert.ok(wrapped < 180);
  }

  assert.equal(wrapDegrees(181), -179);
  assert.equal(wrapDegrees(-181), 179);
  assert.equal(angularDiff(-178, 175), 7);
  assert.equal(angularDiff(175, -178), -7);
  assert.equal(clamp(40, -30, 30), 30);
});

test('computePhaseDrift preserves circular continuity across the branch cut', () => {
  const day = 86400 * 1000;
  const phi = [170, 175, -178, -172, -166];
  const time = phi.map((_, index) => index * day);
  const drift = computePhaseDrift(phi, time);

  assert.ok(drift.every(value => Number.isFinite(value)));
  assert.ok(Math.max(...drift.map(Math.abs)) < 50);
});

test('classifyPhaseDirection flips when synthetic phase velocity flips', () => {
  assert.equal(classifyPhaseDirection(0, 30, 2), 'approaching');
  assert.equal(classifyPhaseDirection(0, 30, -2), 'receding');
  assert.equal(classifyPhaseDirection(0, -30, -2), 'approaching');
  assert.equal(classifyPhaseDirection(0, -30, 2), 'receding');
});

test('estimateTimeToAlignmentDays handles alignment and near-stationary rates', () => {
  assert.equal(angularDistanceDegrees(10, 10), 0);
  assert.equal(estimateTimeToAlignmentDays(10, 10, 1), 0);
  assert.equal(estimateTimeToAlignmentDays(10, 30, 0.001), null);
  assert.equal(estimateTimeToAlignmentDays(10, 30, 2), 10);
  assert.equal(estimateTimeToAlignmentDays(10, 30, -2), null);
});

test('detectOscillatory flags repeated phase reversals', () => {
  assert.equal(detectOscillatory([0, 1, 2, 3, 4, 5]), false);
  assert.equal(detectOscillatory([0, 1, 0, 1, 0, 1, 0]), true);
});

test('escapeGradient and region/status classifiers return expected labels', () => {
  assert.ok(Math.abs(escapeGradient(0, 0.25, 0.05) - 0.05) < EPSILON);
  assert.equal(classifyPhaseRegion(15), 'near escape peak');
  assert.equal(classifyPhaseRegion(45), 'shoulder region');
  assert.equal(classifyPhaseRegion(75), 'background phase');
  assert.equal(computeAlignmentStatus('approaching', 45), 'approaching preferred phase');
  assert.equal(computeAlignmentStatus('receding', 45), 'receding from preferred phase');
  assert.equal(computeAlignmentStatus('stationary', 45), 'phase-stationary');
  assert.equal(computeAlignmentStatus('receding', 15), 'near preferred phase');
});

test('computePhaseAcceleration is near zero for flat and linear phase', () => {
  const day = 86400 * 1000;
  const time = [0, 1, 2, 3, 4, 5].map(index => index * day);
  const flat = computePhaseAcceleration(movingAverage([20, 20, 20, 20, 20, 20], 7), time).filter(Number.isFinite);
  const linear = computePhaseAcceleration([0, 5, 10, 15, 20, 25], time).filter(Number.isFinite);

  assert.ok(flat.every(value => Math.abs(value) < EPSILON));
  assert.ok(linear.every(value => Math.abs(value) < 1e-9));
});

test('computePhaseAcceleration detects alternating curvature without extreme spikes', () => {
  const day = 86400 * 1000;
  const phi = [0, 10, 0, -10, 0, 10, 0, -10, 0];
  const time = phi.map((_, index) => index * day);
  const accel = computePhaseAcceleration(phi, time).filter(Number.isFinite);
  const signs = accel.filter(value => Math.abs(value) > 0.05).map(Math.sign);

  assert.ok(signs.some(sign => sign > 0));
  assert.ok(signs.some(sign => sign < 0));
  assert.ok(Math.max(...accel.map(Math.abs)) < 100);
});

test('classifyAcceleration and instabilityIndicator describe curvature state', () => {
  assert.equal(classifyAcceleration(2, 0.01), 'linear drift');
  assert.equal(classifyAcceleration(2, 0.2), 'accelerating');
  assert.equal(classifyAcceleration(2, -0.2), 'decelerating');
  assert.equal(instabilityIndicator(40, 0, 2, -0.2), 'curving toward preferred phase');
  assert.equal(instabilityIndicator(40, 0, -2, -0.2), 'accelerating toward preferred phase');
  assert.equal(instabilityIndicator(40, 0, 2, 0.2), 'curving away');
  assert.equal(instabilityIndicator(40, 0, 2, 0.01), 'neutral curvature');
  assert.ok(Math.abs(stabilityScore(2, 4) - 0.2) < EPSILON);
});

test('smoothExp preserves flat series and damps jumps with less lag than a wide moving average', () => {
  assert.deepEqual(smoothExp([5, 5, 5], 0.25), [5, 5, 5]);
  const smoothed = smoothExp([0, 100], 0.25);
  assert.equal(smoothed[0], 0);
  assert.equal(smoothed[1], 25);
});

test('curvature can turn toward preferred phase before direction flips', () => {
  assert.equal(instabilityIndicator(-40, 0, -2, 0.5), 'curving toward preferred phase');
});

test('phase escape energy terms match expected barrier behavior', () => {
  const alpha = 0.25;
  const phi0 = 13.5;

  assert.equal(phaseKineticEnergy(0), 0);
  assert.ok(Math.abs(phasePotentialEnergy(phi0, phi0, alpha)) < EPSILON);
  assert.ok(Math.abs(phasePotentialEnergy(phi0 + 180, phi0, alpha) - 2 * alpha) < EPSILON);
  assert.equal(escapeEnergyBarrier(alpha), 2 * alpha);

  const total = phaseTotalEnergy(phi0 + 180, phi0, 0, alpha);
  const barrier = escapeEnergyBarrier(alpha);
  assert.equal(energyBarrierRatio(total, barrier), 1);
});

test('energy state thresholds and Kramers-like index are ordered', () => {
  assert.equal(energyBarrierRatio(0.3, 0.6), 0.5);
  assert.equal(energyBarrierRatio(0.3, 0), null);
  assert.equal(classifyEnergyState(null), 'unknown');
  assert.equal(classifyEnergyState(0.24), 'deeply sub-barrier');
  assert.equal(classifyEnergyState(0.49), 'sub-barrier');
  assert.equal(classifyEnergyState(0.79), 'near-barrier');
  assert.equal(classifyEnergyState(0.99), 'barrier approach');
  assert.equal(classifyEnergyState(1), 'super-barrier');

  const low = kramersLikeEscapeIndex(0.1, 1, 0.2);
  const high = kramersLikeEscapeIndex(0.9, 1, 0.2);
  assert.ok(low !== null && high !== null);
  assert.ok(high > low);
});
