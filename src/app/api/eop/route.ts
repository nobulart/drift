import { noStoreJson, readPipelineJson, readPipelineJsonCandidate } from '@/lib/serverData';
import { getEOPDataset } from '@/lib/eopDatasets';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const dataset = getEOPDataset(searchParams.get('dataset'));
    const [data, sourceNotice] = await Promise.all([
      readPipelineJson<any[]>(dataset.filename),
      readPipelineJsonCandidate<any>('eop_source_notice.json'),
    ]);
    const fallbackActive = dataset.id === 'finals' && sourceNotice?.fallbackActive;
    return noStoreJson(data, {
      headers: {
        'X-DRIFT-EOP-Dataset': dataset.id,
        ...(fallbackActive ? {
          'X-DRIFT-EOP-Fallback': String(sourceNotice.fallbackDataset || sourceNotice.dataset || 'jpl'),
          'X-DRIFT-EOP-Notice': String(sourceNotice.message || 'Using fallback EOP source.'),
        } : {}),
      },
    });
  } catch (error) {
    console.error('Error fetching EOP data:', error);
    return noStoreJson({ error: 'Failed to fetch EOP data' }, { status: 500 });
  }
}
