function toDayValues(dates: string[]): number[] {
  return dates.map((value, index) => {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time / 86400000 : index;
  });
}

function unwrapContinuous(values: number[]): number[] {
  const out = [...values];
  let changed = true;

  while (changed) {
    changed = false;
    for (let i = 1; i < out.length; i++) {
      const diff = out[i] - out[i - 1];
      if (diff > Math.PI) {
        out[i] = out[i - 1] + (diff - 2 * Math.PI);
        changed = true;
      } else if (diff < -Math.PI) {
        out[i] = out[i - 1] + (diff + 2 * Math.PI);
        changed = true;
      }
    }
  }

  return out;
}

export function computeDisplayOmega(theta: number[], omega: number[], dates: string[]): number[] {
  if (theta.length === 0) {
    return [];
  }

  const thetaContinuous = unwrapContinuous(theta);
  const timeDays = toDayValues(dates);

  const derived = thetaContinuous.map((_, index) => {
    const prevIndex = Math.max(0, index - 1);
    const nextIndex = Math.min(thetaContinuous.length - 1, index + 1);
    const dt = Math.max(timeDays[nextIndex] - timeDays[prevIndex], 1);
    return (thetaContinuous[nextIndex] - thetaContinuous[prevIndex]) / dt;
  });

  return derived.map((value, index) => {
    const provided = omega[index];
    if (!Number.isFinite(provided)) {
      return value;
    }

    // Replace obvious branch-cut spikes from wrapped theta derivatives.
    return Math.abs(provided) > 0.5 && Math.abs(value) < 0.2 ? value : provided;
  });
}

export function buildPhasePortraitSeries(theta: number[], omega: number[], dates: string[]) {
  const x: Array<number | null> = [];
  const y: Array<number | null> = [];
  const customdata: string[] = [];

  for (let index = 0; index < theta.length; index++) {
    const thetaValue = theta[index];
    const omegaValue = omega[index];
    if (!Number.isFinite(thetaValue) || !Number.isFinite(omegaValue)) {
      continue;
    }

    if (x.length > 0) {
      const prevTheta = x[x.length - 1];
      if (prevTheta !== null && Math.abs(thetaValue - prevTheta) > Math.PI) {
        x.push(null);
        y.push(null);
        customdata.push('');
      }
    }

    x.push(thetaValue);
    y.push(omegaValue);
    customdata.push(dates[index] ?? 'Unknown date');
  }

  return { x, y, customdata };
}
