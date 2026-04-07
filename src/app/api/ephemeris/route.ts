import { NextResponse } from 'next/server';
import { readPipelineJson } from '@/lib/serverData';

export async function GET() {
  try {
    const data = await readPipelineJson<any>('ephemeris_historic.json');
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unable to locate ephemeris_historic.json')) {
      return NextResponse.json({
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
    return NextResponse.json({ error: 'Failed to fetch ephemeris data' }, { status: 500 });
  }
}
