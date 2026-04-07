import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    const eopPath = join(process.cwd(), 'public', 'data', 'eop_historic.json');
    const gracePath = join(process.cwd(), 'public', 'data', 'grace_historic.json');
    
    const eopStr = await fs.readFile(eopPath, 'utf8');
    const eopData = JSON.parse(eopStr);
    
    const graceStr = await fs.readFile(gracePath, 'utf8');
    const graceData = JSON.parse(graceStr);
    
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
      
      if (graceMap[d.t]) {
        point.grace_lwe_mean = graceMap[d.t].lwe_mean;
        point.grace_lwe_std = graceMap[d.t].lwe_std;
      }
      
      return point;
    });
    
    return NextResponse.json(combinedData);
  } catch (error) {
    console.error('Error fetching combined data:', error);
    return NextResponse.json({ error: 'Failed to fetch combined data' }, { status: 500 });
  }
}
