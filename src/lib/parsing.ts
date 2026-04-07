export function parseDate(dateStr: string): Date {
  return new Date(dateStr);
}

export function formatISODate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function interpolateDates(
  dates: Date[],
  targetDates: Date[]
): { sourceIndex: number; targetIndex: number }[] {
  const result: { sourceIndex: number; targetIndex: number }[] = [];

  for (let ti = 0; ti < targetDates.length; ti++) {
    const targetDate = targetDates[ti];
    let bestIndex = 0;
    let bestDiff = Infinity;

    for (let si = 0; si < dates.length; si++) {
      const diff = Math.abs(dates[si].getTime() - targetDate.getTime());
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIndex = si;
      }
    }

    result.push({ sourceIndex: bestIndex, targetIndex: ti });
  }

  return result;
}

export function groupByYear(dates: Date[], values: number[]): { [year: number]: number[] } {
  const result: { [year: number]: number[] } = {};

  for (let i = 0; i < dates.length; i++) {
    const year = dates[i].getFullYear();
    if (!result[year]) {
      result[year] = [];
    }
    result[year].push(values[i]);
  }

  return result;
}

export function slidingWindow<T>(data: T[], windowSize: number): T[][] {
  const windows: T[][] = [];
  for (let i = 0; i <= data.length - windowSize; i++) {
    windows.push(data.slice(i, i + windowSize));
  }
  return windows;
}
