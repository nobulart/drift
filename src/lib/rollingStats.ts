import { LagResult, ConditionalLagResult } from './types';

export interface RollingStats {
  t: number[];
  x_detrended: number[];
  y_detrended: number[];
  e1: [number, number][];
  e2: [number, number][];
  centers: [number, number][];
  theta: number[];
  omega: number[];
  turningPoints: number[];
  state: number[];
  danceSegments: DanceSegment[];
  rRatio: number[];
  geomagnetic_axis?: number[][];
  driftAxis?: [number, number, number][];
  alignment?: number[];
  lagModel?: LagResult;
  conditionalLagModel?: ConditionalLagResult;
}

export interface DanceSegment {
  startIndex: number;
  endIndex: number;
  centerTime: number;
  x: number[];
  y: number[];
  area: number;
  rRatio: number;
}

export interface RollingStatsParams {
  windowSize: number;
  turnThreshold: number;
  centerWindow: number;
  centerStep: number;
  danceWindow: number;
}

export const DEFAULT_PARAMS: RollingStatsParams = {
  windowSize: 365,
  turnThreshold: 0.05,
  centerWindow: 60,
  centerStep: 5,
  danceWindow: 120,
};
