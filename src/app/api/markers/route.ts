import { noStoreJson, readPipelineJson } from '@/lib/serverData';

export async function GET() {
  try {
    const data = await readPipelineJson<unknown>('markers.json');
    return noStoreJson(data);
  } catch {
    return noStoreJson(
      { error: 'Failed to load default markers' },
      { status: 500 }
    );
  }
}
