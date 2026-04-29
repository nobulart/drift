import { Vec3, dot, normalize, unwrap } from './math';
import * as THREE from 'three';

export function toPrincipalFrame(v: Vec3, e1: Vec3, e2: Vec3, e3: Vec3): Vec3 {
  return [dot(v, e1), dot(v, e2), dot(v, e3)];
}

export function toEarthFrame(v: Vec3, e1: Vec3, e2: Vec3, e3: Vec3): Vec3 {
  const [v1, v2, v3] = v;
  return [
    e1[0] * v1 + e2[0] * v2 + e3[0] * v3,
    e1[1] * v1 + e2[1] * v2 + e3[1] * v3,
    e1[2] * v1 + e2[2] * v2 + e3[2] * v3,
  ];
}

export function toSpherical(v: Vec3): { lon: number; lat: number } {
  const [x, y, z] = v;
  const r = Math.sqrt(x * x + y * y + z * z);
  const lat = Math.asin(z / r) * (180 / Math.PI);
  const lon = Math.atan2(y, x) * (180 / Math.PI);
  return { lon, lat };
}

export function driftAxisLongitude(v: Vec3): number {
  return vectorLongitudeChart(v);
}

export function vectorLongitudeChart(v: Vec3): number {
  return 180 - (Math.atan2(v[1], v[0]) * 180 / Math.PI);
}

export function unwrapLon(lon: number[]): number[] {
  // Convert to radians
  const lonRad = lon.map(d => d * Math.PI / 180);
  
  // Unwrap using cumulative difference method
  const unwrappedRad = [...lonRad];
  for (let i = 1; i < unwrappedRad.length; i++) {
    const diff = unwrappedRad[i] - unwrappedRad[i - 1];
    if (diff > Math.PI) {
      unwrappedRad[i] = unwrappedRad[i - 1] + (diff - 2 * Math.PI);
    } else if (diff < -Math.PI) {
      unwrappedRad[i] = unwrappedRad[i - 1] + (diff + 2 * Math.PI);
    }
  }
  
  // Convert back to degrees
  return unwrappedRad.map(d => d * 180 / Math.PI);
}

export function fromSpherical(lon: number, lat: number, r: number = 1): Vec3 {
  const lonRad = (lon * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  return [
    r * Math.cos(latRad) * Math.cos(lonRad),
    r * Math.cos(latRad) * Math.sin(lonRad),
    r * Math.sin(latRad),
  ];
}

export function latLonToECEF(latDeg: number, lonDeg: number): Vec3 {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;

  return normalize([
    Math.cos(lat) * Math.cos(lon),
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat),
  ]);
}

export function computePhysicalBasis(dipoleLat: number, dipoleLon: number): {
  e1: Vec3;
  e2: Vec3;
  e3: Vec3;
} {
  const e3 = new THREE.Vector3(0, 0, 1);
  let e2 = new THREE.Vector3(...latLonToECEF(dipoleLat, dipoleLon));

  const projection = e3.clone().multiplyScalar(e2.dot(e3));
  e2.sub(projection);
  if (e2.lengthSq() < 1e-10) {
    e2 = new THREE.Vector3(1, 0, 0);
  } else {
    e2.normalize();
  }

  let e1 = new THREE.Vector3().crossVectors(e2, e3).normalize();
  e2 = new THREE.Vector3().crossVectors(e3, e1).normalize();

  const handedness = new THREE.Vector3().crossVectors(e1, e2).dot(e3);
  if (handedness < 0) {
    e1.negate();
  }

  return {
    e1: [e1.x, e1.y, e1.z],
    e2: [e2.x, e2.y, e2.z],
    e3: [e3.x, e3.y, e3.z],
  };
}

export function rotateX(v: Vec3, angle: number): Vec3 {
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [v[0], v[1] * cos - v[2] * sin, v[1] * sin + v[2] * cos];
}

export function rotateY(v: Vec3, angle: number): Vec3 {
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [v[0] * cos + v[2] * sin, v[1], -v[0] * sin + v[2] * cos];
}

export function rotateZ(v: Vec3, angle: number): Vec3 {
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [v[0] * cos - v[1] * sin, v[0] * sin + v[1] * cos, v[2]];
}
