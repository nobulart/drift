export const EOP_DATASETS = [
  {
    id: 'finals',
    label: 'finals.all (IAU1980)',
    shortLabel: 'finals.all (IAU1980)',
    filename: 'eop_historic.json',
    sourceUrl: 'https://datacenter.iers.org/versionMetadata.php?filename=latestVersionMeta/7_FINALS.ALL_IAU1980_V2013_017.txt',
    description: 'Rapid daily Bulletin A/B polar motion series, 1973 onward.',
  },
  {
    id: 'finals2000a',
    label: 'finals.all (IAU2000)',
    shortLabel: 'finals.all (IAU2000)',
    filename: 'eop_finals2000a_historic.json',
    sourceUrl: 'https://datacenter.iers.org/versionMetadata.php?filename=latestVersionMeta/9_FINALS.ALL_IAU2000_V2013_019.txt',
    description: 'Rapid daily Bulletin A/B polar motion series using IAU2000A celestial pole offsets, 1973 onward.',
  },
  {
    id: 'c04',
    label: 'EOP 20u24 C04 (IAU2000A)',
    shortLabel: 'EOP 20u24 C04 (IAU2000A)',
    filename: 'eop_c04_historic.json',
    sourceUrl: 'https://datacenter.iers.org/versionMetadata.php?filename=latestVersionMeta/254_EOP_C04_20u24.62-NOW254.txt',
    description: 'Daily C04 20u24 IAU2000A combined EOP solution, 1962 onward.',
  },
] as const;

export type EOPDatasetId = typeof EOP_DATASETS[number]['id'];

export const DEFAULT_EOP_DATASET_ID: EOPDatasetId = 'finals';

export function getEOPDataset(datasetId: string | null | undefined) {
  return EOP_DATASETS.find((dataset) => dataset.id === datasetId) ?? EOP_DATASETS[0];
}
