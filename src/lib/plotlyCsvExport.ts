type PlotlyLikeTrace = {
  name?: string;
  type?: string;
  visible?: boolean | 'legendonly';
  x?: unknown;
  y?: unknown;
  z?: unknown;
  customdata?: unknown;
};

type PlotlyLikeGraph = {
  data?: PlotlyLikeTrace[];
  _fullLayout?: {
    xaxis?: { range?: unknown[] };
    yaxis?: { range?: unknown[] };
  };
};

type CsvRow = unknown[];

export type WideCsvSeries = {
  label: string;
  normalized: number[];
  raw: number[];
};

export type TimeSampleForCsv = {
  t: string;
};

const csvIcon = {
  width: 512,
  height: 512,
  path:
    'M64 32h256l128 128v320H64zM320 32v128h128M144 288h48v32h-48v64h64v32h-96V256h96v32h-64zm104-32 40 112 40-112h40l-60 160h-40l-60-160h40zm152 0h88v32h-56v32h48v32h-48v64h-32V256z',
};

function toArray(value: unknown): unknown[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return Array.from(value as unknown as ArrayLike<unknown>);
  }
  return [];
}

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function numericValue(value: unknown): number | null {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const dateValue = new Date(value).getTime();
    if (Number.isFinite(dateValue)) {
      return dateValue;
    }
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }
  return null;
}

function axisRange(range?: unknown[]): [number, number] | null {
  if (!range || range.length < 2) {
    return null;
  }

  const start = numericValue(range[0]);
  const end = numericValue(range[1]);
  if (start === null || end === null) {
    return null;
  }

  return start <= end ? [start, end] : [end, start];
}

export function plotlyXRange(graph: PlotlyLikeGraph): [number, number] | null {
  return axisRange(graph._fullLayout?.xaxis?.range);
}

function inRange(value: unknown, range: [number, number] | null): boolean {
  if (!range) {
    return true;
  }
  const numeric = numericValue(value);
  return numeric === null || (numeric >= range[0] && numeric <= range[1]);
}

function displayedRows(graph: PlotlyLikeGraph): string[][] {
  const xRange = axisRange(graph._fullLayout?.xaxis?.range);
  const rows: string[][] = [['trace', 'type', 'point', 'x', 'y', 'z', 'customdata']];

  graph.data?.forEach((trace, traceIndex) => {
    if (trace.visible === false || trace.visible === 'legendonly') {
      return;
    }

    const traceName = trace.name || `trace_${traceIndex + 1}`;
    const traceType = trace.type || 'scatter';
    const xValues = toArray(trace.x);
    const yValues = toArray(trace.y);
    const zValues = toArray(trace.z);
    const customValues = toArray(trace.customdata);

    if (traceType === 'heatmap' && zValues.length > 0) {
      zValues.forEach((rowValue, rowIndex) => {
        const zRow = toArray(rowValue);
        zRow.forEach((zValue, colIndex) => {
          const xValue = xValues[colIndex] ?? colIndex;
          const yValue = yValues[rowIndex] ?? rowIndex;
          if (!inRange(xValue, xRange)) {
            return;
          }
          rows.push([traceName, traceType, `${rowIndex}:${colIndex}`, xValue, yValue, zValue, ''].map(csvCell));
        });
      });
      return;
    }

    const pointCount = Math.max(xValues.length, yValues.length, zValues.length, customValues.length);
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
      const xValue = xValues[pointIndex] ?? pointIndex;
      const yValue = yValues[pointIndex] ?? '';
      if (!inRange(xValue, xRange)) {
        continue;
      }
      rows.push([
        traceName,
        traceType,
        pointIndex,
        xValue,
        yValue,
        zValues[pointIndex] ?? '',
        customValues[pointIndex] ?? '',
      ].map(csvCell));
    }
  });

  return rows;
}

export function csvRowsToText(rows: CsvRow[]): string {
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

export function buildSelectedSeriesCsvRows(
  data: TimeSampleForCsv[],
  selectedSeries: WideCsvSeries[],
  xRange: [number, number] | null
): CsvRow[] {
  const rows: CsvRow[] = [
    [
      'date',
      ...selectedSeries.flatMap(series => [
        `${series.label} normalized`,
        `${series.label} raw`,
      ]),
    ],
  ];

  data.forEach((sample, index) => {
    const timestamp = new Date(sample.t).getTime();
    if (xRange && (timestamp < xRange[0] || timestamp > xRange[1])) {
      return;
    }

    rows.push([
      sample.t,
      ...selectedSeries.flatMap(series => [
        series.normalized[index] ?? '',
        series.raw[index] ?? '',
      ]),
    ]);
  });

  return rows;
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function createCsvExportConfig(
  filename: string,
  config: Record<string, unknown> = {},
  getRows?: (graphDiv: PlotlyLikeGraph) => CsvRow[]
): any {
  return {
    ...config,
    modeBarButtonsToAdd: [
      ...((config.modeBarButtonsToAdd as any[]) ?? []),
      {
        name: 'Download CSV',
        title: 'Download displayed data as CSV',
        icon: csvIcon,
        click: (graphDiv: PlotlyLikeGraph) => {
          const rows = getRows ? getRows(graphDiv) : displayedRows(graphDiv);
          downloadCsv(filename, csvRowsToText(rows));
        },
      },
    ],
  };
}
