const assert = require('node:assert/strict');
const test = require('node:test');

const {
  classifyQDriftProxy,
  computeQDriftProxy,
  formatQDriftProxy,
} = require('/private/tmp/drift-phase-test/matsuyamaProxy.js');

test('classifyQDriftProxy handles deeply sub-barrier values', () => {
  assert.equal(classifyQDriftProxy(0.1), 'deeply sub-barrier');
});

test('classifyQDriftProxy handles sub-barrier values', () => {
  assert.equal(classifyQDriftProxy(0.25), 'sub-barrier');
  assert.equal(classifyQDriftProxy(0.49), 'sub-barrier');
});

test('classifyQDriftProxy handles elevated values', () => {
  assert.equal(classifyQDriftProxy(0.5), 'elevated');
  assert.equal(classifyQDriftProxy(0.79), 'elevated');
});

test('classifyQDriftProxy handles near-threshold values', () => {
  assert.equal(classifyQDriftProxy(0.8), 'near-threshold');
  assert.equal(classifyQDriftProxy(0.99), 'near-threshold');
});

test('classifyQDriftProxy handles super-barrier proxy values', () => {
  assert.equal(classifyQDriftProxy(1), 'super-barrier proxy');
  assert.equal(classifyQDriftProxy(1.4), 'super-barrier proxy');
});

test('computeQDriftProxy prefers finite barrierRatio', () => {
  const result = computeQDriftProxy({
    totalPhaseEnergy: 0.1,
    barrier: 1,
    barrierRatio: 0.72,
  });

  assert.equal(result.qDriftProxy, 0.72);
  assert.equal(result.regime, 'elevated');
});

test('computeQDriftProxy computes energy over valid barrier', () => {
  const result = computeQDriftProxy({
    totalPhaseEnergy: 0.45,
    barrier: 0.5,
  });

  assert.equal(result.qDriftProxy, 0.9);
  assert.equal(result.regime, 'near-threshold');
});

test('computeQDriftProxy defensively handles missing and invalid barrier inputs', () => {
  assert.equal(computeQDriftProxy({ totalPhaseEnergy: null, barrier: 1 }).qDriftProxy, null);
  assert.equal(computeQDriftProxy({ totalPhaseEnergy: 1, barrier: null }).qDriftProxy, null);
  assert.equal(computeQDriftProxy({ totalPhaseEnergy: 1, barrier: 0 }).qDriftProxy, null);
  assert.equal(computeQDriftProxy({ totalPhaseEnergy: 1, barrier: -1 }).qDriftProxy, null);
  assert.equal(computeQDriftProxy({ totalPhaseEnergy: 1, barrier: NaN }).qDriftProxy, null);
  assert.equal(computeQDriftProxy({ totalPhaseEnergy: NaN, barrier: 1 }).qDriftProxy, null);
});

test('formatQDriftProxy formats finite values and hides nullish values', () => {
  assert.equal(formatQDriftProxy(0.12345), '0.123');
  assert.equal(formatQDriftProxy(null), 'n/a');
  assert.equal(formatQDriftProxy(NaN), 'n/a');
});
