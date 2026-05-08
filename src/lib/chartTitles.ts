import { useMemo } from 'react';
import { getEOPDataset } from '@/lib/eopDatasets';
import { useTimeStore } from '@/store/timeStore';
import { useStore } from '@/store/useStore';

function toDateString(value: string | number | Date | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    return value.slice(0, 10);
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function dateRangeFromDates(dates?: string[]): [string, string] | null {
  if (!dates?.length) {
    return null;
  }

  const start = toDateString(dates[0]);
  const end = toDateString(dates[dates.length - 1]);
  return start && end ? [start, end] : null;
}

interface ChartTitleOptions {
  showDateRange?: boolean;
}

export function useChartTitle(
  title: string,
  dates?: string[],
  extraSources: string[] = [],
  options: ChartTitleOptions = {}
) {
  const eopDataset = useStore(state => state.eopDataset);
  const data = useStore(state => state.data);
  const { timeRange, timeLockEnabled } = useTimeStore();

  return useMemo(() => {
    const showDateRange = options.showDateRange ?? true;
    const lockedStart = timeLockEnabled && timeRange ? toDateString(timeRange[0]) : null;
    const lockedEnd = timeLockEnabled && timeRange ? toDateString(timeRange[1]) : null;
    const lockedRange: [string, string] | null = lockedStart && lockedEnd ? [lockedStart, lockedEnd] : null;
    const dataRange = dateRangeFromDates(dates) ?? dateRangeFromDates(data.map(sample => sample.t));
    const range = lockedRange?.[0] && lockedRange?.[1] ? lockedRange : dataRange;
    const rangeLabel = range ? `${range[0]} to ${range[1]}` : 'selected range';
    const sourceNames = Array.from(new Set([
      getEOPDataset(eopDataset).shortLabel,
      ...extraSources,
    ].filter(Boolean)));
    const titleText = showDateRange ? `${title} (${rangeLabel})` : title;

    return {
      text: `${titleText}<br><sup>Source: ${sourceNames.join(' + ')}</sup>`,
      x: 0.5,
      xanchor: 'center' as const,
    };
  }, [data, dates, eopDataset, extraSources, options.showDateRange, timeLockEnabled, timeRange, title]);
}
