// Data loader for DRIFT dashboard
import { deriveGeomagneticStrength } from './geomagnetic';

export async function loadInertiaData(): Promise<any[]> {
  const response = await fetch('/api/inertia', { cache: 'no-store' });
  const data = await response.json();
  return data;
}

export async function loadEOPData(): Promise<any[]> {
  const response = await fetch('/api/eop', { cache: 'no-store' });
  const data = await response.json();
  return data;
}

export async function loadEOPLatestData(): Promise<any[]> {
  const response = await fetch('/api/eop', { cache: 'no-store' });
  const data = await response.json();
  return data;
}

export async function loadGeomagData(): Promise<any[]> {
  const response = await fetch('/api/geomag', { cache: 'no-store' });
  const data = await response.json();
  return data;
}

export async function loadGeomagGFZData(): Promise<any[]> {
  const response = await fetch('/api/geomag-gfz', { cache: 'no-store' });
  const data = await response.json();
  return data;
}

export async function loadGRACEData(): Promise<any[]> {
  const response = await fetch('/api/grace', { cache: 'no-store' });
  const data = await response.json();
  return data;
}

export async function loadCombinedData(): Promise<any[]> {
  const response = await fetch('/api/combined-full', { cache: 'no-store' });
  const data = await response.json();
  return data;
}

export async function loadEphemerisData(): Promise<any> {
  const response = await fetch('/api/ephemeris', { cache: 'no-store' });
  const data = await response.json();
  return data;
}


// Helper to merge data sources by date
export function mergeDataSources(
  eopData: any[],
  geomagData: any[],
  graceData: any[] = [],
  inertiaData: any[] = []
): any[] {
  const geomagMap = new Map(geomagData.map((g) => [g.t.split('T')[0], g]));
  const graceMap = new Map(graceData.map((g) => [g.t.split('T')[0], g]));
  const inertiaMap = new Map(inertiaData.map((i) => [i.t.split('T')[0], i]));
  
  return eopData.map((eop) => {
    const dateStr = eop.t.split('T')[0];
    const geomag = geomagMap.get(dateStr) || {};
    const grace = graceMap.get(dateStr) || {};
    const inertia = inertiaMap.get(dateStr) || {};

    const hasGeomagAxis = Array.isArray(geomag.geomagnetic_axis) && geomag.geomagnetic_axis.length === 3;
    const hasGeomagStrengthInput = ['kp', 'ap', 'cp', 'c9'].some((key) => geomag[key] !== null && geomag[key] !== undefined);
    const hasGrace = Number.isFinite(Number(grace.lwe_mean));
    const hasInertia =
      Array.isArray(inertia.e1) && inertia.e1.length === 3 &&
      Array.isArray(inertia.e2) && inertia.e2.length === 3 &&
      Array.isArray(inertia.e3) && inertia.e3.length === 3;

    return {
      t: eop.t,
      xp: eop.xp,
      yp: eop.yp,
      ...(eop.ut1_utc !== undefined ? { ut1_utc: eop.ut1_utc } : {}),
      ...(eop.lod !== undefined ? { lod: eop.lod } : {}),
      ...(geomag.kp !== undefined ? { kp: geomag.kp } : {}),
      ...(geomag.ap !== undefined ? { ap: geomag.ap } : {}),
      ...(geomag.cp !== undefined ? { cp: geomag.cp } : {}),
      ...(geomag.c9 !== undefined ? { c9: geomag.c9 } : {}),
      ...(geomag.ap_daily !== undefined ? { ap_daily: geomag.ap_daily } : {}),
      ...(hasGrace ? { grace_lwe_mean: Number(grace.lwe_mean) } : {}),
      ...(hasInertia
        ? {
            e1: inertia.e1 as [number, number, number],
            e2: inertia.e2 as [number, number, number],
            e3: inertia.e3 as [number, number, number],
            ...(Array.isArray(inertia.lambda) && inertia.lambda.length === 3 ? { lambda: inertia.lambda } : {}),
          }
        : {}),
      ...(hasGeomagAxis ? { geomagnetic_axis: geomag.geomagnetic_axis as [number, number, number] } : {}),
      ...(hasGeomagStrengthInput ? { geomagnetic_strength: deriveGeomagneticStrength(geomag) } : {}),
    };
  });
}
