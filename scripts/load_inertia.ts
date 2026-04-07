#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const INERTIA_FILE = path.join(DATA_DIR, 'inertia_timeseries.json');

function loadInertiaData(): any[] {
  if (!fs.existsSync(INERTIA_FILE)) {
    console.error('Error: inertia_timeseries.json not found. Run scripts/build_inertia.py first.');
    process.exit(1);
  }

  const data = fs.readFileSync(INERTIA_FILE, 'utf8');
  return JSON.parse(data);
}

export { loadInertiaData };
