"use client";

import { useEffect, useState } from 'react';
import Plot from 'react-plotly.js';

const EVENT_YEARS = [1978, 1991, 1999, 2003];

interface AlignmentOmegaPlotProps {
  dates: string[];
  alignment: number[];
  omega: number[];
  turningPoints?: number[];
}

export default function AlignmentOmegaPlot({
  dates,
  alignment,
  omega,
  turningPoints = []
}: AlignmentOmegaPlotProps) {
  const [traces, setTraces] = useState<Plotly.Data[]>([]);

  useEffect(() => {
    const alignmentSmooth = alignment.map(a => (a * 180) / Math.PI);

    const alignmentTrace: Plotly.Data = {
      x: dates,
      y: alignmentSmooth,
      mode: 'lines',
      name: 'Alignment (deg)',
      line: { color: 'red', width: 2 },
      yaxis: 'y1',
    };

    const omegaTrace: Plotly.Data = {
      x: dates,
      y: omega,
      mode: 'lines',
      name: 'ω (rad/day)',
      line: { color: 'blue', width: 2 },
      yaxis: 'y2',
    };

    const data: Plotly.Data[] = [alignmentTrace, omegaTrace];

    if (turningPoints && turningPoints.length > 0) {
      const turningDates = turningPoints.map(i => dates[i]);
      const turningAlignment = turningPoints.map(i => (alignment[i] * 180) / Math.PI);
      const turningOmega = turningPoints.map(i => omega[i]);

      const turningTrace: Plotly.Data = {
        x: turningDates,
        y: turningAlignment,
        mode: 'markers',
        name: 'Turning Points',
        marker: { color: 'green', size: 8, symbol: 'x' },
        yaxis: 'y1',
      };
      data.push(turningTrace);
    }

    // Add event markers
    const eventLines = EVENT_YEARS.map(year => {
      const matchingDates = dates.filter(d => d.startsWith(year.toString()));
      if (matchingDates.length > 0) {
        const dateStr = matchingDates[0];
        return {
          type: 'line',
          xref: 'x',
          yref: 'y1',
          x0: dateStr,
          x1: dateStr,
          y0: 0,
          y1: 1,
          line: {
            color: 'gray',
            width: 1,
            dash: 'dot',
          },
        };
      }
      return null;
    }).filter((line): line is NonNullable<typeof line> => line !== null);

    setTraces(data);
    // Note: Layout will include annotations for event years
  }, [dates, alignment, omega, turningPoints]);

  const layout: Plotly.Layout = {
    title: { text: 'Alignment vs Angular Velocity (Coupling Diagnostic)' } as any,
    xaxis: { title: { text: 'Date' } },
    yaxis: {
      title: { text: 'Alignment (degrees)' },
      titlefont: { color: 'red' },
      tickfont: { color: 'red' },
    },
    yaxis2: {
      title: { text: 'ω (rad/day)' },
      titlefont: { color: 'blue' },
      tickfont: { color: 'blue' },
      overlaying: 'y',
      side: 'right',
    },
    width: 800,
    height: 400,
    showlegend: true,
    plot_bgcolor: '#111827',
    paper_bgcolor: '#0b1220',
    font: { color: '#e5e7eb' },
    shapes: [], // Event lines will be added dynamically if needed
  } as any;

  return <Plot data={traces} layout={layout} config={{ displayModeBar: false }} />;
}
