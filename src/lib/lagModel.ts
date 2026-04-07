import { RollingStats } from './rollingStats';
import { LagResult } from './types';

export function computeLagModel(
  stats: RollingStats,
  H: number = 30,
  lagMax: number = 180
): LagResult {
  const { t, turningPoints, driftAxis } = stats;

  if (!driftAxis || turningPoints.length === 0) {
    return {
      lags: [],
      signal: [],
      baseline: [],
      raw_signal: [],
      raw_baseline: [],
      drift_response: []
    };
  }

  const n = driftAxis.length;

  // Convert drift axis to longitude (degrees)
  const lon = driftAxis.map(d => 
    (Math.atan2(d[1], d[0]) * 180 / Math.PI) + 90
  );

  // Drift response: forward difference over horizon H
  const driftResponse = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n - H; i++) {
    driftResponse[i] = Math.abs(lon[i + H] - lon[i]);
  }

  // Define lag window
  const lags = Array.from({ length: lagMax + 1 }, (_, i) => i);

  // Compute conditional response at each lag
  const lagScores = lags.map(lag => {
    const values: number[] = [];
    for (const idx of turningPoints) {
      const j = idx + lag;
      if (j < n && !isNaN(driftResponse[j])) {
        values.push(driftResponse[j]);
      }
    }
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
  });

  // Random baseline
  const randIndices = generateRandomIndices(n, turningPoints.length);

  const baselineScores = lags.map(lag => {
    const values: number[] = [];
    for (const idx of randIndices) {
      const j = idx + lag;
      if (j < n && !isNaN(driftResponse[j])) {
        values.push(driftResponse[j]);
      }
    }
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
  });

  // Normalize signals
  const normalize = (arr: number[]): number[] => {
    const valid = arr.filter(v => !isNaN(v));
    if (valid.length === 0) return arr;
    
    const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
    const variance = valid.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / valid.length;
    const std = Math.sqrt(variance);
    
    return arr.map(v => (v - mean) / (std || 1));
  };

  const signal = normalize(lagScores);
  const baseline = normalize(baselineScores);

  return {
    lags,
    signal,
    baseline,
    raw_signal: lagScores,
    raw_baseline: baselineScores,
    drift_response: driftResponse
  };
}

function generateRandomIndices(totalLength: number, count: number): number[] {
  const indices = Array.from({ length: totalLength }, (_, i) => i);
  
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  
  return indices.slice(0, count);
}
