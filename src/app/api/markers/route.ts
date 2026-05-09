import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
};

export async function GET() {
  try {
    const markerPath = path.join(process.cwd(), 'data', 'markers.json');
    const data = JSON.parse(await fs.readFile(markerPath, 'utf8')) as unknown;

    return NextResponse.json(data, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json(
      { error: 'Failed to load default markers' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
