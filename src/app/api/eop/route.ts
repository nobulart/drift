import { noStoreJson, readPipelineJson } from '@/lib/serverData';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await readPipelineJson<any[]>('eop_historic.json');
    return noStoreJson(data);
  } catch (error) {
    console.error('Error fetching EOP data:', error);
    return noStoreJson({ error: 'Failed to fetch EOP data' }, { status: 500 });
  }
}
