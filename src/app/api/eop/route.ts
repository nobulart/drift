import { noStoreJson, readPipelineJson } from '@/lib/serverData';
import { getEOPDataset } from '@/lib/eopDatasets';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const dataset = getEOPDataset(searchParams.get('dataset'));
    const data = await readPipelineJson<any[]>(dataset.filename);
    return noStoreJson(data, {
      headers: {
        'X-DRIFT-EOP-Dataset': dataset.id,
      },
    });
  } catch (error) {
    console.error('Error fetching EOP data:', error);
    return noStoreJson({ error: 'Failed to fetch EOP data' }, { status: 500 });
  }
}
