"use client";

import { useEffect, useState } from 'react';
import Plot from 'react-plotly.js';

interface PhasePortraitProps {
  dates: string[];
  theta: number[];
  omega: number[];
  turningPoints?: number[];
}

export default function PhasePortrait({
  dates,
  theta,
  omega,
  turningPoints = []
}: PhasePortraitProps) {
  const [traces, setTraces] = useState<Plotly.Data[]>([]);

  useEffect(() => {
    if (theta.length === 0 || omega.length === 0) {
      setTraces([]);
      return;
    }

    const trace1: Plotly.Data = {
      x: theta,
      y: omega,
      mode: 'lines+markers',
      type: 'scatter',
      name: 'Phase Portrait',
      line: { color: '#3b82f6', width: 1.5 },
      marker: { size: 3, color: 'rgba(59, 130, 246, 0.5)' }
    };

    const data: Plotly.Data[] = [trace1];

    if (turningPoints.length > 0) {
      const turningTheta = turningPoints.map(i => theta[i]);
      const turningOmega = turningPoints.map(i => omega[i]);

      const turningTrace: Plotly.Data = {
        x: turningTheta,
        y: turningOmega,
        mode: 'markers',
        type: 'scatter',
        name: 'Turning Points',
        marker: { color: '#ef4444', size: 8, symbol: 'circle-solid' }
      };
      data.push(turningTrace);
    }

    setTraces(data);
  }, [theta, omega, turningPoints]);

   const layout = {
    title: { text: 'Phase Portrait: θ vs ω' } as any,
    xaxis: { 
      title: { text: 'Phase Angle θ (radians)', standoff: 20 },
      gridcolor: '#374151',
      zerolinecolor: '#4b5563'
    },
    yaxis: { 
      title: { text: 'Angular Velocity ω (rad/day)', standoff: 20 },
      gridcolor: '#374151',
      zerolinecolor: '#4b5563'
    },
    height: 500,
    showlegend: true,
    legend: {
      orientation: 'h',
      yanchor: 'top',
      y: -0.15,
      xanchor: 'center',
      x: 0.5
    },
    hovermode: 'closest',
    plot_bgcolor: '#111827',
    paper_bgcolor: '#0b1220',
    font: { color: '#e5e7eb' },
    autosize: true,
  } as any;

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
        layout={layout}
        config={{ displayModeBar: true, responsive: true }}
        style={{ width: '100%', height: '500px' }}
        useResizeHandler
      />
    </div>
  );
}
