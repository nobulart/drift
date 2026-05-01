import { create } from 'zustand';
import { TimeSample } from '@/lib/types';
import { computeDrift } from '@/lib/drift';
import { signed_angle, projectToPlane, dot } from '@/lib/math';
import { RollingStats } from '@/lib/rollingStats';
import { loadEOPData, loadGeomagGFZData, loadGRACEData, loadInertiaData, mergeDataSources } from '@/lib/dataLoader';
import { computeLagModel } from '@/lib/lagModel';
import { DEFAULT_PANEL_ORDER } from '@/lib/panels';

const DEFAULT_BASIS = {
  e1: [1, 0, 0] as [number, number, number],
  e2: [0, 1, 0] as [number, number, number],
  e3: [0, 0, 1] as [number, number, number],
};

function getBasis(sample: Pick<TimeSample, 'e1' | 'e2' | 'e3'>) {
  return {
    e1: sample.e1 ?? DEFAULT_BASIS.e1,
    e2: sample.e2 ?? DEFAULT_BASIS.e2,
    e3: sample.e3 ?? DEFAULT_BASIS.e3,
  };
}

function stabilizePlanarBasis(
  e1Series?: [number, number][],
  e2Series?: [number, number][]
): { e1: [number, number][]; e2: [number, number][] } {
  const stabilizedE1: [number, number][] = [];
  const stabilizedE2: [number, number][] = [];

  const count = Math.max(e1Series?.length ?? 0, e2Series?.length ?? 0);
  for (let index = 0; index < count; index++) {
    const rawE1 = e1Series?.[index];
    const rawE2 = e2Series?.[index];

    if (!rawE1 || rawE1.length !== 2 || !rawE2 || rawE2.length !== 2) {
      stabilizedE1.push(stabilizedE1[index - 1] ?? [1, 0]);
      stabilizedE2.push(stabilizedE2[index - 1] ?? [0, 1]);
      continue;
    }

    let nextE1: [number, number] = [rawE1[0], rawE1[1]];
    let nextE2: [number, number] = [rawE2[0], rawE2[1]];
    const prevE1 = stabilizedE1[index - 1];

    if (prevE1) {
      const continuity = prevE1[0] * nextE1[0] + prevE1[1] * nextE1[1];
      if (continuity < 0) {
        nextE1 = [-nextE1[0], -nextE1[1]];
        nextE2 = [-nextE2[0], -nextE2[1]];
      }
    }

    stabilizedE1.push(nextE1);
    stabilizedE2.push(nextE2);
  }

  return { e1: stabilizedE1, e2: stabilizedE2 };
}

function isPlausibleGeomagneticAxis(axis?: [number, number, number] | null): axis is [number, number, number] {
  if (!axis || axis.length !== 3) {
    return false;
  }

  const [x, y, z] = axis;
  const magnitude = Math.sqrt(x * x + y * y + z * z);
  if (!Number.isFinite(magnitude) || magnitude < 1e-6) {
    return false;
  }

  // The geomagnetic dipole should remain high-latitude, not orbit the equator.
  return Math.abs(z / magnitude) >= 0.5;
}

interface AppState {
  data: TimeSample[];
  frame: 'earth' | 'principal';
  windowSize: number;
  driftAxis: [number, number, number];
  driftAxisTimeSeries: [number, number, number][];
  theta3: number[];
  theta12: number[];
  currentTimeIndex: number;
  isPlaying: boolean;
  playbackSpeed: number;

  rollingStats: RollingStats | null;
  turnThreshold: number;
  alignment: number[] | null;
  collapsedPanels: Set<string>;
  hiddenPanels: Set<string>;
  panelOrder: string[];
  lastUpdated: string | null;

  setData: (data: TimeSample[]) => void;
  setFrame: (frame: 'earth' | 'principal') => void;
  setWindowSize: (size: number) => void;
  setCurrentTimeIndex: (idx: number | ((prev: number) => number)) => void;
  setIsPlaying: (playing: boolean) => void;
  setPlaybackSpeed: (speed: number) => void;
  computeDrift: () => void;
  setRollingStats: (stats: RollingStats | null) => void;
  setTurnThreshold: (threshold: number) => void;
  computeRollingStats: () => void;
  setCurrentAlignment: (alignment: number[] | null) => void;
  togglePanelVisibility: (panelId: string) => void;
  togglePanelCollapse: (panelId: string) => void;
  movePanel: (panelId: string, direction: 'up' | 'down') => void;
  resetPanelPreferences: () => void;
  refetchData: () => Promise<void>;
}

