#!/usr/bin/env python3
"""Shared helpers for pipeline output paths."""

from __future__ import annotations

import json
import gzip
import os
import shutil
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
PUBLIC_DATA_DIR = PROJECT_ROOT / "public" / "data"


def ensure_data_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_DATA_DIR.mkdir(parents=True, exist_ok=True)


def write_json(
    filename: str,
    data: Any,
    *,
    mirror_to_public: bool = True,
    compact: bool = False,
) -> Path:
    """Write a JSON payload into data/ and optionally mirror it to public/data/."""
    ensure_data_dirs()

    output_path = DATA_DIR / filename
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        if compact:
            json.dump(data, handle, separators=(",", ":"))
        else:
            json.dump(data, handle, indent=2)

    if mirror_to_public:
        public_path = PUBLIC_DATA_DIR / filename
        public_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(output_path, public_path)

    return output_path


def read_json(filename: str) -> Any:
    """Read a JSON payload from data/, falling back to public/data/ and .gz siblings."""
    ensure_data_dirs()

    for base_dir in (DATA_DIR, PUBLIC_DATA_DIR):
        candidate = base_dir / filename
        if candidate.exists():
            with candidate.open("r", encoding="utf-8") as handle:
                return json.load(handle)

        compressed_candidate = candidate.with_suffix(candidate.suffix + ".gz")
        if compressed_candidate.exists():
            with gzip.open(compressed_candidate, "rt", encoding="utf-8") as handle:
                return json.load(handle)

    raise FileNotFoundError(f"Could not find {filename} in data directories")
