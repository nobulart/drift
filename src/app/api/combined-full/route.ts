import { NextResponse } from 'next/server';
import { readPipelineJson } from '@/lib/serverData';

export async function GET() {
  try {
    const data = await readPipelineJson<any[]>('combined_historic.json');
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching combined-full data:', error);
    return NextResponse.json({ error: 'Failed to fetch combined-full data' }, { status: 500 });
  }
}