const PANEL_PREFERENCES_STORAGE_KEY = 'drift-panel-preferences-v1';
const DEFAULT_VISIBLE_PANELS = new Set<string>();
const KNOWN_PANEL_IDS = new Set<string>(DEFAULT_PANEL_ORDER);

interface StoredPanelPreferences {
  collapsedPanels?: unknown;
  hiddenPanels?: unknown;
  panelOrder?: unknown;
}

function normalizePanelSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) {
    return new Set();
  }

  return new Set(value.filter((panelId): panelId is string => (
    typeof panelId === 'string' && KNOWN_PANEL_IDS.has(panelId)
  )));
}

function normalizePanelOrder(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_PANEL_ORDER];
  }

  const orderedKnownPanels = value.filter((panelId): panelId is string => (
    typeof panelId === 'string' && KNOWN_PANEL_IDS.has(panelId)
  ));
  const uniqueOrderedPanels = Array.from(new Set(orderedKnownPanels));
  const missingPanels = DEFAULT_PANEL_ORDER.filter((panelId) => !uniqueOrderedPanels.includes(panelId));

  return [...uniqueOrderedPanels, ...missingPanels];
}

function readPanelPreferences(): Pick<AppState, 'collapsedPanels' | 'hiddenPanels' | 'panelOrder'> | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const storedValue = window.localStorage.getItem(PANEL_PREFERENCES_STORAGE_KEY);
    if (!storedValue) {
      return null;
    }

    const parsed = JSON.parse(storedValue) as StoredPanelPreferences;
    return {
      collapsedPanels: normalizePanelSet(parsed.collapsedPanels),
      hiddenPanels: normalizePanelSet(parsed.hiddenPanels),
      panelOrder: normalizePanelOrder(parsed.panelOrder),
    };
  } catch {
    return null;
  }
}

function writePanelPreferences({
  collapsedPanels,
  hiddenPanels,
  panelOrder,
}: Pick<AppState, 'collapsedPanels' | 'hiddenPanels' | 'panelOrder'>) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      PANEL_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        collapsedPanels: [...collapsedPanels],
        hiddenPanels: [...hiddenPanels],
        panelOrder,
      })
    );
  } catch {
    // Ignore storage failures so the dashboard remains usable in restricted browser contexts.
  }
}

const initialPanelPreferences = readPanelPreferences();

