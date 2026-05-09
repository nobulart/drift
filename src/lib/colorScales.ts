export const DEFAULT_PATH_COLOR_SCALE = 'Viridis';
export const PATH_COLOR_SCALE_RESET_EVENT = 'drift-path-color-scales-reset';

export const HEATMAP_PALETTES = [
  { value: 'Viridis', label: 'Viridis' },
  { value: 'Cividis', label: 'Cividis' },
  { value: 'Plasma', label: 'Plasma' },
  { value: 'Inferno', label: 'Inferno' },
  { value: 'Magma', label: 'Magma' },
  { value: 'Turbo', label: 'Turbo' },
  { value: 'Spectral', label: 'Spectral' },
  { value: 'Jet', label: 'Jet' },
  { value: 'Hot', label: 'Hot' },
  { value: 'Electric', label: 'Electric' },
  { value: 'Earth', label: 'Earth' },
  { value: 'Rainbow', label: 'Rainbow' },
  { value: 'Greyscale', label: 'Greyscale' },
];

export const HEATMAP_COLOR_SCALES: Record<string, Array<[number, string]>> = {
  Viridis: [
    [0, '#440154'],
    [0.13, '#482878'],
    [0.25, '#3e4989'],
    [0.38, '#31688e'],
    [0.5, '#26828e'],
    [0.63, '#1f9e89'],
    [0.75, '#35b779'],
    [0.88, '#6ece58'],
    [1, '#fde725'],
  ],
  Cividis: [
    [0, '#00204c'],
    [0.13, '#173b6d'],
    [0.25, '#4a5772'],
    [0.38, '#6d6f74'],
    [0.5, '#8a8878'],
    [0.63, '#a8a178'],
    [0.75, '#c8bd73'],
    [0.88, '#e5d96d'],
    [1, '#fff838'],
  ],
  Plasma: [
    [0, '#0d0887'],
    [0.13, '#46039f'],
    [0.25, '#7201a8'],
    [0.38, '#9c179e'],
    [0.5, '#bd3786'],
    [0.63, '#d8576b'],
    [0.75, '#ed7953'],
    [0.88, '#fb9f3a'],
    [1, '#f0f921'],
  ],
  Inferno: [
    [0, '#000004'],
    [0.13, '#1b0c41'],
    [0.25, '#4a0c6b'],
    [0.38, '#781c6d'],
    [0.5, '#a52c60'],
    [0.63, '#cf4446'],
    [0.75, '#ed6925'],
    [0.88, '#fb9b06'],
    [1, '#fcffa4'],
  ],
  Magma: [
    [0, '#000004'],
    [0.13, '#180f3d'],
    [0.25, '#440f76'],
    [0.38, '#721f81'],
    [0.5, '#9e2f7f'],
    [0.63, '#cd4071'],
    [0.75, '#f1605d'],
    [0.88, '#fd9668'],
    [1, '#fcfdbf'],
  ],
  Turbo: [
    [0, '#30123b'],
    [0.13, '#4145ab'],
    [0.25, '#4675ed'],
    [0.38, '#39a2fc'],
    [0.5, '#1bcfd4'],
    [0.63, '#24eca6'],
    [0.75, '#a4fc3c'],
    [0.88, '#f5c83b'],
    [1, '#7a0403'],
  ],
  Spectral: [
    [0, '#9e0142'],
    [0.13, '#d53e4f'],
    [0.25, '#f46d43'],
    [0.38, '#fdae61'],
    [0.5, '#ffffbf'],
    [0.63, '#abdda4'],
    [0.75, '#66c2a5'],
    [0.88, '#3288bd'],
    [1, '#5e4fa2'],
  ],
  Jet: [
    [0, '#000083'],
    [0.35, '#003cff'],
    [0.5, '#00ff66'],
    [0.65, '#ffff00'],
    [1, '#800000'],
  ],
  Hot: [
    [0, '#000000'],
    [0.35, '#b00000'],
    [0.7, '#ffff00'],
    [1, '#ffffff'],
  ],
  Electric: [
    [0, '#000000'],
    [0.15, '#1e0063'],
    [0.35, '#5500ff'],
    [0.55, '#00c2ff'],
    [0.75, '#00ff85'],
    [1, '#ffffff'],
  ],
  Earth: [
    [0, '#102f4a'],
    [0.18, '#236477'],
    [0.35, '#4f8f66'],
    [0.52, '#8f9b54'],
    [0.7, '#c19a5b'],
    [0.86, '#d8c49a'],
    [1, '#f6f0d8'],
  ],
  Rainbow: [
    [0, '#6e40aa'],
    [0.17, '#be3caf'],
    [0.33, '#fe4b83'],
    [0.5, '#ff7847'],
    [0.67, '#e2b72f'],
    [0.83, '#8bd646'],
    [1, '#1ac7c2'],
  ],
  Greyscale: [
    [0, '#050505'],
    [0.18, '#242424'],
    [0.36, '#555555'],
    [0.54, '#8a8a8a'],
    [0.72, '#bdbdbd'],
    [0.9, '#e5e5e5'],
    [1, '#ffffff'],
  ],
};

const PATH_COLOR_SCALE_STORAGE_KEY = 'drift-path-color-scales-v1';

export function normalizeColorScale(value: string | null | undefined) {
  return value && HEATMAP_COLOR_SCALES[value] ? value : DEFAULT_PATH_COLOR_SCALE;
}

export function readPathColorScale(panelId: string) {
  if (typeof window === 'undefined') {
    return DEFAULT_PATH_COLOR_SCALE;
  }

  try {
    const raw = window.localStorage.getItem(PATH_COLOR_SCALE_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_PATH_COLOR_SCALE;
    }
    const values = JSON.parse(raw) as Record<string, string>;
    return normalizeColorScale(values[panelId]);
  } catch {
    return DEFAULT_PATH_COLOR_SCALE;
  }
}

export function writePathColorScale(panelId: string, colorScale: string) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const raw = window.localStorage.getItem(PATH_COLOR_SCALE_STORAGE_KEY);
    const values = raw ? JSON.parse(raw) as Record<string, string> : {};
    values[panelId] = normalizeColorScale(colorScale);
    window.localStorage.setItem(PATH_COLOR_SCALE_STORAGE_KEY, JSON.stringify(values));
  } catch {
    // Ignore storage errors; the active in-memory selection still works.
  }
}

export function resetPathColorScales() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(PATH_COLOR_SCALE_STORAGE_KEY);
  } catch {
    // Ignore storage errors; reset listeners still restore in-memory defaults.
  }

  window.dispatchEvent(new Event(PATH_COLOR_SCALE_RESET_EVENT));
}
