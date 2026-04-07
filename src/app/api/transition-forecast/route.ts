import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({
  currentState: z.number().min(0).max(3).default(1),
  theta: z.number().default(0),
  baseProb: z.number().min(0).max(1).default(0.5),
  smoothSigma: z.number().default(1.0),
});

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    
    const params = ParamsSchema.parse({
      currentState: searchParams.get('currentState') ? parseInt(searchParams.get('currentState')!) : 1,
      theta: searchParams.get('theta') ? parseFloat(searchParams.get('theta')!) : 0,
      baseProb: searchParams.get('baseProb') ? parseFloat(searchParams.get('baseProb')!) : 0.5,
      smoothSigma: searchParams.get('smoothSigma') ? parseFloat(searchParams.get('smoothSigma')!) : 1.0,
    });

    const dataPath = join(process.cwd(), 'public', 'data', 'eop_historic.json');
    const statsCacheDir = join(process.cwd(), 'public', 'data', '.rolling-stats-cache');
    
    // Find the most recent rolling stats cache
    let statsPath: string | null = null;
    let latestMtime = 0;
    
    try {
      const files = await fs.readdir(statsCacheDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = join(statsCacheDir, file);
          const stat = await fs.stat(filePath);
          if (stat.mtime.getTime() > latestMtime) {
            latestMtime = stat.mtime.getTime();
            statsPath = filePath;
          }
        }
      }
    } catch (err) {
      // Cache directory may not exist yet
    }
    
    if (!statsPath) {
      return NextResponse.json(
        { error: 'No rolling stats available. Please compute rolling stats first.' },
        { status: 400 }
      );
    }
    
    // Load rolling stats
    let statsData: any;
    try {
      const dataStr = await fs.readFile(statsPath, 'utf8');
      statsData = JSON.parse(dataStr);
    } catch (err) {
      return NextResponse.json(
        { error: 'Failed to load rolling stats cache' },
        { status: 500 }
      );
    }
    
    // Extract conditional lag model
    const conditionalResult = statsData.conditionalLagModel || statsData;
    if (!conditionalResult || !conditionalResult.signal) {
      return NextResponse.json(
        { error: 'No conditional lag model available' },
        { status: 400 }
      );
    }
    
    // Extract and normalize lag kernel
    const lags = conditionalResult.lags || [];
    const signal = conditionalResult.signal || [];
    const phase_bins = conditionalResult.phase_bins || [];
    
    // Convert to positive kernel
    const n_lags = lags.length;
    const n_phases = phase_bins.length > 1 ? phase_bins.length - 1 : 6;
    
    let lagKernel: number[][] = [];
    for (let i = 0; i < n_lags; i++) {
      const row: number[] = [];
      for (let p = 0; p < n_phases; p++) {
        const val = (signal[i] && signal[i][p]) || 0;
        row.push(Math.max(0, val));
      }
      lagKernel.push(row);
    }
    
    for (let p = 0; p < n_phases; p++) {
      let colSum = 0;
      for (let i = 0; i < n_lags; i++) {
        colSum += lagKernel[i][p] || 0;
      }
      if (colSum > 0) {
        for (let i = 0; i < n_lags; i++) {
          lagKernel[i][p] = lagKernel[i][p]! / colSum;
        }
      } else {
        // Uniform distribution if all zeros
        const uniform = 1.0 / n_lags;
        for (let i = 0; i < n_lags; i++) {
          lagKernel[i][p] = uniform;
        }
      }
    }
    
    // Apply Gaussian smoothing if requested
    if (params.smoothSigma > 0) {
      // Simple 1D Gaussian smoothing per phase bin
      lagKernel = applyGaussianSmooth(lagKernel, params.smoothSigma);
    }
    
    // Compute transition forecast
    const phase_idx = Math.min(params.currentState, n_phases - 1);
    const L = lagKernel.map(row => row[phase_idx] || 0);
    
    // Combine with base probability
    let P_tau = L.map(p => params.baseProb * p);
    
    // Normalize
    const total = P_tau.reduce((sum, p) => sum + p, 0);
    if (total > 0) {
      P_tau = P_tau.map(p => p / total);
    } else {
      const uniform = 1.0 / n_lags;
      P_tau = new Array(n_lags).fill(uniform);
    }
    
    // Cumulative
    const cumulative: number[] = [];
    let cumSum = 0;
    for (const p of P_tau) {
      cumSum += p;
      cumulative.push(cumSum);
    }
    
    // Metrics
    let expected_time = 0;
    let peak_idx = 0;
    let peak_prob = 0;
    
    for (let i = 0; i < n_lags; i++) {
      expected_time += P_tau[i] * lags[i];
      if (P_tau[i] > peak_prob) {
        peak_prob = P_tau[i];
        peak_idx = i;
      }
    }
    
    const peak_time = lags[peak_idx];
    
    // Alert level
    let closest_idx = 0;
    let min_diff = Math.abs(lags[0] - 30);
    for (let i = 1; i < lags.length; i++) {
      const diff = Math.abs(lags[i] - 30);
      if (diff < min_diff) {
        min_diff = diff;
        closest_idx = i;
      }
    }
    
    const P_30d = cumulative[closest_idx];
    let alert_level: 'LOW' | 'MODERATE' | 'HIGH' | 'UNKNOWN';
    let alert_message: string;
    
    if (P_30d > 0.6) {
      alert_level = 'HIGH';
      alert_message = `HIGH PROBABILITY SHIFT (30d): P=${P_30d.toFixed(2)}`;
    } else if (P_30d > 0.3) {
      alert_level = 'MODERATE';
      alert_message = `MODERATE RISK (30d): P=${P_30d.toFixed(2)}`;
    } else {
      alert_level = 'LOW';
      alert_message = `LOW RISK (30d): P=${P_30d.toFixed(2)}`;
    }
    
    return NextResponse.json({
      lags,
      P_tau,
      expected_time,
      peak_time,
      cumulative,
      alert_level,
      alert_message,
      phase_bin: phase_idx,
      base_prob: params.baseProb
    });
    
  } catch (error) {
    console.error('Error computing transition forecast:', error);
    return NextResponse.json(
      { error: 'Failed to compute transition forecast' },
      { status: 500 }
    );
  }
}