const useStore = create<AppState>((set, get) => ({
   data: [],
   frame: 'earth',
   windowSize: 1825,
   driftAxis: [0, 0, 1],
   driftAxisTimeSeries: [],
  theta3: [],
  theta12: [],
  currentTimeIndex: 0,
  isPlaying: false,
  playbackSpeed: 1,
  rollingStats: null,
  turnThreshold: 0.05,
  alignment: null,
  collapsedPanels: initialPanelPreferences?.collapsedPanels ?? new Set(),
  hiddenPanels: initialPanelPreferences?.hiddenPanels ?? new Set(DEFAULT_VISIBLE_PANELS),
  panelOrder: initialPanelPreferences?.panelOrder ?? [...DEFAULT_PANEL_ORDER],
  lastUpdated: null,
  setData: (data) => {
    const transformedData = data.map(item => {
      const pos: [number, number, number] = [item.xp, item.yp, 0];
      const { e1, e2, e3 } = getBasis(item);
      
      const xpPrincipal = dot(pos, e1);
      const ypPrincipal = dot(pos, e2);
      
      return {
        ...item,
        principalPos: [xpPrincipal, ypPrincipal, 0] as [number, number, number]
      };
    });
    set({ 
      data: transformedData,
      currentTimeIndex: transformedData.length - 1 
    });
  },

  setFrame: (frame) => set({ frame }),

   setWindowSize: (size) => {
     set({ windowSize: size });
     get().computeDrift();
     get().computeRollingStats();
   },

   setCurrentTimeIndex: (idx) => {
    if (typeof idx === 'function') {
      set({ currentTimeIndex: idx(get().currentTimeIndex) });
    } else {
      set({ currentTimeIndex: idx });
    }
  },

  setIsPlaying: (playing) => set({ isPlaying: playing }),

  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
  togglePanelVisibility: (panelId) => {
    const { hiddenPanels } = get();
    const newHidden = new Set(hiddenPanels);
    if (newHidden.has(panelId)) {
      newHidden.delete(panelId);
    } else {
      newHidden.add(panelId);
    }
    set({ hiddenPanels: newHidden });
    writePanelPreferences(get());
  },
  togglePanelCollapse: (panelId) => {
    const { collapsedPanels } = get();
    const newCollapsed = new Set(collapsedPanels);
    if (newCollapsed.has(panelId)) {
      newCollapsed.delete(panelId);
    } else {
      newCollapsed.add(panelId);
    }
    set({ collapsedPanels: newCollapsed });
    writePanelPreferences(get());
  },
  movePanel: (panelId, direction) => {
    const panelOrder = [...get().panelOrder];
    const currentIndex = panelOrder.indexOf(panelId);
    if (currentIndex === -1) return;

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= panelOrder.length) return;

    [panelOrder[currentIndex], panelOrder[targetIndex]] = [panelOrder[targetIndex], panelOrder[currentIndex]];
    set({ panelOrder });
    writePanelPreferences(get());
  },
  resetPanelPreferences: () => {
    const nextPreferences = {
      hiddenPanels: new Set(DEFAULT_VISIBLE_PANELS),
      collapsedPanels: new Set<string>(),
      panelOrder: [...DEFAULT_PANEL_ORDER],
    };
    set(nextPreferences);
    writePanelPreferences(nextPreferences);
  },
  setRollingStats: (stats) => set({ rollingStats: stats }),
  setTurnThreshold: (threshold) => set({ turnThreshold: threshold }),
  setCurrentAlignment: (alignment) => set({ alignment }),

  computeDrift: () => {
    const { data, windowSize, frame } = get();

    if (data.length < 2) {
      return;
    }

    const actualWindowSize = Math.min(windowSize, data.length);
    const startIdx = data.length - actualWindowSize;

    const xData: number[] = [];
    const yData: number[] = [];

    for (let i = startIdx; i < data.length; i++) {
      const sample = data[i];
      if (frame === 'earth') {
        xData.push(sample.xp);
        yData.push(sample.yp);
      } else {
        const pos: [number, number, number] = [sample.xp, sample.yp, 0];
        const principalPos = sample.principalPos || [sample.xp, sample.yp, 0];
        xData.push(principalPos[0]);
        yData.push(principalPos[1]);
      }
    }

    if (xData.length < 2) {
      return;
    }

    const drift = computeDrift(xData, yData);
    set({ driftAxis: drift });

    const theta3: number[] = [];
    const theta12: number[] = [];

    for (let i = 0; i < data.length; i++) {
      const sample = data[i];
      const { e1, e3 } = getBasis(sample);
      const angleToE3 = signed_angle(drift, e3);
      theta3.push(angleToE3);

      const dPerp = projectToPlane(drift, e3);
      const angleToE1 = signed_angle(dPerp, e1);
      theta12.push(angleToE1);
    }

    set({ theta3, theta12 });
  },

  computeRollingStats: async () => {
    const { windowSize, turnThreshold, data } = get();
    
    try {
      const response = await fetch(
        `/api/rolling-stats?windowSize=${windowSize}&turnThreshold=${turnThreshold}&pathResolution=medium`
      );
      const stats = await response.json();
      const stabilizedBasis = stabilizePlanarBasis(stats.e1, stats.e2);
      
      const lagModel = computeLagModel({ ...stats, e1: stabilizedBasis.e1, e2: stabilizedBasis.e2 }, 30, 180);
      const precomputedPaths = stats.paths
        ? {
            e1: stats.paths.e1 || [],
            e2: stats.paths.e2 || [],
            e3: stats.paths.e3 || [],
            drift: stats.paths.drift || [],
            geomagnetic: stats.paths.geomagnetic || [],
          }
        : null;
      
      const enrichedStats = { 
        ...stats, 
        e1: stabilizedBasis.e1, 
        e2: stabilizedBasis.e2, 
        lagModel,
        paths: precomputedPaths
      };
      
      const enrichedData = data.map((sample, index) => ({
        ...sample,
        e1:
          Array.isArray(stabilizedBasis.e1?.[index]) && stabilizedBasis.e1[index].length === 2
            ? [stabilizedBasis.e1[index][0], stabilizedBasis.e1[index][1], 0] as [number, number, number]
            : sample.e1,
        e2:
          Array.isArray(stabilizedBasis.e2?.[index]) && stabilizedBasis.e2[index].length === 2
            ? [stabilizedBasis.e2[index][0], stabilizedBasis.e2[index][1], 0] as [number, number, number]
            : sample.e2,
        e3: sample.e3 ?? DEFAULT_BASIS.e3,
        driftAxis: (stats.driftAxis?.[index] as [number, number, number] | undefined) ?? sample.driftAxis,
        geomagnetic_axis:
          (isPlausibleGeomagneticAxis(sample.geomagnetic_axis) && sample.geomagnetic_axis)
          || (isPlausibleGeomagneticAxis(stats.geomagnetic_axis?.[index] as [number, number, number] | undefined) ? stats.geomagnetic_axis[index] as [number, number, number] : undefined)
          || sample.geomagnetic_axis,
      }));

      set({ rollingStats: enrichedStats, data: enrichedData });
      
      if (stats && stats.t && stats.t.length > 0 && enrichedData && enrichedData.length > 0) {
        const numPoints = Math.min(stats.t.length, enrichedData.length);
        
        const theta3: number[] = [];
        const theta12: number[] = [];
        
    for (let i = 0; i < enrichedData.length; i++) {
      const sample = enrichedData[i];
      const { e1, e3 } = getBasis(sample);
      
      if (stats.driftAxis && i < stats.driftAxis.length) {
        const drift = stats.driftAxis[i] as [number, number, number];
        const angleToE3 = signed_angle(drift, e3);
        theta3.push(angleToE3);
        
        const dPerp = projectToPlane(drift, e3);
        const angleToE1 = signed_angle(dPerp, e1);
        theta12.push(angleToE1);
        
        if (i === numPoints - 1) {
          set({ driftAxis: drift });
        }
      } else {
        theta3.push(0);
        theta12.push(0);
      }
    }
        
        set({ theta3, theta12 });
        
        if (stats.driftAxis && stats.driftAxis.length > 0) {
          const driftAxisTimeSeries: [number, number, number][] = [];

    for (let i = 0; i < stats.driftAxis.length; i++) {
      const drift = stats.driftAxis[i] as [number, number, number];
      driftAxisTimeSeries.push(drift);
    }

    set({ driftAxisTimeSeries });
        }
        
        if (stats.alignment) {
          set({ alignment: stats.alignment as number[] });
        }
      }
    } catch (err) {
      console.error('Failed to compute rolling stats:', err);
    }
  },

  refetchData: async () => {
    try {
      const [eopData, geomagData, graceData, inertiaData] = await Promise.all([
        loadEOPData(),
        loadGeomagGFZData(),
        loadGRACEData(),
        loadInertiaData()
      ]);

      const mergedData = mergeDataSources(eopData, geomagData, graceData, inertiaData);
      
      const transformedData = mergedData.map(item => {
        const pos: [number, number, number] = [item.xp, item.yp, 0];
        const { e1, e2, e3 } = getBasis(item);
        
        const xpPrincipal = dot(pos, e1);
        const ypPrincipal = dot(pos, e2);
        
        return {
          ...item,
          principalPos: [xpPrincipal, ypPrincipal, 0] as [number, number, number]
        };
      });

      set({ 
        data: transformedData,
        currentTimeIndex: transformedData.length - 1,
        lastUpdated: new Date().toISOString()
      });

      get().computeDrift();
      get().computeRollingStats();
    } catch (err) {
      console.error('Failed to refetch data:', err);
    }
  }
}));

export { useStore };
