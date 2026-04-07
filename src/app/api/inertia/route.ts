import { NextResponse } from 'next/server';
import { readPipelineJson } from '@/lib/serverData';

export async function GET() {
  try {
    const data = await readPipelineJson<any[]>('inertia_timeseries.json');
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching inertia data:', error);
    return NextResponse.json({ error: 'Failed to fetch inertia data' }, { status: 500 });
  }
}
