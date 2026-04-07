"use client";

import { useEffect, useState } from 'react';

export default function GracePage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await fetch('/api/grace');
        const data = await response.json();
        setData(data);
      } catch (err) {
        console.error('Error loading GRACE data:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  if (loading) return <div className="p-4">Loading GRACE data...</div>;
  if (data.length === 0) return <div className="p-4">No GRACE data available</div>;

  return (
    <div className="p-4">
      <div className="bg-white p-4 rounded-lg shadow mb-4">
        <h1 className="text-2xl font-bold mb-2">GRACE Mass Conservation Data</h1>
        <p className="text-gray-600 mb-4">
          Liquid Water Equivalent (LWE) thickness from GRACE and GRACE-FO missions.
          Shows changes in Earth&apos;s gravity field related to water distribution.
        </p>
        
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="bg-blue-50 p-3 rounded">
            <div className="text-sm text-gray-600">Time Range</div>
            <div className="font-semibold">{data[0].t} to {data[data.length - 1].t}</div>
          </div>
          <div className="bg-green-50 p-3 rounded">
            <div className="text-sm text-gray-600">Records</div>
            <div className="font-semibold">{data.length} monthly</div>
          </div>
          <div className="bg-purple-50 p-3 rounded">
            <div className="text-sm text-gray-600">Grid Resolution</div>
            <div className="font-semibold">0.5° global</div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full bg-white border border-gray-200">
            <thead>
              <tr className="bg-gray-100">
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-left">Mean LWE (cm)</th>
                <th className="p-2 text-left">Std Dev (cm)</th>
                <th className="p-2 text-left">Valid Pixels</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {data.slice(-30).map((d, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="p-2">{d.t}</td>
                  <td className="p-2">{d.lwe_mean.toFixed(2)}</td>
                  <td className="p-2">{d.lwe_std.toFixed(2)}</td>
                  <td className="p-2">{d.valid_pixels}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
