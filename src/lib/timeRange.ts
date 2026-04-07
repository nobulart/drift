export function extractPlotlyDateRange(event: Record<string, any>): [number, number] | null {
  const from = event['xaxis.range[0]'];
  const to = event['xaxis.range[1]'];

  if (!from || !to) {
    return null;
  }

  const start = new Date(from).getTime();
  const end = new Date(to).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }

  return start <= end ? [start, end] : [end, start];
}
