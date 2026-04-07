import { NextResponse } from 'next/server';
import { normalizeGeomagRecords } from '@/lib/geomag';
import { readPipelineJson } from '@/lib/serverData';

export async function GET() {
  try {
    const data = normalizeGeomagRecords(await readPipelineJson<any[]>('geomag_gfz_kp.json'));
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching GFZ-KP data:', error);
    return NextResponse.json({ error: 'Failed to fetch GFZ-KP data' }, { status: 500 });
  }
}
