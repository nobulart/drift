"use client";

import { useEffect, useState, useRef, useMemo } from 'react';
import Plot from 'react-plotly.js';
import { useTimeStore } from '@/store/timeStore';
import { extractPlotlyDateRange } from '@/lib/timeRange';

interface CouplingPlotProps {
  dates: string[];
  alignment: number[];
  kp?: Array<number | null>;
  ap?: Array<number | null>;
}

export default function CouplingPlot({ 
  dates, 
  alignment, 
  kp, 
  ap 
}: CouplingPlotProps) {
  const { timeRange, timeLockEnabled, setTimeRange } = useTimeStore();
  const isInternalUpdate = useRef(false);
  const [traces, setTraces] = useState<Plotly.Data[]>([]);
  const [smoothedKp, setSmoothedKp] = useState<number[]>([]);
  const [smoothedAp, setSmoothedAp] = useState<number[]>([]);
  const [smoothedAlignment, setSmoothedAlignment] = useState<number[]>([]);

  useEffect(() => {
    // Smooth alignment
    if (alignment && alignment.length > 0) {
      const alignmentDeg = alignment.map(a => (a * 180) / Math.PI);
      const smoothed = alignmentDeg.map((v, i) => {
        const start = Math.max(0, i - 25);
        const end = Math.min(alignmentDeg.length, i + 26);
        const window = alignmentDeg.slice(start, end);
        const sum = window.reduce((acc, val) => acc + val, 0);
        return window.length > 0 ? sum / window.length : v;
      });
      setSmoothedAlignment(smoothed);
    } else {
      setSmoothedAlignment([]);
    }
  }, [alignment]);

  useEffect(() => {
    // Interpolate Kp across full timeline
    if (kp && kp.length > 0) {
      const t = dates.map((_, i) => i);
      const validIndices = t.filter((_, i) => kp[i] !== null);
      const validKp = kp.filter((k) => k !== null);

      if (validIndices.length > 0 && validKp.length > 0) {
        const kp_interp = new Array(dates.length);
        
        for (let i = 0; i < dates.length; i++) {
          if (kp[i] !== null) {
            kp_interp[i] = kp[i];
          } else {
            let leftIdx = -1, rightIdx = -1;
            for (let j = i - 1; j >= 0; j--) {
              if (kp[j] !== null) {
                leftIdx = j;
                break;
              }
            }
            for (let j = i + 1; j < dates.length; j++) {
              if (kp[j] !== null) {
                rightIdx = j;
                break;
              }
            }

            if (leftIdx === -1 && rightIdx === -1) {
              kp_interp[i] = 0;
            } else if (leftIdx === -1) {
              kp_interp[i] = validKp[0];
            } else if (rightIdx === -1) {
              kp_interp[i] = kp[leftIdx];
            } else {
              const tLeft = leftIdx;
              const tRight = rightIdx;
              const kpLeft = Number(kp[leftIdx] ?? 0);
              const kpRight = Number(kp[rightIdx] ?? 0);
              kp_interp[i] = kpLeft + (kpRight - kpLeft) * (i - tLeft) / (tRight - tLeft);
            }
          }
        }

        setSmoothedKp(kp_interp);
      } else {
        setSmoothedKp(new Array(dates.length).fill(0));
      }
    } else {
      setSmoothedKp([]);
    }

    // Interpolate ap across full timeline
    if (ap && ap.length > 0) {
      const t = dates.map((_, i) => i);
      const validIndices = t.filter((_, i) => ap[i] !== null);
      const validAp = ap.filter((a) => a !== null);

      if (validIndices.length > 0 && validAp.length > 0) {
        const ap_interp = new Array(dates.length);
        
        for (let i = 0; i < dates.length; i++) {
          if (ap[i] !== null) {
            ap_interp[i] = ap[i];
          } else {
            let leftIdx = -1, rightIdx = -1;
            for (let j = i - 1; j >= 0; j--) {
              if (ap[j] !== null) {
                leftIdx = j;
                break;
              }
            }
            for (let j = i + 1; j < dates.length; j++) {
              if (ap[j] !== null) {
                rightIdx = j;
                break;
              }
            }

            if (leftIdx === -1 && rightIdx === -1) {
              ap_interp[i] = 0;
            } else if (leftIdx === -1) {
              ap_interp[i] = validAp[0];
            } else if (rightIdx === -1) {
              ap_interp[i] = ap[leftIdx];
            } else {
              const tLeft = leftIdx;
              const tRight = rightIdx;
              const apLeft = Number(ap[leftIdx] ?? 0);
              const apRight = Number(ap[rightIdx] ?? 0);
              ap_interp[i] = apLeft + (apRight - apLeft) * (i - tLeft) / (tRight - tLeft);
            }
          }
        }

        setSmoothedAp(ap_interp);
      } else {
        setSmoothedAp(new Array(dates.length).fill(0));
      }
    } else {
      setSmoothedAp([]);
    }
  }, [dates, kp, ap]);

  useEffect(() => {
    const trace1: Plotly.Data = {
      x: dates,
      y: smoothedAlignment,
      mode: 'lines',
      name: 'Alignment (θ12)',
      line: { color: 'red', width: 2 },
      yaxis: 'y1'
    };

    const data: Plotly.Data[] = [trace1];

    if (smoothedKp && smoothedKp.length > 0 && smoothedKp.some((k) => k > 0)) {
      const trace2: Plotly.Data = {
        x: dates,
        y: smoothedKp,
        mode: 'lines',
        name: 'Kp',
        line: { color: 'blue', width: 1 },
        yaxis: 'y2'
      };
      data.push(trace2);
    }

    if (smoothedAp && smoothedAp.length > 0 && smoothedAp.some((a) => a > 0)) {
      const trace3: Plotly.Data = {
        x: dates,
        y: smoothedAp,
        mode: 'lines',
        name: 'ap',
        line: { color: 'green', width: 1 },
        yaxis: 'y2'
      };
      data.push(trace3);
    }

    setTraces(data);
  }, [dates, smoothedAlignment, smoothedKp, smoothedAp]);

  const handleRelayout = (event: any) => {
    if (isInternalUpdate.current) return;
    const range = extractPlotlyDateRange(event);
    if (!range) return;
    isInternalUpdate.current = true;
    setTimeRange(range);
    setTimeout(() => { isInternalUpdate.current = false; }, 0);
  };

  const layout = useMemo(() => ({
    title: { text: 'Alignment: Drift vs Geomagnetic' } as any,
    xaxis: { 
      title: { text: 'Date', standoff: 20 },
      gridcolor: '#374151',
      zerolinecolor: '#4b5563'
    },
    yaxis: {
      title: { text: 'Alignment (degrees)', standoff: 20 },
      titlefont: { color: 'red' },
      tickfont: { color: 'red' },
      gridcolor: '#374151',
      zerolinecolor: '#4b5563'
    },
    yaxis2: {
      title: { text: 'Kp / ap', standoff: 20 },
      titlefont: { color: 'blue' },
      tickfont: { color: 'blue' },
      overlaying: 'y' as const,
      side: 'right' as const,
      gridcolor: '#374151',
      zerolinecolor: '#4b5563'
    },
    height: 500,
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
    }), []);

    const layoutWithRange = useMemo(() => {
      const axisRange = timeLockEnabled && timeRange
        ? [new Date(timeRange[0]), new Date(timeRange[1])]
        : undefined;

      return {
        ...layout,
        xaxis: {
          ...layout.xaxis,
          range: axisRange
        }
      };
    }, [layout, timeLockEnabled, timeRange]);

    return (
      <div className="h-full w-full min-w-0">
        <Plot
          data={traces}
          layout={layoutWithRange}
          onRelayout={handleRelayout}
          config={{ displayModeBar: true, responsive: true }}
          style={{ width: '100%', height: '500px' }}
          useResizeHandler
        />
      </div>
    );
}
