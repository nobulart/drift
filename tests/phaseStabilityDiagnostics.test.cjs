const assert = require('node:assert/strict');
const test = require('node:test');

const {
  computePhaseStabilityDiagnostics,
} = require('/private/tmp/drift-phase-test/phaseStabilityDiagnostics.js');

const dayMs = 24 * 60 * 60 * 1000;

function iso(day) {
  return new Date(Date.UTC(2000, 0, 1) + day * dayMs).toISOString().slice(0, 10);
}

function wrap(theta) {
  return ((theta + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
}

function makeCorridorSamples(historyDays = 720, recentDays = 180, recentOffset = 0, spread = true) {
  const samples = [];
  for (let i = 0; i < historyDays + recentDays; i += 1) {
    const theta = wrap(-Math.PI + ((i % 72) / 72) * 2 * Math.PI);
    const baseline = 0.02 * Math.sin(theta);
    const smallSpread = spread ? (i % 5 - 2) * 0.0008 : 0;
    const isRecent = i >= historyDays;
    samples.push({
      date: iso(i),
      theta,
      omega: baseline + smallSpread + (isRecent ? recentOffset : 0),
    });
  }
  return samples;
}

test('constant omega inside historical corridor remains stable', () => {
  const result = computePhaseStabilityDiagnostics(makeCorridorSamples(720, 180, 0, false), { recentDays: 180 });
  const latest = result.summary.latest;

  assert.ok(Math.abs(latest.zOmega) < 1.5);
  assert.ok(latest.manifoldDeparture < 0.3);
  assert.equal(latest.state, 'stable');
});

test('synthetic off-manifold omega excursion is elevated', () => {
  const result = computePhaseStabilityDiagnostics(makeCorridorSamples(720, 180, 0.02), { recentDays: 180 });
  const latest = result.summary.latest;

  assert.ok(Math.abs(latest.zOmega) > 2.5);
  assert.ok(latest.manifoldDeparture > 0.7);
  assert.ok(['excursion', 'escape_candidate'].includes(latest.state));
});

test('sharp bend synthetic path elevates curvature normalization', () => {
  const samples = [];
  for (let i = 0; i < 420; i += 1) {
    const bend = i > 360 ? Math.pow((i - 360) / 30, 2) : 0;
    samples.push({
      date: iso(i),
      theta: wrap(-2 + i * 0.012),
      omega: 0.002 * i + bend,
    });
  }

  const result = computePhaseStabilityDiagnostics(samples, { recentDays: 90, binCount: 36 });
  const recent = result.samples.slice(-60).map(sample => sample.curvatureNorm).filter(Number.isFinite);
  assert.ok(Math.max(...recent) > 0.8);
});

test('return path with displaced inbound branch elevates hysteresis index', () => {
  const samples = makeCorridorSamples(720, 0, 0);
  for (let i = 0; i < 60; i += 1) {
    const theta = -1.5 + (i / 59) * 3;
    samples.push({ date: iso(720 + i), theta, omega: 0.02 * Math.sin(theta) });
  }
  for (let i = 0; i < 60; i += 1) {
    const theta = 1.5 - (i / 59) * 3;
    samples.push({ date: iso(780 + i), theta, omega: 0.02 * Math.sin(theta) + 0.02 });
  }

  const result = computePhaseStabilityDiagnostics(samples, { recentDays: 140 });
  assert.ok(result.summary.hysteresisIndex > 3);
});

test('repeated historical window returns high analogue similarity', () => {
  const pattern = Array.from({ length: 90 }, (_, i) => ({
    theta: wrap(-1.2 + i * 0.03),
    omega: Math.sin(i / 8) * 0.01,
  }));
  const history = pattern.map((sample, i) => ({ date: iso(i), ...sample }));
  const spacer = makeCorridorSamples(360, 0, 0).map((sample, i) => ({ ...sample, date: iso(100 + i) }));
  const recent = pattern.map((sample, i) => ({ date: iso(500 + i), ...sample }));

  const result = computePhaseStabilityDiagnostics([...history, ...spacer, ...recent], { recentDays: 120, binCount: 36 });
  assert.ok(result.summary.topAnalogues[0].similarity > 0.75);
});

test('novel synthetic path returns low analogue similarity', () => {
  const history = makeCorridorSamples(540, 0, 0);
  const recent = Array.from({ length: 120 }, (_, i) => ({
    date: iso(700 + i),
    theta: wrap(i % 2 === 0 ? -2.2 : 2.2),
    omega: i % 3 === 0 ? 0.08 : -0.08,
  }));

  const result = computePhaseStabilityDiagnostics([...history, ...recent], { recentDays: 140, binCount: 36 });
  assert.ok(result.summary.topAnalogues[0].similarity < 0.3);
});

test('missing and sparse bins do not crash and return conservative nulls', () => {
  const sparse = Array.from({ length: 8 }, (_, i) => ({
    date: iso(i),
    theta: -0.5 + i * 0.01,
    omega: 0.001 * i,
  }));

  const result = computePhaseStabilityDiagnostics(sparse, { recentDays: 4, binCount: 72 });
  assert.equal(result.samples.length, sparse.length);
  assert.equal(result.summary.latest.zOmega, null);
  assert.equal(result.summary.latest.state, 'insufficient_data');
});
