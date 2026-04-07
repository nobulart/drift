// Data loader for DRIFT dashboard
import { deriveGeomagneticAxis, deriveGeomagneticStrength } from './geomagnetic';

export async function loadInertiaData(): Promise<any[]> {
  const response = await fetch('/api/inertia');
  const data = await response.json();
  return data;
}

export async function loadEOPData(): Promise<any[]> {
  const response = await fetch('/api/eop');
  const data = await response.json();
  return data;
}

export async function loadEOPLatestData(): Promise<any[]> {
  const response = await fetch('/api/eop');
  const data = await response.json();
  return data;
}

export async function loadGeomagData(): Promise<any[]> {
  const response = await fetch('/api/geomag');
  const data = await response.json();
  return data;
}

export async function loadGeomagGFZData(): Promise<any[]> {
  const response = await fetch('/api/geomag-gfz');
  const data = await response.json();
  return data;
}

export async function loadGRACEData(): Promise<any[]> {
  const response = await fetch('/api/grace');
  const data = await response.json();
  return data;
}

export async function loadCombinedData(): Promise<any[]> {
  const response = await fetch('/api/combined-full');
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
  
  const result = eopData.map((eop) => {
    const dateStr = eop.t.split('T')[0];
    const geomag = geomagMap.get(dateStr) || {};
    const grace = graceMap.get(dateStr) || {};
    const inertia = inertiaMap.get(dateStr) || {};
    
    return {
      t: eop.t,
      xp: eop.xp,
      yp: eop.yp,
      kp: geomag.kp !== undefined ? geomag.kp : null,
      ap: geomag.ap !== undefined ? geomag.ap : null,
      cp: geomag.cp !== undefined ? geomag.cp : null,
      c9: geomag.c9 !== undefined ? geomag.c9 : null,
      ap_daily: geomag.ap_daily,
      grace_lwe_mean: grace.lwe_mean,
      e1: inertia.e1 || [1, 0, 0],
      e2: inertia.e2 || [0, 1, 0],
      e3: inertia.e3 || [0, 0, 1],
      geomagnetic_axis: geomag.geomagnetic_axis || deriveGeomagneticAxis(geomag),
      geomagnetic_strength: deriveGeomagneticStrength(geomag),
    };
  });

  // Interpolate Kp across full timeline
  // Kp data starts at 2003, fill with 0 before that
  const kpValues = result.map(d => d.kp);
  
  // Find first valid Kp index
  let firstKpIndex = -1;
  for (let i = 0; i < kpValues.length; i++) {
    if (kpValues[i] !== null && kpValues[i] !== undefined) {
      firstKpIndex = i;
      break;
    }
  }
  
  // Fill all values before first Kp with 0
  if (firstKpIndex > 0) {
    for (let i = 0; i < firstKpIndex; i++) {
      result[i].kp = 0;
    }
  }
  
  // Linear interpolation between valid Kp points
  for (let i = firstKpIndex + 1; i < kpValues.length; i++) {
    if (kpValues[i] === null || kpValues[i] === undefined) {
      // Find previous valid
      let leftIdx = i - 1;
      while (leftIdx >= firstKpIndex && (kpValues[leftIdx] === null || kpValues[leftIdx] === undefined)) {
        leftIdx--;
      }
      
      // Find next valid
      let rightIdx = i + 1;
      while (rightIdx < kpValues.length && (kpValues[rightIdx] === null || kpValues[rightIdx] === undefined)) {
        rightIdx++;
      }
      
      if (leftIdx >= firstKpIndex && rightIdx < kpValues.length) {
        const kpLeft = kpValues[leftIdx];
        const kpRight = kpValues[rightIdx];
        const ratio = (i - leftIdx) / (rightIdx - leftIdx);
        result[i].kp = kpLeft + (kpRight - kpLeft) * ratio;
      } else if (leftIdx >= firstKpIndex) {
        result[i].kp = kpValues[leftIdx];
      } else {
        result[i].kp = 0;
      }
    }
  }
  
  // Ensure all Kp values are in valid range [0, 9]
  for (let i = 0; i < result.length; i++) {
    let kp = result[i].kp;
    if (kp !== null && kp !== undefined) {
      kp = Math.max(0, Math.min(9, Number(kp)));
      result[i].kp = kp;
    } else {
      result[i].kp = 0;
    }
  }

  return result;
}
