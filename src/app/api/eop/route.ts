import { NextResponse } from 'next/server';
import { readPipelineJson } from '@/lib/serverData';

export async function GET() {
  try {
    const data = await readPipelineJson<any[]>('eop_historic.json');
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching EOP data:', error);
    return NextResponse.json({ error: 'Failed to fetch EOP data' }, { status: 500 });
  }
}
