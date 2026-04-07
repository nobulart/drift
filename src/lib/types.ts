export interface TimeSample {
  t: string;
  xp: number;
  yp: number;
  e1: [number, number, number];
  e2: [number, number, number];
  e3: [number, number, number];
  lambda?: [number, number, number];
  kp?: number;
  dst?: number;
  aa?: number;
  ap?: number;
  cp?: number;
  c9?: number;
  grace_lwe_mean?: number;
  principalPos?: [number, number, number];
  geomagnetic_axis?: [number, number, number];
  geomagnetic_strength?: number;
  driftAxis?: [number, number, number];
}

export interface LagResult {
  lags: number[];
  signal: number[];
  baseline: number[];
  raw_signal: number[];
  raw_baseline: number[];
  drift_response: number[];
}

export interface ConditionalLagResult {
  lags: number[];
  phase_bins: number[];
  signal: number[][];
  baseline: number[][];
}

export interface LagKernel {
  lags: number[];
  phase_bins: number[];
  kernel: number[][];  // [lag][phase_bin]
  n_lags: number;
  n_phases: number;
}

export interface TransitionForecast {
  lags: number[];
  P_tau: number[];
  expected_time: number;
  peak_time: number;
  cumulative: number[];
  alert_level: 'LOW' | 'MODERATE' | 'HIGH' | 'UNKNOWN';
  alert_message: string;
  phase_bin: number;
  base_prob: number;
}
