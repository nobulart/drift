import { noStoreJson, readPipelineJson } from '@/lib/serverData';
import { requireApiAuth } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authResponse = requireApiAuth(request);
  if (authResponse) {
    return authResponse;
  }

  try {
    const data = await readPipelineJson<any[]>('combined_historic.json');
    return noStoreJson(data);
  } catch (error) {
    console.error('Error fetching combined-full data:', error);
    return noStoreJson({ error: 'Failed to fetch combined-full data' }, { status: 500 });
  }
}
