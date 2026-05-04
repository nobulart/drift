import { noStoreJson, readPipelineJson } from '@/lib/serverData';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await readPipelineJson<any[]>('grace_historic.json');
    return noStoreJson(data);
  } catch (error) {
    console.error('Error fetching GRACE data:', error);
    return noStoreJson({ error: 'Failed to fetch GRACE data' }, { status: 500 });
  }
}
