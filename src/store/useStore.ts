import { create } from 'zustand';
import { TimeSample } from '@/lib/types';
import { computeDrift } from '@/lib/drift';
import { signed_angle, projectToPlane, dot } from '@/lib/math';
import { RollingStats } from '@/lib/rollingStats';
import { loadEOPData, loadGeomagGFZData, loadGRACEData, loadInertiaData, mergeDataSources } from '@/lib/dataLoader';
import { computeLagModel } from '@/lib/lagModel';
import { DEFAULT_PANEL_ORDER } from '@/lib/panels';

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
  collapsedPanels: new Set(),
  hiddenPanels: new Set(),
  panelOrder: [...DEFAULT_PANEL_ORDER],
  lastUpdated: null,
  setData: (data) => {
    const transformedData = data.map(item => {
      const pos: [number, number, number] = [item.xp, item.yp, 0];
      const e1 = item.e1;
      const e2 = item.e2;
      const e3 = item.e3;
      
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
  },
  movePanel: (panelId, direction) => {
    const panelOrder = [...get().panelOrder];
    const currentIndex = panelOrder.indexOf(panelId);
    if (currentIndex === -1) return;

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= panelOrder.length) return;

    [panelOrder[currentIndex], panelOrder[targetIndex]] = [panelOrder[targetIndex], panelOrder[currentIndex]];
    set({ panelOrder });
  },
  resetPanelPreferences: () => set({
    hiddenPanels: new Set(),
    collapsedPanels: new Set(),
    panelOrder: [...DEFAULT_PANEL_ORDER],
  }),
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
      const e3 = sample.e3;
      const angleToE3 = signed_angle(drift, e3);
      theta3.push(angleToE3);

      const dPerp = projectToPlane(drift, e3);
      const e1 = sample.e1;
      const angleToE1 = signed_angle(dPerp, e1);
      theta12.push(angleToE1);
    }

    set({ theta3, theta12 });
  },

  computeRollingStats: async () => {
    const { windowSize, turnThreshold, data } = get();
    
    try {
      const response = await fetch(
        `/api/rolling-stats?windowSize=${windowSize}&turnThreshold=${turnThreshold}`
      );
      const stats = await response.json();
      
      const lagModel = computeLagModel(stats, 30, 180);
      const enrichedStats = { ...stats, lagModel };
      const enrichedData = data.map((sample, index) => ({
        ...sample,
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
      const e3 = sample.e3;
      
      if (stats.driftAxis && i < stats.driftAxis.length) {
        const drift = stats.driftAxis[i] as [number, number, number];
        const angleToE3 = signed_angle(drift, e3);
        theta3.push(angleToE3);
        
        const dPerp = projectToPlane(drift, e3);
        const e1 = sample.e1;
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
        const e1 = item.e1;
        const e2 = item.e2;
        const e3 = item.e3;
        
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
