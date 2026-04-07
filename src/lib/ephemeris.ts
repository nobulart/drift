export const EPHEMERIS_BODY_CONFIG = [
  { key: 'sun', label: 'Sun' },
  { key: 'moon', label: 'Moon' },
  { key: 'mercury', label: 'Mercury' },
  { key: 'venus', label: 'Venus' },
  { key: 'mars', label: 'Mars' },
  { key: 'jupiter', label: 'Jupiter' },
  { key: 'saturn', label: 'Saturn' },
  { key: 'uranus', label: 'Uranus' },
  { key: 'neptune', label: 'Neptune' },
  { key: 'pluto', label: 'Pluto' },
] as const;

export const EPHEMERIS_METRIC_CONFIG = [
  {
    key: 'distance_au',
    label: 'Distance (AU)',
    shortLabel: 'Distance',
  },
  {
    key: 'angular_velocity_deg_per_day',
    label: 'Angular Velocity (deg/day)',
    shortLabel: 'Angular Velocity',
  },
  {
    key: 'radial_velocity_km_s',
    label: 'Radial Velocity (km/s)',
    shortLabel: 'Radial Velocity',
  },
  {
    key: 'ecliptic_longitude_deg',
    label: 'Ecliptic Longitude (deg)',
    shortLabel: 'Longitude',
  },
  {
    key: 'torque_proxy',
    label: 'Torque Proxy (mass/r^3 * angular speed)',
    shortLabel: 'Torque Proxy',
  },
] as const;

export type EphemerisBodyKey = typeof EPHEMERIS_BODY_CONFIG[number]['key'];
export type EphemerisMetricKey = typeof EPHEMERIS_METRIC_CONFIG[number]['key'];

export function getEphemerisSignalLabel(signalKey: string): string {
  const [bodyKey, metricKey] = signalKey.split(':') as [EphemerisBodyKey, EphemerisMetricKey];
  const body = EPHEMERIS_BODY_CONFIG.find(entry => entry.key === bodyKey);
  const metric = EPHEMERIS_METRIC_CONFIG.find(entry => entry.key === metricKey);
  if (!body || !metric) {
    return signalKey;
  }

  return `${body.label} ${metric.shortLabel}`;
}
