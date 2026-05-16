export interface MatsuyamaProxyInput {
  totalPhaseEnergy?: number | null;
  barrier?: number | null;
  barrierRatio?: number | null;
}

export interface MatsuyamaProxyResult {
  qDriftProxy: number | null;
  regime: string;
  description: string;
}

export const MATSUYAMA_PROXY_DESCRIPTION =
  'This is not Matsuyama’s physical normalized load Q. It is a DRIFT phase-energy / basin-barrier proxy intended to compare present rotational phase excitation with a threshold-style reorientation framework.';

export function computeQDriftProxy(input: MatsuyamaProxyInput): MatsuyamaProxyResult {
  const qDriftProxy = resolveQDriftProxy(input);

  return {
    qDriftProxy,
    regime: classifyQDriftProxy(qDriftProxy),
    description: MATSUYAMA_PROXY_DESCRIPTION,
  };
}

export function classifyQDriftProxy(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return 'unknown';
  }
  if (value < 0.25) {
    return 'deeply sub-barrier';
  }
  if (value < 0.50) {
    return 'sub-barrier';
  }
  if (value < 0.80) {
    return 'elevated';
  }
  if (value < 1.00) {
    return 'near-threshold';
  }
  return 'super-barrier proxy';
}

export function formatQDriftProxy(q: number | null): string {
  if (q === null || !Number.isFinite(q)) {
    return 'n/a';
  }

  return q.toFixed(3);
}

function resolveQDriftProxy(input: MatsuyamaProxyInput): number | null {
  if (typeof input.barrierRatio === 'number' && Number.isFinite(input.barrierRatio)) {
    return input.barrierRatio;
  }

  const totalPhaseEnergy = input.totalPhaseEnergy;
  const barrier = input.barrier;

  if (
    typeof totalPhaseEnergy !== 'number' ||
    typeof barrier !== 'number' ||
    !Number.isFinite(totalPhaseEnergy) ||
    !Number.isFinite(barrier) ||
    barrier <= 0
  ) {
    return null;
  }

  return totalPhaseEnergy / barrier;
}
