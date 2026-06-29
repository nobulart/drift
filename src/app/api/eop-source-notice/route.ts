import { noStoreJson, readPipelineJsonCandidate } from '@/lib/serverData';

export const dynamic = 'force-dynamic';

const DEFAULT_NOTICE = {
  fallbackActive: false,
  dataset: 'finals',
  message: 'Default IERS EOP remains active.',
};

export async function GET() {
  try {
    const notice = await readPipelineJsonCandidate<any>('eop_source_notice.json');
    return noStoreJson(notice ?? DEFAULT_NOTICE);
  } catch (error) {
    console.error('Error fetching EOP source notice:', error);
    return noStoreJson(DEFAULT_NOTICE);
  }
}
