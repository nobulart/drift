# DRIFT Discovery Source

This directory contains the reproducibility material behind the DRIFT design:

- exploratory and validation scripts for the polar-motion, phase-coherence, escape-rate, transition, and solar-system coupling analyses;
- input datasets used by those scripts;
- durable result tables, figures, and reports that document the discovery path.

The original top-level discovery scripts and `docs/outputs/` artifacts now live under `docs/src/` so that the docs tree keeps the whitepapers, dashboard material, source code, data, and generated results together.

Volatile local files are intentionally ignored here, including Python virtual environments, bytecode caches, macOS metadata, and LaTeX build byproducts. CSV outputs can be committed when they are below GitHub's hard file-size limit; any regenerated CSV above 100 MB should be left out of Git and placed under `docs/src/large-csv/`.