/**
 * Simple Gaussian smoothing for 2D array (lags × phases).
 */
function applyGaussianSmooth(kernel: number[][], sigma: number): number[][] {
  const n_lags = kernel.length;
  const n_phases = kernel[0]?.length || 6;
  
  const smoothed: number[][] = [];
  
  for (let p = 0; p < n_phases; p++) {
    const col: number[] = [];
    for (let i = 0; i < n_lags; i++) {
      col.push(kernel[i][p] || 0);
    }
    
    // Apply 1D Gaussian smoothing
    const smoothedCol = gaussianSmooth1D(col, sigma);
    
    for (let i = 0; i < n_lags; i++) {
      if (!smoothed[i]) {
        smoothed[i] = [];
      }
      smoothed[i][p] = smoothedCol[i];
    }
  }
  
  return smoothed;
}

/**
 * 1D Gaussian smoothing using convolution.
 */
function gaussianSmooth1D(data: number[], sigma: number): number[] {
  const n = data.length;
  const result: number[] = [];
  
  // Kernel size: 6*sigma (cover 99.7% of distribution)
  const kernelSize = Math.floor(6 * sigma) | 1;
  const halfKernel = Math.floor(kernelSize / 2);
  
  // Generate Gaussian kernel
  const kernel: number[] = [];
  let kernelSum = 0;
  for (let i = -halfKernel; i <= halfKernel; i++) {
    const val = Math.exp(-0.5 * (i / sigma) ** 2);
    kernel.push(val);
    kernelSum += val;
  }
  
  // Normalize kernel
  for (let i = 0; i < kernel.length; i++) {
    kernel[i] /= kernelSum;
  }
  
  // Convolve
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -halfKernel; k <= halfKernel; k++) {
      const idx = i + k;
      if (idx >= 0 && idx < n) {
        sum += data[idx] * kernel[k + halfKernel];
      }
    }
    result.push(sum);
  }
  
  return result;
}
