#!/usr/bin/env python3
"""
build_inertia.py

Emit inertia tensor eigenframes only when a real upstream source exists.
"""

import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from data_paths import write_json


def main():
    print("No real inertia tensor source is configured for this pipeline.")
    print("Writing an empty inertia series rather than synthetic eigenframes.")
    data = []

    output_file = write_json("inertia_timeseries.json", data)

    print(f"Saved {len(data)} data points to {output_file}")


if __name__ == "__main__":
    main()
