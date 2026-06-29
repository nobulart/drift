import { noStoreJson, readPipelineJson } from '@/lib/serverData';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const eopData = await readPipelineJson<any[]>('eop_historic.json');
    const graceData = await readPipelineJson<any[]>('grace_historic.json');
    
    const eopMap: { [key: string]: { xp: number; yp: number } } = {};
    eopData.forEach((d: any) => {
      eopMap[d.t] = { xp: d.xp, yp: d.yp };
    });
    
    const graceMap: { [key: string]: { lwe_mean: number; lwe_std: number } } = {};
    graceData.forEach((d: any) => {
      graceMap[d.t] = { lwe_mean: d.lwe_mean, lwe_std: d.lwe_std };
    });
    
    const combinedData = eopData.map((d: any) => {
      const point: any = {
        t: d.t,
        xp: d.xp,
        yp: d.yp
      };
      if (d.source_eop !== undefined) {
        point.source_eop = d.source_eop;
      }
      
      if (graceMap[d.t]) {
        point.grace_lwe_mean = graceMap[d.t].lwe_mean;
        point.grace_lwe_std = graceMap[d.t].lwe_std;
      }
      
      return point;
    });
    
    return noStoreJson(combinedData);
  } catch (error) {
    console.error('Error fetching combined data:', error);
    return noStoreJson({ error: 'Failed to fetch combined data' }, { status: 500 });
  }
}
