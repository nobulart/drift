import { ChartMarker } from '@/store/useStore';
import type { MouseEvent } from 'react';

export const MARKER_EMOJI_OPTIONS = ['🐧', '⭐', '🚩', '⚠️', '✅', '🔬', '🧭', '📍'];

export function formatMarkerText(marker: Pick<ChartMarker, 'emoji' | 'label'>) {
  const label = marker.label?.trim();
  return label ? `${marker.emoji} ${label}` : marker.emoji;
}

export function getMarkerLabel(marker: Pick<ChartMarker, 'label'>) {
  return marker.label?.trim() || '';
}

export function findNearestDateIndex(dates: string[], targetDate: string) {
  const targetTime = new Date(`${targetDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(targetTime)) {
    return -1;
  }

  let nearestIndex = -1;
  let nearestDistance = Infinity;

  dates.forEach((date, index) => {
    const time = new Date(`${date.slice(0, 10)}T00:00:00Z`).getTime();
    if (!Number.isFinite(time)) {
      return;
    }

    const distance = Math.abs(time - targetTime);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  return nearestIndex;
}

export function getMarkerLabelSize(markerSize: number) {
  return Math.max(10, Math.round(markerSize * 0.67));
}

export function buildMarkerLayout(markers: ChartMarker[], existingLayout: Partial<Plotly.Layout> = {}, markerSize = 18) {
  const shapes = [...((existingLayout.shapes as Array<Partial<Plotly.Shape>> | undefined) ?? [])];
  const annotations = [...((existingLayout.annotations as Array<Partial<Plotly.Annotations>> | undefined) ?? [])];
  const labelSize = getMarkerLabelSize(markerSize);

  markers.forEach((marker) => {
    shapes.push({
      type: 'line',
      xref: 'x',
      yref: 'paper',
      x0: marker.date,
      x1: marker.date,
      y0: 0,
      y1: 1,
      line: {
        color: 'rgba(250, 204, 21, 0.62)',
        width: 1.5,
        dash: 'dot',
      },
      layer: 'above',
    });

    annotations.push({
      xref: 'x',
      yref: 'paper',
      x: marker.date,
      y: 1.01,
      text: marker.emoji,
      showarrow: false,
      font: { size: markerSize },
      xanchor: 'center',
      yanchor: 'bottom',
      hovertext: marker.label || marker.date,
      captureevents: false,
    });

    const label = getMarkerLabel(marker);
    if (label) {
      annotations.push({
        xref: 'x',
        yref: 'paper',
        x: marker.date,
        y: 1.01,
        text: label,
        showarrow: false,
        font: { size: labelSize, color: '#fef3c7' },
        xanchor: 'left',
        yanchor: 'bottom',
        xshift: 14,
        hovertext: marker.date,
        captureevents: false,
      });
    }
  });

  return { shapes, annotations };
}

export function getPlotClickDate(event: Readonly<Plotly.PlotMouseEvent>): string | null {
  const point = event.points?.[0];
  if (!point?.x) {
    return null;
  }

  const parsed = new Date(String(point.x));
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

export function getPlotPointDate(event: Readonly<Plotly.PlotMouseEvent>): string | null {
  const point = event.points?.[0];
  const candidates = [
    point?.customdata,
    Array.isArray(point?.customdata) ? point.customdata[0] : undefined,
    Array.isArray(point?.customdata) ? point.customdata[1] : undefined,
    point?.x,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue;
    }

    const parsed = new Date(candidate);
    if (Number.isFinite(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }

  return null;
}

export function getContextMenuDate(event: MouseEvent<HTMLDivElement>, range?: Array<Date | string | number>): string | null {
  const dragLayer = event.currentTarget.querySelector('.nsewdrag') as SVGRectElement | null;
  const bounds = dragLayer?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();

  if (bounds.width <= 0) {
    return null;
  }

  const [rangeStart, rangeEnd] = range && range.length === 2
    ? range
    : [undefined, undefined];
  const start = new Date(rangeStart ?? '').getTime();
  const end = new Date(rangeEnd ?? '').getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) {
    return null;
  }

  const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
  const time = start + (end - start) * ratio;
  return new Date(time).toISOString().slice(0, 10);
}

export function getMarkerDeleteToleranceDays(range?: Array<Date | string | number>) {
  if (!range || range.length !== 2) {
    return 14;
  }

  const start = new Date(range[0]).getTime();
  const end = new Date(range[1]).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return 14;
  }

  return Math.max(3, Math.abs(end - start) / 86400000 * 0.015);
}
