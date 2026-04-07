export function generateNullSeries(n: number, seed: number = 42): { x: number[]; y: number[] } {
  let x = 0;
  let y = 0;
  const xSeries: number[] = [];
  const ySeries: number[] = [];

  let currentSeed = seed;

  for (let i = 0; i < n; i++) {
    const dayOfYear = i;

    const seasonalX = 0.1 * Math.sin((2 * Math.PI * dayOfYear) / 365);
    const seasonalY = 0.1 * Math.cos((2 * Math.PI * dayOfYear) / 365);

    currentSeed = (currentSeed * 1103515245 + 12345) & 0x7fffffff;
    const noiseX = (currentSeed / 0x7fffffff - 0.5) * 0.01;

    currentSeed = (currentSeed * 1103515245 + 12345) & 0x7fffffff;
    const noiseY = (currentSeed / 0x7fffffff - 0.5) * 0.01;

    x += noiseX;
    y += noiseY;

    xSeries.push(x + seasonalX);
    ySeries.push(y + seasonalY);
  }

  return { x: xSeries, y: ySeries };
}

export function generateNullEnsemble(
  nSamples: number,
  nPoints: number,
  seed: number = 42
): { x: number[][]; y: number[][] } {
  const xSamples: number[][] = [];
  const ySamples: number[][] = [];

  for (let i = 0; i < nSamples; i++) {
    const { x, y } = generateNullSeries(nPoints, seed + i);
    xSamples.push(x);
    ySamples.push(y);
  }

  return { x: xSamples, y: ySamples };
}
