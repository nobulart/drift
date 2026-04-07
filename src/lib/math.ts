export type Vec3 = [number, number, number];

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function norm(v: Vec3): number {
  return Math.sqrt(dot(v, v));
}

export function normalize(v: Vec3): Vec3 {
  const n = norm(v);
  if (n === 0) return [0, 0, 0];
  return [v[0] / n, v[1] / n, v[2] / n];
}

export function signedAngle2D(a: [number, number], b: [number, number]): number {
  const cross = a[0] * b[1] - a[1] * b[0];
  const dot = a[0] * b[0] + a[1] * b[1];
  return Math.atan2(cross, dot);
}

export function unwrap(angle: number[]): number[] {
  const unwrapped = [...angle];
  const n = unwrapped.length;
  
  for (let i = 1; i < n; i++) {
    const diff = unwrapped[i] - unwrapped[i - 1];
    if (diff > Math.PI) {
      unwrapped[i] = unwrapped[i - 1] + (diff - 2 * Math.PI);
    } else if (diff < -Math.PI) {
      unwrapped[i] = unwrapped[i - 1] + (diff + 2 * Math.PI);
    }
  }
  return unwrapped;
}

export function signed_angle(a: Vec3, b: Vec3): number {
  const cross = a[0] * b[1] - a[1] * b[0];
  const dot_val = dot(a, b);
  return Math.atan2(cross, dot_val);
}

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function projectToPlane(v: Vec3, n: Vec3): Vec3 {
  const d = dot(v, n);
  return subtract(v, scale(n, d));
}
