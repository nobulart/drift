import { EPHEMERIS_BODY_CONFIG, EPHEMERIS_METRIC_CONFIG } from '@/lib/ephemeris';

export const DEFAULT_OVERLAY_SIGNALS = ['drift'];
export const DEFAULT_OVERLAY_PLOT_MODE = 'line';
export const OVERLAY_SIGNAL_STORAGE_KEY = 'drift-overlay-selected-signals-v1';
export const OVERLAY_PLOT_MODE_STORAGE_KEY = 'drift-overlay-plot-mode-v1';
export const OVERLAY_SIGNAL_RESET_EVENT = 'drift-overlay-reset-defaults';

const OVERLAY_PLOT_MODE_KEYS = new Set([
  DEFAULT_OVERLAY_PLOT_MODE,
  'Viridis',
  'Cividis',
  'Plasma',
  'Inferno',
  'Magma',
  'Turbo',
  'Spectral',
  'Jet',
  'Hot',
  'Electric',
  'Earth',
  'Rainbow',
]);

const CORE_SIGNAL_KEYS = new Set(['xp', 'yp', 'ut1_utc', 'lod', 'drift', 'theta', 'omega', 'R', 'kp', 'ap']);
const EPHEMERIS_SIGNAL_KEYS = new Set(
  EPHEMERIS_BODY_CONFIG.flatMap(body =>
    EPHEMERIS_METRIC_CONFIG.map(metric => `${body.key}:${metric.key}`)
  )
);

export function normalizeOverlaySignals(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_OVERLAY_SIGNALS];
  }

  const validSignals = value.filter((signal): signal is string => (
    typeof signal === 'string' && (CORE_SIGNAL_KEYS.has(signal) || EPHEMERIS_SIGNAL_KEYS.has(signal))
  ));
  const uniqueSignals = Array.from(new Set(validSignals));

  return uniqueSignals.length > 0 ? uniqueSignals : [...DEFAULT_OVERLAY_SIGNALS];
}

export function readOverlaySignals(): string[] {
  if (typeof window === 'undefined') {
    return [...DEFAULT_OVERLAY_SIGNALS];
  }

  try {
    const storedValue = window.localStorage.getItem(OVERLAY_SIGNAL_STORAGE_KEY);
    return storedValue ? normalizeOverlaySignals(JSON.parse(storedValue)) : [...DEFAULT_OVERLAY_SIGNALS];
  } catch {
    return [...DEFAULT_OVERLAY_SIGNALS];
  }
}

export function writeOverlaySignals(signals: string[]) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      OVERLAY_SIGNAL_STORAGE_KEY,
      JSON.stringify(normalizeOverlaySignals(signals))
    );
  } catch {
    // Ignore storage failures so the plot remains usable in restricted browser contexts.
  }
}

export function normalizeOverlayPlotMode(value: unknown): string {
  return typeof value === 'string' && OVERLAY_PLOT_MODE_KEYS.has(value)
    ? value
    : DEFAULT_OVERLAY_PLOT_MODE;
}

export function readOverlayPlotMode(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_OVERLAY_PLOT_MODE;
  }

  try {
    return normalizeOverlayPlotMode(window.localStorage.getItem(OVERLAY_PLOT_MODE_STORAGE_KEY));
  } catch {
    return DEFAULT_OVERLAY_PLOT_MODE;
  }
}

export function writeOverlayPlotMode(plotMode: string) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      OVERLAY_PLOT_MODE_STORAGE_KEY,
      normalizeOverlayPlotMode(plotMode)
    );
  } catch {
    // Ignore storage failures so the plot remains usable in restricted browser contexts.
  }
}

export function resetOverlaySignals() {
  writeOverlaySignals(DEFAULT_OVERLAY_SIGNALS);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(OVERLAY_SIGNAL_RESET_EVENT));
  }
}

export function resetOverlayPreferences() {
  writeOverlaySignals(DEFAULT_OVERLAY_SIGNALS);
  writeOverlayPlotMode(DEFAULT_OVERLAY_PLOT_MODE);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(OVERLAY_SIGNAL_RESET_EVENT));
  }
}
