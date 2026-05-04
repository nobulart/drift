import { noStoreJson, readPipelineJson } from '@/lib/serverData';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await readPipelineJson<any[]>('combined_historic.json');
    return noStoreJson(data);
  } catch (error) {
    console.error('Error fetching combined-full data:', error);
    return noStoreJson({ error: 'Failed to fetch combined-full data' }, { status: 500 });
  }
}
