import { Vec3, dot, normalize } from './math';
import { toSpherical as toSphericalTransform } from './transforms';

export function computeDrift(x: number[], y: number[]): Vec3 {
  if (x.length !== y.length || x.length < 2) {
    return [0, 0, 1];
  }

  const n = x.length;

  const xMean = x.reduce((sum, val) => sum + val, 0) / n;
  const yMean = y.reduce((sum, val) => sum + val, 0) / n;

  const xCentered = x.map((val) => val - xMean);
  const yCentered = y.map((val) => val - yMean);

  const xxSum = xCentered.reduce((sum, val) => sum + val * val, 0);
  const yySum = yCentered.reduce((sum, val) => sum + val * val, 0);
    const xySum = xCentered.reduce((sum, val, idx) => sum + val * yCentered[idx], 0);


  const covXX = xxSum / (n - 1);
  const covYY = yySum / (n - 1);
  const covXY = xySum / (n - 1);

  const trace = covXX + covYY;
  const det = covXX * covYY - covXY * covXY;

  const discriminant = Math.sqrt(trace * trace - 4 * det);
  const lambda1 = (trace + discriminant) / 2;
  const lambda2 = (trace - discriminant) / 2;

  let eigenvector: [number, number];
  if (lambda1 > lambda2) {
    if (Math.abs(covXY) < 1e-10) {
      eigenvector = [1, 0];
    } else {
      eigenvector = [covXY, lambda1 - covXX];
    }
  } else {
    if (Math.abs(covXY) < 1e-10) {
      eigenvector = [0, 1];
    } else {
      eigenvector = [covXY, lambda2 - covXX];
    }
  }

  const norm = Math.sqrt(eigenvector[0] * eigenvector[0] + eigenvector[1] * eigenvector[1]);
  eigenvector = [eigenvector[0] / norm, eigenvector[1] / norm];

  const driftVec = [eigenvector[0], eigenvector[1], 0] as Vec3;
  return normalize(driftVec);
}

export function computeDriftDirectionAngle(drift: Vec3): number {
  const { lon } = toSphericalTransform(drift);
  return lon;
}
