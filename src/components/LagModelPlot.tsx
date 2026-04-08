'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import Plot from 'react-plotly.js';
import { useTimeStore } from '@/store/timeStore';
import { useStore } from '@/store/useStore';
import { LagResult } from '@/lib/types';
import { usePlotDisplayHeight } from '@/components/usePlotDisplayHeight';

export default function LagModelPlot() {
  const [lagResult, setLagResult] = useState<LagResult | null>(null);
  const isInternalUpdate = useRef(false);
  const plotHeight = usePlotDisplayHeight(500, 860);
  
  const { timeRange, timeLockEnabled, setTimeRange } = useTimeStore();
  const rollingStats = useStore(state => state.rollingStats);
  const [lagTraces, setLagTraces] = useState<Plotly.Data[]>([]);

  useEffect(() => {
    if (rollingStats?.lagModel) {
      setLagResult(rollingStats.lagModel);
    }
  }, [rollingStats]);

  useEffect(() => {
    if (!lagResult) return;

    setLagTraces([
      {
        x: lagResult.lags,
        y: lagResult.signal,
        name: 'Turning Point Response',
        line: { color: 'cyan', width: 2 }
      },
      {
        x: lagResult.lags,
        y: lagResult.baseline,
        name: 'Baseline',
        line: { color: 'gray', dash: 'dot', width: 2 }
      }
    ]);
  }, [lagResult]);

  const handleRelayout = (event: any) => {
    if (!timeLockEnabled || isInternalUpdate.current) return;

    if (event['xaxis.range[0]'] && event['xaxis.range[1]']) {
      isInternalUpdate.current = true;
      const t0 = new Date(event['xaxis.range[0]']).getTime();
      const t1 = new Date(event['xaxis.range[1]']).getTime();
      setTimeRange([t0, t1]);
      setTimeout(() => { isInternalUpdate.current = false; }, 0);
    }
  };

  const lagLayout = useMemo(() => ({
    title: { text: 'Lag Response Function' },
    xaxis: { 
      title: { text: 'Lag (days)', standoff: 20 },
      gridcolor: '#374151',
      zerolinecolor: '#4b5563'
    },
    yaxis: { 
      title: { text: 'Normalized Response', standoff: 20 },
      gridcolor: '#374151',
      zerolinecolor: '#4b5563'
    },
    legend: {
      orientation: 'h' as const,
      yanchor: 'top' as const,
      y: -0.2,
      xanchor: 'center' as const,
      x: 0.5
    },
    margin: { l: 60, r: 20, t: 60, b: 60 },
    template: 'plotly_dark' as any,
    plot_bgcolor: '#111827',
    paper_bgcolor: '#0b1220',
    font: { color: '#e5e7eb' },
    height: plotHeight,
    autosize: true
  }), [plotHeight]);

  return (
    <div className="p-4 bg-[#0b1220] h-full w-full min-w-0">
      <div className="mb-6">
        <Plot
          data={lagTraces}
          layout={lagLayout}
          config={{ displayModeBar: true, responsive: true }}
          style={{ width: '100%', height: `${plotHeight}px` }}
          useResizeHandler
        />
      </div>
      <p className="text-sm text-[#9ca3af]">
        <span className="text-cyan-400">Signal</span> above <span className="text-gray-400">baseline</span> indicates Turning Point → delayed system response
      </p>
    </div>
  );
}
