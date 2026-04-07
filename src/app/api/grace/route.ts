import { NextResponse } from 'next/server';
import { readPipelineJson } from '@/lib/serverData';

export async function GET() {
  try {
    const data = await readPipelineJson<any[]>('grace_historic.json');
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching GRACE data:', error);
    return NextResponse.json({ error: 'Failed to fetch GRACE data' }, { status: 500 });
  }
}
