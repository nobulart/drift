import { LagKernel, TransitionForecast } from './types';

/**
 * Determine which phase bin a phase angle falls into.
 */
export function getPhaseBin(theta: number, phase_bins: number[]): number {
  const bins = phase_bins;
  let idx = bins.findIndex(bin => theta < bin) - 1;
  idx = Math.max(0, Math.min(idx, bins.length - 2));
  return idx;
}

/**
 * Compute transition probability curve from lag kernel.
 * 
 * @param theta_now Current phase angle (radians, -π to +π)
 * @param state_now Current dynamical state (0=Stable, 1=Pre, 2=Transition, 3=Post)
 * @param lagKernel Normalized lag kernel
 * @param baseProb Base transition probability P0 (0-1)
 * @returns Transition forecast with probability curve and metrics
 */
export function predictTransitionCurve(
  theta_now: number,
  state_now: number,
  lagKernel: LagKernel,
  baseProb: number = 0.5
): TransitionForecast {
  const lags = lagKernel.lags;
  const kernel = lagKernel.kernel;
  const phase_bins = lagKernel.phase_bins;
  
  if (lags.length === 0 || kernel.length === 0) {
    return {
      lags: [],
      P_tau: [],
      expected_time: NaN,
      peak_time: NaN,
      cumulative: [],
      alert_level: 'UNKNOWN',
      alert_message: 'No lag kernel data available',
      phase_bin: 0,
      base_prob: baseProb
    };
  }
  
  const n_phases = Math.max(lagKernel.n_phases, phase_bins.length - 1);
  const phase_idx = phase_bins.length > 1
    ? getPhaseBin(theta_now, phase_bins)
    : Math.min(state_now, n_phases - 1);
  
  // Get lag distribution for this phase
  const L: number[] = [];
  for (let i = 0; i < lags.length; i++) {
    L.push(kernel[i][phase_idx]);
  }
  
  // Combine with base probability
  const P_tau: number[] = L.map(p => baseProb * p);
  
  // Normalize to proper probability distribution
  const total = P_tau.reduce((sum, p) => sum + p, 0);
  if (total > 0) {
    for (let i = 0; i < P_tau.length; i++) {
      P_tau[i] /= total;
    }
  } else {
    // Uniform distribution if all zeros
    const uniform = 1.0 / lags.length;
    for (let i = 0; i < P_tau.length; i++) {
      P_tau[i] = uniform;
    }
  }
  
  // Compute cumulative probability
  const cumulative: number[] = [];
  let cumSum = 0;
  for (const p of P_tau) {
    cumSum += p;
    cumulative.push(cumSum);
  }
  
  // Compute metrics
  let expected_time = 0;
  let peak_idx = 0;
  let peak_prob = 0;
  
  for (let i = 0; i < lags.length; i++) {
    expected_time += P_tau[i] * lags[i];
    if (P_tau[i] > peak_prob) {
      peak_prob = P_tau[i];
      peak_idx = i;
    }
  }
  
  const peak_time = lags[peak_idx];
  
  // Determine alert level based on cumulative probability at 30 days
  let closest_idx = 0;
  let min_diff = Math.abs(lags[0] - 30);
  for (let i = 1; i < lags.length; i++) {
    const diff = Math.abs(lags[i] - 30);
    if (diff < min_diff) {
      min_diff = diff;
      closest_idx = i;
    }
  }
  
  const P_30d = cumulative[closest_idx];
  
  let alert_level: 'LOW' | 'MODERATE' | 'HIGH' | 'UNKNOWN';
  let alert_message: string;
  
  if (P_30d > 0.6) {
    alert_level = 'HIGH';
    alert_message = `HIGH PROBABILITY SHIFT (30d): P=${P_30d.toFixed(2)}`;
  } else if (P_30d > 0.3) {
    alert_level = 'MODERATE';
    alert_message = `MODERATE RISK (30d): P=${P_30d.toFixed(2)}`;
  } else {
    alert_level = 'LOW';
    alert_message = `LOW RISK (30d): P=${P_30d.toFixed(2)}`;
  }
  
  return {
    lags,
    P_tau,
    expected_time,
    peak_time,
    cumulative,
    alert_level,
    alert_message,
    phase_bin: phase_idx,
    base_prob: baseProb
  };
}

/**
 * Complete transition forecast pipeline.
 * 
 * This is the main function to call from external code.
 */
export function computeTransitionForecast(
  theta_now: number,
  state_now: number,
  lagKernel: LagKernel,
  baseProb: number = 0.5
): TransitionForecast {
  return predictTransitionCurve(theta_now, state_now, lagKernel, baseProb);
}

/**
 * Interpolate lag kernel values for smooth phase transitions.
 */
export function getPhaseInterpolatedKernel(
  theta: number,
  lagKernel: LagKernel
): number[] {
  const lags = lagKernel.lags;
  const kernel = lagKernel.kernel;
  const phase_bins = lagKernel.phase_bins;
  
  if (lags.length === 0 || kernel.length === 0) {
    return [];
  }
  
  const n_lags = lags.length;
  const n_phases = Math.max(lagKernel.n_phases, phase_bins.length - 1);
  
  // Find surrounding phase bins
  let phase_idx = Math.min(
    Math.max(Math.floor((theta + Math.PI) / (2 * Math.PI) * n_phases), 0),
    n_phases - 2
  );
  
  const weights: number[] = [];
  for (let i = 0; i < n_lags; i++) {
    const val = kernel[i][phase_idx];
    weights.push(val);
  }
  
  return weights;
}

/**
 * Get alert color based on alert level.
 */
export function getAlertColor(level: string): string {
  switch (level) {
    case 'HIGH':
      return '#ef4444';  // red-500
    case 'MODERATE':
      return '#f59e0b';  // amber-500
    case 'LOW':
      return '#10b981';  // emerald-500
    default:
      return '#6b7280';  // gray-500
  }
}

/**
 * Get alert background color based on alert level.
 */
export function getAlertBgColor(level: string): string {
  switch (level) {
    case 'HIGH':
      return 'bg-red-500/10 border-red-500/30';
    case 'MODERATE':
      return 'bg-amber-500/10 border-amber-500/30';
    case 'LOW':
      return 'bg-emerald-500/10 border-emerald-500/30';
    default:
      return 'bg-gray-500/10 border-gray-500/30';
  }
}
