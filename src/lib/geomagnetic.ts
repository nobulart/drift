import { fromSpherical } from './transforms';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function deriveGeomagneticAxis(sample: {
  kp?: number | null;
  ap?: number | null;
  cp?: number | null;
  c9?: number | null;
}): [number, number, number] {
  const kp = Number(sample.kp ?? 0);
  const ap = Number(sample.ap ?? 0);
  const cp = Number(sample.cp ?? 0);
  const c9 = Number(sample.c9 ?? 0);

  const longitude = ((kp / 9) * 360 + (c9 / 9) * 90) % 360;
  const latitude = clamp(78 - cp * 6 - ap / 20, 55, 85);
  return fromSpherical(longitude, latitude);
}

export function deriveGeomagneticStrength(sample: {
  kp?: number | null;
  ap?: number | null;
  cp?: number | null;
  c9?: number | null;
}): number {
  const kp = Number(sample.kp ?? 0);
  const ap = Number(sample.ap ?? 0);
  const cp = Number(sample.cp ?? 0);
  const c9 = Number(sample.c9 ?? 0);

  return clamp(1 - (kp / 18 + ap / 120 + cp / 8 + c9 / 18), 0.2, 1);
}
