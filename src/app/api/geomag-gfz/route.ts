import { normalizeGeomagRecords } from '@/lib/geomag';
import { noStoreJson, readPipelineJson } from '@/lib/serverData';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = normalizeGeomagRecords(await readPipelineJson<any[]>('geomag_gfz_kp.json'));
    return noStoreJson(data);
  } catch (error) {
    console.error('Error fetching GFZ-KP data:', error);
    return noStoreJson({ error: 'Failed to fetch GFZ-KP data' }, { status: 500 });
  }
}
