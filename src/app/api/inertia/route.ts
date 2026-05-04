import { noStoreJson, readPipelineJson } from '@/lib/serverData';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await readPipelineJson<any[]>('inertia_timeseries.json');
    return noStoreJson(data);
  } catch (error) {
    console.error('Error fetching inertia data:', error);
    return noStoreJson({ error: 'Failed to fetch inertia data' }, { status: 500 });
  }
}
