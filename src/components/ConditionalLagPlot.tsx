'use client';

import { useEffect, useState, useMemo } from 'react';
import Plot from 'react-plotly.js';
import { ConditionalLagResult } from '@/lib/types';
import { usePlotDisplayHeight } from '@/components/usePlotDisplayHeight';
import { createCsvExportConfig } from '@/lib/plotlyCsvExport';
import { useStore } from '@/store/useStore';

type StateOption = 'Stable' | 'Pre' | 'Transition' | 'Post';
const STATE_TO_INDEX: Record<StateOption, number> = {
  Stable: 0,
  Pre: 1,
  Transition: 2,
  Post: 3,
};

export default function ConditionalLagPlot() {
  const [conditionalLagResult, setConditionalLagResult] = useState<ConditionalLagResult | null>(null);
  const [showBaseline, setShowBaseline] = useState(false);
  const [targetState, setTargetState] = useState<StateOption>('Transition');
  const [selectedPhase, setSelectedPhase] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heatmapHeight = usePlotDisplayHeight(400, 620);
  const sliceHeight = usePlotDisplayHeight(300, 420);
  const windowSize = useStore((state) => state.windowSize);
  const turnThreshold = useStore((state) => state.turnThreshold);
  const eopDataset = useStore((state) => state.eopDataset);

  useEffect(() => {
    const loadConditionalLag = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          conditionalTargetState: String(STATE_TO_INDEX[targetState]),
          windowSize: String(windowSize),
          turnThreshold: String(turnThreshold),
          dataset: eopDataset,
        });
        const response = await fetch(`/api/rolling-stats?${params.toString()}`);
        if (!response.ok) {
          throw new Error(`Failed to load conditional lag data for ${targetState}`);
        }
        const stats = await response.json();
        setConditionalLagResult(stats.conditionalLagModel || null);
      } catch (err) {
        setConditionalLagResult(null);
        setError(err instanceof Error ? err.message : 'Failed to load conditional lag data');
      } finally {
        setLoading(false);
      }
    };

    loadConditionalLag();
  }, [eopDataset, targetState, turnThreshold, windowSize]);

  const populatedPhaseIndices = useMemo(() => {
    if (!conditionalLagResult?.signal?.length) {
      return [];
    }

    const columnCount = conditionalLagResult.signal[0]?.length ?? 0;
    return Array.from({ length: columnCount }, (_, columnIndex) => columnIndex).filter((columnIndex) =>
      conditionalLagResult.signal.some((row) => Number.isFinite(row[columnIndex]))
    );
  }, [conditionalLagResult]);

  const phaseLabels = useMemo(() => {
    if (!conditionalLagResult?.phase_bins) return [];
    const bins = conditionalLagResult.phase_bins;
    return bins.slice(0, -1).map((b, i) => {
      const mid = (bins[i] + bins[i + 1]) / 2;
      return mid.toFixed(2);
    });
  }, [conditionalLagResult]);

  const heatmapData = useMemo(() => {
    if (!conditionalLagResult) return null;
    
    const data = showBaseline 
      ? conditionalLagResult.baseline
      : conditionalLagResult.signal;
    
    return {
      z: data,
      x: phaseLabels,
      y: conditionalLagResult.lags,
      type: 'heatmap' as const,
      colorscale: 'RdBu',
      zmid: 0,
      colorbar: { title: { text: 'Z-score' } }
    };
  }, [conditionalLagResult, showBaseline, phaseLabels]);

  const heatmapLayout = useMemo(() => {
    if (!conditionalLagResult) return null;
    
    return {
      title: { text: `Conditional Lag Response (${targetState} State)` },
      xaxis: { 
        title: { text: 'Phase (θ) bins' },
        gridcolor: '#374151',
        zerolinecolor: '#4b5563'
      },
      yaxis: { 
        title: { text: 'Lag (days)' },
        gridcolor: '#374151',
        zerolinecolor: '#4b5563'
      },
      margin: { l: 60, r: 20, t: 60, b: 60 },
      template: 'plotly_dark' as any,
      plot_bgcolor: '#111827',
      paper_bgcolor: '#0b1220',
      font: { color: '#e5e7eb' },
      height: heatmapHeight,
      autosize: true
    };
  }, [conditionalLagResult, heatmapHeight, targetState]);

  const sliceData = useMemo(() => {
    if (!conditionalLagResult) return [];

    if (!populatedPhaseIndices.includes(selectedPhase)) {
      return [];
    }

    const signalValues = conditionalLagResult.signal.map(row => row[selectedPhase]);
    const baselineValues = conditionalLagResult.baseline.map(row => row[selectedPhase]);
    
    return [
      {
        x: conditionalLagResult.lags,
        y: signalValues,
        name: 'Signal',
        line: { color: 'cyan', width: 2 }
      },
      {
        x: conditionalLagResult.lags,
        y: baselineValues,
        name: 'Baseline',
        line: { color: 'gray', dash: 'dot', width: 2 }
      }
    ];
  }, [conditionalLagResult, populatedPhaseIndices, selectedPhase]);

  const sliceLayout = useMemo(() => {
    if (!conditionalLagResult) return null;
    
    const phaseMid = phaseLabels.length > selectedPhase ? phaseLabels[selectedPhase] : 'Unknown';
    
    return {
      title: { text: `Lag Response at PhaseBin ${selectedPhase}: ${phaseMid}` },
      xaxis: { 
        title: { text: 'Lag (days)' },
        gridcolor: '#374151',
        zerolinecolor: '#4b5563'
      },
      yaxis: { 
        title: { text: 'Normalized Response' },
        gridcolor: '#374151',
        zerolinecolor: '#4b5563'
      },
      legend: {
        orientation: 'h' as const,
        yanchor: 'top' as const,
        y: -0.2,
        xanchor: 'center' as const,
        x: 0.5,
        itemwidth: 120,
        tracegroupgap: 24,
      },
      margin: { l: 60, r: 20, t: 60, b: 60 },
      template: 'plotly_dark' as any,
      plot_bgcolor: '#111827',
      paper_bgcolor: '#0b1220',
      font: { color: '#e5e7eb' },
      height: sliceHeight,
      autosize: true
    };
  }, [conditionalLagResult, phaseLabels, selectedPhase, sliceHeight]);

  useEffect(() => {
    if (populatedPhaseIndices.length === 0) {
      setSelectedPhase(0);
      return;
    }

    if (!populatedPhaseIndices.includes(selectedPhase)) {
      setSelectedPhase(populatedPhaseIndices[0]);
    }
  }, [populatedPhaseIndices, selectedPhase, targetState]);

  const stateOptions: StateOption[] = ['Stable', 'Pre', 'Transition', 'Post'];

  if (loading && !conditionalLagResult) {
    return (
      <div className="p-4 bg-[#0b1220]">
        <p className="text-[#9ca3af]">Loading conditional lag response...</p>
      </div>
    );
  }

  if (error && !conditionalLagResult) {
    return (
      <div className="p-4 bg-[#0b1220]">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="p-4 bg-[#0b1220] h-full w-full min-w-0">
      <div className="mb-6 space-y-4">
        {/* Controls */}
        <div className="flex flex-wrap gap-4 items-center justify-center">
          <div className="flex items-center gap-2">
            <label className="text-sm text-[#9ca3af]">State:</label>
            <select
              value={targetState}
              onChange={(e) => setTargetState(e.target.value as StateOption)}
              className="px-3 py-1.5 rounded-lg bg-[#1f2937] text-sm text-[#e5e7eb] border border-[#374151] focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="Stable">Stable</option>
              <option value="Pre">Pre-Transition</option>
              <option value="Transition">Transition</option>
              <option value="Post">Post-Transition</option>
            </select>
          </div>
          
          <div className="flex items-center gap-2">
            <label className="text-sm text-[#9ca3af]">Phase:</label>
            <select
              value={selectedPhase}
              onChange={(e) => setSelectedPhase(Number(e.target.value))}
              className="px-3 py-1.5 rounded-lg bg-[#1f2937] text-sm text-[#e5e7eb] border border-[#374151] focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {conditionalLagResult?.phase_bins 
                ? Array.from({ length: conditionalLagResult.phase_bins.length - 1 }, (_, i) => (
                    <option key={i} value={i} disabled={!populatedPhaseIndices.includes(i)}>
                      {`Bin ${i}${populatedPhaseIndices.includes(i) ? '' : ' (no data)'}`}
                    </option>
                  ))
                : null}
            </select>
          </div>
          
          <div className="flex items-center gap-2 pl-4 border-l border-[#374151]">
            <label className="text-sm text-[#9ca3af]">Show Baseline:</label>
            <input
              type="checkbox"
              checked={showBaseline}
              onChange={(e) => setShowBaseline(e.target.checked)}
              className="w-4 h-4 rounded border-gray-500 text-blue-600 focus:ring-blue-500"
            />
          </div>
        </div>

        {loading && (
          <p className="text-center text-xs text-[#9ca3af]">Refreshing state-specific lag surface...</p>
        )}

        {/* Heatmap */}
        <div className="mb-6 w-full min-w-0">
          {heatmapData && heatmapLayout ? (
            <Plot
              data={[heatmapData]}
              layout={heatmapLayout}
              config={createCsvExportConfig('conditional-lag-heatmap.csv', { displayModeBar: true, responsive: true })}
              style={{ width: '100%', height: `${heatmapHeight}px` }}
              useResizeHandler
            />
          ) : (
            <div className="h-40 flex items-center justify-center">
              <p className="text-[#9ca3af]">No conditional lag data available</p>
            </div>
          )}
        </div>

        {/* Phase Slice */}
        <div className="w-full min-w-0">
          {sliceData.length > 0 && sliceLayout ? (
            <Plot
              data={sliceData}
              layout={sliceLayout}
              config={createCsvExportConfig('conditional-lag-slice.csv', { displayModeBar: true, responsive: true })}
              style={{ width: '100%', height: `${sliceHeight}px` }}
              useResizeHandler
            />
          ) : (
            <div className="h-30 flex items-center justify-center">
              <p className="text-[#9ca3af]">No conditional lag signal is available for the selected phase bin.</p>
            </div>
          )}
        </div>

        {/* Interpretation */}
        <div className="mt-6 p-4 bg-[#1f2937] rounded-lg">
          <h4 className="text-xs font-bold uppercase tracking-wider text-[#9ca3af] mb-2">Interpretation Guide</h4>
          <div className="text-xs text-[#d1d5db] space-y-1">
            <p>• <span className="text-cyan-400">Signal</span> above <span className="text-gray-400">baseline</span> indicates Turning Point → delayed system response</p>
            <p>• Localized regions in heatmap = phase-dependent dynamics</p>
            <p>• Heatmap pattern confirms: turning points only matter at specific phases</p>
          </div>
        </div>
      </div>
    </div>
  );
}
