'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import Plot from 'react-plotly.js';
import { useStore } from '@/store/useStore';
import { LagKernel, TransitionForecast } from '@/lib/types';

export default function TransitionForecastPanel() {
  const [lagKernel, setLagKernel] = useState<LagKernel | null>(null);
  const [forecast, setForecast] = useState<TransitionForecast | null>(null);
  const [currentState, setCurrentState] = useState<number>(1);
  const [baseProb, setBaseProb] = useState<number>(0.5);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | undefined>(undefined);

  const rollingStats = useStore(state => state.rollingStats);
  const theta3 = useStore(state => state.theta3);
  const data = useStore(state => state.data);
  const presentTimeIndex = useMemo(() => {
    return data.length > 0 ? data.length - 1 : -1;
  }, [data]);

  useEffect(() => {
    if (containerRef.current) {
      setWidth(containerRef.current.clientWidth);
    }
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        setWidth(containerRef.current.clientWidth);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (rollingStats?.conditionalLagModel) {
      const kernel = convertToLagKernel(rollingStats.conditionalLagModel);
      setLagKernel(kernel);
    }
  }, [rollingStats]);

  useEffect(() => {
    if (lagKernel && theta3.length > 0) {
      const currentTheta = theta3[presentTimeIndex] || 0;
      fetchForecast(currentTheta, currentState, baseProb);
    }
  }, [lagKernel, theta3, presentTimeIndex, currentState, baseProb]);

  const fetchForecast = async (theta: number, state: number, baseP: number) => {
    try {
      const url = new URL('/api/transition-forecast', window.location.origin);
      url.searchParams.set('currentState', state.toString());
      url.searchParams.set('theta', theta.toString());
      url.searchParams.set('baseProb', baseP.toString());
      
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setForecast(data);
      }
    } catch (err) {
      console.error('Failed to fetch forecast:', err);
    }
  };

  const stateLabels = ['Stable', 'Pre', 'Transition', 'Post'];
  const expectedDateLabel = useMemo(() => {
    if (!forecast || !Number.isFinite(forecast.expected_time) || data.length === 0) {
      return null;
    }

    const anchorSample = data[presentTimeIndex] || data[data.length - 1];
    if (!anchorSample?.t) {
      return null;
    }

    const anchorDate = new Date(anchorSample.t);
    if (Number.isNaN(anchorDate.getTime())) {
      return null;
    }

    const projectedDate = new Date(anchorDate);
    projectedDate.setDate(projectedDate.getDate() + Math.round(forecast.expected_time));

    return projectedDate.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }, [presentTimeIndex, data, forecast]);

  const probabilityData = useMemo(() => {
    if (!forecast || !forecast.lags || forecast.lags.length === 0) return [];
    
    const trace: Partial<Plotly.Data> = {
      x: forecast.lags,
      y: forecast.P_tau,
      type: 'scatter' as const,
      mode: 'lines' as const,
      name: 'P(shift at τ)',
      line: { color: '#3b82f6', width: 2, dash: 'solid' as const }
    };
    
    return [trace];
  }, [forecast]);

  const cumulativeData = useMemo(() => {
    if (!forecast || !forecast.lags || forecast.lags.length === 0) return [];
    
    return {
      x: forecast.lags,
      y: forecast.cumulative,
      type: 'scatter',
      mode: 'lines',
      name: 'Cumulative',
      line: { color: '#8b5cf6', width: 2, dash: 'dot' }
    };
  }, [forecast]);

  const forecastLayout = useMemo(() => {
    if (!lagKernel) return null;
    
    return {
      title: { text: 'Transition Probability Curve', standoff: 20 },
      xaxis: { 
        title: { text: 'Days Ahead (τ)', standoff: 20 },
        gridcolor: '#374151',
        zerolinecolor: '#4b5563'
      },
      yaxis: { 
        title: { text: 'Probability Density', standoff: 20 },
        gridcolor: '#374151',
        zerolinecolor: '#4b5563',
        range: [0, 0.1]
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
      width: width || 800,
      height: 400,
      autosize: true
    };
  }, [lagKernel, width]);

  const stateColors = ['#10b981', '#f59e0b', '#ef4444', '#6b7280'];  // emerald, amber, red, gray

  if (!rollingStats || !lagKernel) {
    return (
      <div className="p-4 bg-[#0b1220]">
        <p className="text-[#9ca3af]">Waiting for rolling statistics...</p>
      </div>
    );
  }

  return (
    <div className="p-4 bg-[#0b1220]" ref={containerRef}>
      {/* Controls */}
      <div className="mb-6 space-y-4">
        <div className="flex flex-wrap gap-4 items-center justify-center">
          <div className="flex items-center gap-2">
            <label className="text-sm text-[#9ca3af]">State:</label>
            <select
              value={currentState}
              onChange={(e) => setCurrentState(parseInt(e.target.value))}
              className="px-3 py-1.5 rounded-lg bg-[#1f2937] text-sm text-[#e5e7eb] border border-[#374151] focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={0}>Stable</option>
              <option value={1}>Pre-Transition</option>
              <option value={2}>Transition</option>
              <option value={3}>Post-Transition</option>
            </select>
          </div>
          
          <div className="flex items-center gap-2">
            <label className="text-sm text-[#9ca3af]">Base Prob:</label>
            <input
              type="range"
              min="0.1"
              max="1.0"
              step="0.1"
              value={baseProb}
              onChange={(e) => setBaseProb(parseFloat(e.target.value))}
              className="w-24 h-2 bg-[#374151] rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
            <span className="text-sm text-[#e5e7eb] font-mono w-8 text-center">
              {baseProb.toFixed(1)}
            </span>
          </div>
        </div>
      </div>

  {/* Forecast Plot */}
  <div className="mb-6">
    {forecast && forecast.lags.length > 0 ? (
      <Plot
        data={[...probabilityData as any, cumulativeData as any]}
        layout={forecastLayout as any}
        config={{ displayModeBar: true }}
        style={{ width: '100%', height: '400px' }}
      />
    ) : (
      <div className="h-40 flex items-center justify-center">
        <p className="text-[#9ca3af]">Waiting for forecast data...</p>
      </div>
    )}
  </div>

      {/* Metrics */}
      {forecast && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="p-4 bg-[#1f2937] rounded-lg border border-[#374151]">
            <p className="text-xs text-[#9ca3af] uppercase tracking-wider">Peak Time</p>
            <p className="text-2xl font-bold text-[#e5e7eb]">
              {forecast.peak_time.toFixed(1)} <span className="text-sm font-normal text-[#9ca3af]">days</span>
            </p>
          </div>
          
          <div className="p-4 bg-[#1f2937] rounded-lg border border-[#374151]">
            <p className="text-xs text-[#9ca3af] uppercase tracking-wider">Expected Time</p>
            <p className="text-2xl font-bold text-[#3b82f6]">
              {forecast.expected_time.toFixed(1)} <span className="text-sm font-normal text-[#9ca3af]">days</span>
            </p>
            {expectedDateLabel && (
              <p className="mt-1 text-xs text-[#93c5fd]">
                ~ {expectedDateLabel}
              </p>
            )}
          </div>
          
          <div className="p-4 bg-[#1f2937] rounded-lg border border-[#374151]">
            <p className="text-xs text-[#9ca3af] uppercase tracking-wider">P(≤30d)</p>
            <p className="text-2xl font-bold text-[#e5e7eb]">
              {((forecast.cumulative[30] || 0) * 100).toFixed(1)}%
            </p>
          </div>
          
          <div className={`p-4 rounded-lg border ${getAlertBgColor(forecast.alert_level)}`}>
            <p className="text-xs text-[#9ca3af] uppercase tracking-wider">Alert Level</p>
            <div className="flex items-center gap-2 mt-1">
              <div className={`w-3 h-3 rounded-full ${getAlertDotColor(forecast.alert_level)}`} />
              <p className="text-2xl font-bold">
                {forecast.alert_level}
              </p>
            </div>
            <p className="text-xs text-[#e5e7eb] mt-2">
              {forecast.alert_message}
            </p>
          </div>
        </div>
      )}

      {/* Interpretation */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 bg-[#1f2937] rounded-lg">
          <h4 className="text-xs font-bold uppercase tracking-wider text-[#9ca3af] mb-2">
            Interpretation Guide
          </h4>
          <div className="text-xs text-[#d1d5db] space-y-1">
            <p>• <span className="text-cyan-400">High P0 + early lag peak</span> → <span className="text-emerald-400">imminent shift</span></p>
            <p>• <span className="text-cyan-400">High P0 + late lag peak</span> → <span className="text-amber-400">latent transition</span></p>
            <p>• <span className="text-cyan-400">Low P0 + flat lag kernel</span> → <span className="text-gray-400">stable regime</span></p>
          </div>
        </div>
        
        <div className="p-4 bg-[#1f2937] rounded-lg">
          <h4 className="text-xs font-bold uppercase tracking-wider text-[#9ca3af] mb-2">
            Phase & State
          </h4>
          <div className="text-xs text-[#d1d5db] space-y-1">
            <p>
              <span className="text-[#9ca3af]">Current state:</span>  <span className="text-white font-bold">{stateLabels[currentState]}</span>
            </p>
            <p>
              <span className="text-[#9ca3af]">Phase bin:</span>  <span className="text-white font-bold">lag kernel phase {forecast?.phase_bin || 0}</span>
            </p>
            <p>
              <span className="text-[#9ca3af]">Base probability:</span>  <span className="text-white font-mono">{baseProb.toFixed(2)}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function convertToLagKernel(conditionalResult: any): LagKernel {
  const lags = conditionalResult.lags || [];
  const signal = conditionalResult.signal || [];
  const phase_bins = conditionalResult.phase_bins || [];
  
  const n_lags = lags.length;
  const n_phases = phase_bins.length > 1 ? phase_bins.length - 1 : 6;
  
  // Extract and normalize kernel
  const kernel: number[][] = [];
  
  for (let i = 0; i < n_lags; i++) {
    const row: number[] = [];
    for (let p = 0; p < n_phases; p++) {
      const val = (signal[i] && signal[i][p]) || 0;
      row.push(Math.max(0, val));
    }
    kernel.push(row);
  }
  
  // Normalize per phase bin
  for (let p = 0; p < n_phases; p++) {
    let colSum = 0;
    for (let i = 0; i < n_lags; i++) {
      colSum += kernel[i][p];
    }
    if (colSum > 0) {
      for (let i = 0; i < n_lags; i++) {
        kernel[i][p] = kernel[i][p] / colSum;
      }
    }
  }
  
  return {
    lags,
    phase_bins,
    kernel,
    n_lags,
    n_phases
  };
}

function getAlertBgColor(level: string): string {
  switch (level) {
    case 'HIGH':
      return 'border-red-500/30';
    case 'MODERATE':
      return 'border-amber-500/30';
    case 'LOW':
      return 'border-emerald-500/30';
    default:
      return 'border-gray-500/30';
  }
}

function getAlertDotColor(level: string): string {
  switch (level) {
    case 'HIGH':
      return 'bg-red-500';
    case 'MODERATE':
      return 'bg-amber-500';
    case 'LOW':
      return 'bg-emerald-500';
    default:
      return 'bg-gray-500';
  }
}
