#!/usr/bin/env python3
"""
Ensure required pipeline outputs exist and are fresh before the web server starts.
"""

from __future__ import annotations

import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
REQUIRED_OUTPUTS = [
    PROJECT_ROOT / "data" / "eop_historic.json",
    PROJECT_ROOT / "data" / "geomag_gfz_kp.json",
    PROJECT_ROOT / "data" / "grace_historic.json",
    PROJECT_ROOT / "data" / "inertia_timeseries.json",
    PROJECT_ROOT / "data" / "ephemeris_historic.json",
    PROJECT_ROOT / "data" / "combined_historic.json",
    PROJECT_ROOT / "data" / "rolling_stats.json",
]


def start_of_utc_day() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def get_refresh_reason() -> str | None:
    oldest_mtime: datetime | None = None

    for output_path in REQUIRED_OUTPUTS:
        if not output_path.exists() and not output_path.with_suffix(output_path.suffix + ".gz").exists():
            return f"missing output: {output_path.name}"

        if output_path.name == "ephemeris_historic.json":
            continue

        existing_path = output_path if output_path.exists() else output_path.with_suffix(output_path.suffix + ".gz")
        mtime = datetime.fromtimestamp(existing_path.stat().st_mtime, tz=timezone.utc)
        if oldest_mtime is None or mtime < oldest_mtime:
            oldest_mtime = mtime

    if oldest_mtime is None:
        return "pipeline outputs could not be dated"

    if oldest_mtime < start_of_utc_day():
        return "pipeline outputs are older than today"

    return None


def main() -> int:
    reason = get_refresh_reason()
    if reason is None:
        print("[startup] Pipeline outputs are current; skipping refresh.")
        return 0

    print(f"[startup] Refresh required: {reason}")
    try:
        subprocess.run(
            ["bash", "scripts/run_pipeline.sh", "--compute-stats"],
            cwd=PROJECT_ROOT,
            check=True,
        )
    except subprocess.CalledProcessError as exc:
        print(f"[startup] Pipeline refresh failed with exit code {exc.returncode}", file=sys.stderr)
        return exc.returncode

    final_reason = get_refresh_reason()
    if final_reason is not None:
        print(f"[startup] Pipeline refresh completed but outputs are still stale: {final_reason}", file=sys.stderr)
        return 1

    print("[startup] Pipeline outputs refreshed successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
