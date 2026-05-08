# DRIFT Performance Review

Benchmark date: 2026-05-08

This note records the profiling pass that became `v1.5.5`. The focus was the DRIFT data and UI pipelines: JSON artifact handling, Next API routes, Python analysis scripts, and client fetch behavior.

## Summary

The largest bottlenecks were full-file ephemeris parsing, oversized panel payloads, repeated rolling covariance work, and stale/duplicate derived-analysis requests. The remedy added ephemeris year shards, route-level projections, in-flight compute deduping, parsed JSON reuse, compact JSON artifacts, and prefix-sum rolling covariance.

## Benchmarks

Local machine timings are wall-clock measurements from `time`, `curl -w`, and Node JSON read/parse probes. Network numbers use local `next start`; cache-hit timings can vary with whether a server process is already warm.

| Surface | Initial | v1.5.5 | Change |
| --- | ---: | ---: | --- |
| `compute_rolling_stats.py` cold script | ~4.70 s | ~2.32 s | ~51% faster |
| `/api/rolling-stats` cold full route | ~4.72 s | ~2.57 s | ~46% faster |
| `/api/rolling-stats` cached full route | ~53 ms | ~69 ms | same order; now includes script-aware invalidation |
| Conditional lag panel payload | ~6.05 MB | ~66 KB | ~99% smaller |
| `compute_phase_escape.py` cold script | ~7.79 s | ~3.43 s | ~56% faster |
| `/api/phase-escape` cold panel route | ~7.9 s | ~3.28-3.74 s | ~50% faster |
| `/api/phase-escape` cached panel route | ~74-115 ms | ~54 ms | faster and smaller |
| Phase-escape panel payload | ~14.5 MB | ~3.16 MB | ~78% smaller |
| `/api/ephemeris?start=2025-01-01&end=2025-12-31` | ~580 ms warm | ~28-46 ms repeat | one-year range no longer parses full cache |
| Full ephemeris artifact | ~231 MB | ~176 MB | ~24% smaller |
| Ephemeris full-file parse | ~394 ms | ~340-376 ms | lower fallback cost |
| Rolling stats derived cache file | ~8.7 MB | ~5.8 MB | ~33% smaller |

## Implemented Remedies

- `scripts/build_ephemeris.py` now emits compact `data/ephemeris_historic.json`, `data/ephemeris_historic.manifest.json`, and `data/ephemeris_by_year/*.json`.
- `/api/ephemeris` serves bounded date ranges from yearly shards when available.
- `scripts/compute_phase_escape.py` reads ephemeris shards for the EOP overlap window instead of parsing the full 1900-2100 cache.
- `scripts/compute_rolling_stats.py` computes rolling PCA, centers, `R(t)`, and drift-axis windows using prefix sums instead of rebuilding masks and covariance matrices for every sample.
- `/api/rolling-stats` uses file metadata for cache keys, supports `select=conditionalLagModel`, and coalesces identical in-flight computations.
- `/api/phase-escape` supports `view=panel&composite=...`, includes script metadata in cache keys, and coalesces identical in-flight computations.
- Client panels abort stale fetches when controls change quickly.
- `src/lib/serverData.ts` caches parsed pipeline JSON objects under 25 MB by `mtimeMs:size`.
- Derived Python outputs now use compact JSON separators.

## Remaining Work

- Add regression tests around the prefix-sum rolling covariance implementation.
- Add a lightweight benchmark script for route payload sizes and cold/cache timings.
- Add cache retention/cleanup for old files under `public/data/.rolling-stats-cache` and `public/data/.phase-escape-cache`.
- Consider moving large public JSON artifacts behind API-only access or to a columnar/binary format for future scale.
