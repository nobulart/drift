import { spawn } from 'child_process';
import { join } from 'path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface UpdateResult {
  stdout: string;
  stderr: string;
}

let activeUpdate: Promise<UpdateResult> | null = null;
const UPDATE_TIMEOUT_MS = 15 * 60 * 1000;

function appendBounded(current: string, chunk: Buffer, maxLength = 20000) {
  const next = current + chunk.toString();
  return next.length > maxLength ? next.slice(next.length - maxLength) : next;
}

function runDataPipeline() {
  return new Promise<UpdateResult>((resolve, reject) => {
    const scriptPath = join(process.cwd(), 'scripts', 'run_pipeline.sh');
    const pipeline = spawn('bash', [scriptPath, '--compute-stats'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        COMPUTE_STATS: '1',
      },
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      pipeline.kill('SIGTERM');
      reject(new Error('Data update timed out after 15 minutes.'));
    }, UPDATE_TIMEOUT_MS);

    pipeline.stdout.on('data', (data: Buffer) => {
      stdout = appendBounded(stdout, data);
    });

    pipeline.stderr.on('data', (data: Buffer) => {
      stderr = appendBounded(stderr, data);
    });

    pipeline.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    pipeline.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`run_pipeline.sh exited with code ${code ?? 'unknown'}\n${stderr || stdout}`));
    });
  });
}

export async function POST() {
  if (activeUpdate) {
    return NextResponse.json(
      { error: 'Data update is already running.' },
      { status: 409 }
    );
  }

  activeUpdate = runDataPipeline();

  try {
    const result = await activeUpdate;
    return NextResponse.json({
      ok: true,
      completedAt: new Date().toISOString(),
      stdout: result.stdout,
      stderr: result.stderr,
    });
  } catch (error) {
    console.error('Data update failed:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Data update failed.',
      },
      { status: 500 }
    );
  } finally {
    activeUpdate = null;
  }
}
