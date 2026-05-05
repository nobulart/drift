import { noStoreJson, readPipelineJson } from '@/lib/serverData';
import { spawn, spawnSync } from 'child_process';
import { join } from 'path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

let pythonCommand: string | null = null;

function getPythonCommand() {
  if (pythonCommand) {
    return pythonCommand;
  }

  const candidates = [
    process.env.DRIFT_PYTHON,
    process.env.PYTHON,
    process.env.PYTHON3,
    join(process.cwd(), '.venv', 'bin', 'python'),
    join(process.env.HOME || '', '.pyenv', 'versions', '3.12.7', 'bin', 'python'),
    'python3',
    'python',
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const check = spawnSync(candidate, ['-c', 'import spiceypy'], { stdio: 'ignore' });
    if (check.status === 0) {
      pythonCommand = candidate;
      return pythonCommand;
    }
  }

  throw new Error('No Python interpreter with spiceypy is available. Set DRIFT_PYTHON to a compatible interpreter.');
}

function isDateString(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function filterRecords(data: any, start: string | null, end: string | null) {
  if (!Array.isArray(data?.records) || !start || !end) {
    return data;
  }

  const records = data.records.filter((record: any) => (
    typeof record?.t === 'string' && record.t >= start && record.t <= end
  ));

  return {
    ...data,
    source: {
      ...data.source,
      requested_start_date: start,
      requested_end_date: end,
      returned_start_date: records[0]?.t,
      returned_end_date: records[records.length - 1]?.t,
    },
    records,
  };
}

function hasCoverage(data: any, start: string | null, end: string | null) {
  if (!start || !end || !Array.isArray(data?.records) || data.records.length === 0) {
    return true;
  }

  const first = data.records[0]?.t;
  const last = data.records[data.records.length - 1]?.t;
  return typeof first === 'string' && typeof last === 'string' && first <= start && last >= end;
}

function runEphemerisBuild(start: string, end: string) {
  return new Promise<void>((resolve, reject) => {
    let command: string;
    try {
      command = getPythonCommand();
    } catch (error) {
      reject(error);
      return;
    }

    const scriptPath = join(process.cwd(), 'scripts', 'build_ephemeris.py');
    const python = spawn(command, [scriptPath, '--start', start, '--end', end, '--merge'], {
      cwd: process.cwd(),
    });

    let stderr = '';
    python.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    python.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Ephemeris build failed with code ${code}: ${stderr}`));
      }
    });
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const start = searchParams.get('start');
  const end = searchParams.get('end');

  if ((start && !isDateString(start)) || (end && !isDateString(end))) {
    return noStoreJson({ error: 'start and end must use YYYY-MM-DD format' }, { status: 400 });
  }

  if (start && end && start > end) {
    return noStoreJson({ error: 'start must be on or before end' }, { status: 400 });
  }

  try {
    let data = await readPipelineJson<any>('ephemeris_historic.json');

    if (start && end && !hasCoverage(data, start, end)) {
      await runEphemerisBuild(start, end);
      data = await readPipelineJson<any>('ephemeris_historic.json');
    }

    return noStoreJson(filterRecords(data, start, end));
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unable to locate ephemeris_historic.json')) {
      if (start && end) {
        try {
          await runEphemerisBuild(start, end);
          const data = await readPipelineJson<any>('ephemeris_historic.json');
          return noStoreJson(filterRecords(data, start, end));
        } catch (buildError) {
          console.error('Error building ephemeris data:', buildError);
        }
      }

      return noStoreJson({
        source: {
          kernel: 'de442.bsp',
          kernel_url: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de442.bsp',
          leapseconds: 'naif0012.tls',
          observer: 'EARTH',
          frame: 'ECLIPJ2000',
          aberration_correction: 'LT+S',
          bodies: [],
          metrics: [],
        },
        records: [],
      });
    }

    console.error('Error fetching ephemeris data:', error);
    return noStoreJson({ error: 'Failed to fetch ephemeris data' }, { status: 500 });
  }
}
