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
const UPDATE_TIMEOUT_MS = 5 * 60 * 1000;

function appendBounded(current: string, chunk: Buffer, maxLength = 20000) {
  const next = current + chunk.toString();
  return next.length > maxLength ? next.slice(next.length - maxLength) : next;
}

function runFetchLatest() {
  return new Promise<UpdateResult>((resolve, reject) => {
    const scriptPath = join(process.cwd(), 'scripts', 'fetch_latest.py');
    const python = spawn('python3', [scriptPath], {
      cwd: process.cwd(),
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      python.kill('SIGTERM');
      reject(new Error('Data update timed out after 5 minutes.'));
    }, UPDATE_TIMEOUT_MS);

    python.stdout.on('data', (data: Buffer) => {
      stdout = appendBounded(stdout, data);
    });

    python.stderr.on('data', (data: Buffer) => {
      stderr = appendBounded(stderr, data);
    });

    python.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    python.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`fetch_latest.py exited with code ${code ?? 'unknown'}\n${stderr || stdout}`));
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

  activeUpdate = runFetchLatest();

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
