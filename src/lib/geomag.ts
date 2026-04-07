type GeomagRecord = Record<string, any>;

const NUMERIC_KEYS = ['kp', 'ap', 'Ap', 'cp', 'c9'] as const;
const COUNT_KEYS = new Set(['kp_count', 'ap_count']);

export function normalizeGeomagRecords(records: GeomagRecord[]): GeomagRecord[] {
  const daily = new Map<string, GeomagRecord[]>();

  for (const record of records) {
    const key = String(record.t).split('T')[0];
    const bucket = daily.get(key) ?? [];
    bucket.push({ ...record, t: key });
    daily.set(key, bucket);
  }

  return [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([t, bucket]) => {
    const merged: GeomagRecord = { t };

    for (const key of NUMERIC_KEYS) {
      const values = bucket
        .map((record) => record[key])
        .filter((value) => value !== null && value !== undefined)
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value));

      if (values.length > 0) {
        merged[key] = values.reduce((sum, value) => sum + value, 0) / values.length;
        if (key === 'kp' || key === 'ap') {
          merged[`${key}_count`] = values.length;
        }
      }
    }

    for (const record of bucket) {
      for (const [key, value] of Object.entries(record)) {
        if (key === 't' || NUMERIC_KEYS.includes(key as any) || COUNT_KEYS.has(key) || value === undefined) {
          continue;
        }
        merged[key] = value;
      }
    }

    return merged;
  });
}
