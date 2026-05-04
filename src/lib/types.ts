export interface TimeSample {
  t: string;
  xp: number;
  yp: number;
  ut1_utc?: number;
  lod?: number;
  e1?: [number, number, number];
  e2?: [number, number, number];
  e3?: [number, number, number];
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

export interface PathSample {
  t: number;
  vector: [number, number, number];
}

export interface PathMap {
  e1: PathSample[];
  e2: PathSample[];
  e3: PathSample[];
  drift: PathSample[];
  geomagnetic: PathSample[];
}

export interface EphemerisBodySample {
  distance_au?: number;
  angular_velocity_deg_per_day?: number;
  radial_velocity_km_s?: number;
  ecliptic_longitude_deg?: number;
  torque_proxy?: number;
}

export interface EphemerisRecord {
  t: string;
  bodies: Record<string, EphemerisBodySample>;
}

export interface EphemerisDataset {
  source: {
    kernel: string;
    kernel_url: string;
    leapseconds: string;
    observer: string;
    frame: string;
    aberration_correction: string;
    start_date?: string;
    end_date?: string;
    cadence?: string;
    bodies: Array<{ key: string; label: string; target: string }>;
    metrics: string[];
  };
  records: EphemerisRecord[];
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
  lagKernel?: number[][];
  targetState?: number;
  qualifyingTurningPoints?: number;
  phaseEventCounts?: number[];
  sufficientSamples?: boolean;
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
  probability_level: 'LOW' | 'MODERATE' | 'HIGH' | 'UNKNOWN';
  probability_message: string;
  alert_level: 'LOW' | 'MODERATE' | 'HIGH' | 'UNKNOWN';
  alert_message: string;
  phase_bin: number;
  base_prob: number;
  p_30d?: number;
}
