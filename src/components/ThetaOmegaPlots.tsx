"use client";

import { useEffect, useState, useRef, useMemo } from 'react';
import Plot from 'react-plotly.js';
import { useTimeStore } from '@/store/timeStore';
import { extractPlotlyDateRange } from '@/lib/timeRange';
import { usePlotDisplayHeight } from '@/components/usePlotDisplayHeight';

interface ThetaOmegaPlotsProps {
  dates: string[];
  theta: number[];
  omega: number[];
  turningPoints?: number[];
}

export default function ThetaOmegaPlots({
  dates,
  theta,
  omega,
  turningPoints = []
}: ThetaOmegaPlotsProps) {
  const { timeRange, timeLockEnabled, setTimeRange } = useTimeStore();
  const isInternalUpdate = useRef(false);
  const [traces, setTraces] = useState<Plotly.Data[]>([]);
  const plotHeight = usePlotDisplayHeight(500, 860);

  useEffect(() => {
    if (theta.length === 0 || omega.length === 0) {
      setTraces([]);
      return;
    }

    const thetaTrace: Plotly.Data = {
      x: dates,
      y: theta,
      mode: 'lines+markers',
      type: 'scatter',
      name: 'θ(t) - Phase Angle',
      line: { color: '#3b82f6', width: 1.5 },
      marker: { size: 3 },
      yaxis: 'y1'
    };

    const omegaTrace: Plotly.Data = {
      x: dates,
      y: omega,
      mode: 'lines+markers',
      type: 'scatter',
      name: 'ω(t) - Angular Velocity',
      line: { color: '#ef4444', width: 1.5 },
      marker: { size: 3 },
      yaxis: 'y2'
    };

    const data: Plotly.Data[] = [thetaTrace, omegaTrace];

    if (turningPoints.length > 0) {
      const turningDates = turningPoints.map(i => dates[i]);
      const turningOmega = turningPoints.map(i => omega[i]);

      const turningTrace: Plotly.Data = {
        x: turningDates,
        y: turningOmega,
        mode: 'markers',
        type: 'scatter',
        name: 'Turning Points',
        marker: { color: '#22c55e', size: 8, symbol: 'x' },
        yaxis: 'y2'
      };
      data.push(turningTrace);
    }

    setTraces(data);
   }, [dates, theta, omega, turningPoints]);

   const handleRelayout = (event: any) => {
     if (isInternalUpdate.current || !timeLockEnabled) return;
     const range = extractPlotlyDateRange(event);
     if (!range) return;
     isInternalUpdate.current = true;
     setTimeRange(range);
     setTimeout(() => { isInternalUpdate.current = false; }, 0);
   };

   const layout = useMemo(() => ({
     title: { text: 'Phase Diagnostics: θ(t) and ω(t)' } as any,
     xaxis: { 
       title: { text: 'Date', standoff: 20 },
       gridcolor: '#374151'
     },
     yaxis: {
       title: { text: 'θ (radians)', standoff: 20 },
       titlefont: { color: '#3b82f6' },
       tickfont: { color: '#3b82f6' },
       gridcolor: '#374151'
     },
     yaxis2: {
       title: { text: 'ω (rad/day)', standoff: 20 },
       titlefont: { color: '#ef4444' },
       tickfont: { color: '#ef4444' },
       overlaying: 'y' as const,
       side: 'right' as const,
       gridcolor: '#374151'
     },
     height: plotHeight,
     showlegend: true,
     legend: {
       orientation: 'h' as const,
       yanchor: 'top' as const,
       y: -0.15,
       xanchor: 'center' as const,
       x: 0.5
     },
     plot_bgcolor: '#111827',
     paper_bgcolor: '#0b1220',
     font: { color: '#e5e7eb' },
     autosize: true
   }), [plotHeight]);

   const layoutWithRange = useMemo(() => {
     const axisRange = timeLockEnabled && timeRange
       ? [new Date(timeRange[0]), new Date(timeRange[1])]
       : undefined;

     return {
       ...layout,
       uirevision: axisRange
         ? `${axisRange[0].toISOString()}-${axisRange[1].toISOString()}`
         : 'theta-omega-free-zoom',
       xaxis: {
         ...layout.xaxis,
         range: axisRange
       }
     };
   }, [layout, timeLockEnabled, timeRange]);

   if (traces.length === 0) {
     return (
       <div className="flex items-center justify-center h-full w-full bg-[#111827] rounded-lg border border-[#374151]">
         <p className="text-[#9ca3af]">Loading...</p>
       </div>
     );
   }

   return (
     <div className="h-full w-full min-w-0">
       <Plot
       data={traces}
       layout={layoutWithRange}
       onRelayout={handleRelayout}
       config={{ displayModeBar: true, responsive: true, scrollZoom: true, doubleClick: 'reset+autosize' }}
       style={{ width: '100%', height: `${plotHeight}px` }}
       useResizeHandler
     />
     </div>
   );
}
