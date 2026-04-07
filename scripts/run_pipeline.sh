#!/bin/bash
# DRIFT Data Pipeline Runner
# Runs the complete data retrieval and ingestion pipeline

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check Python availability
if ! command -v python3 &> /dev/null; then
    log_error "python3 is required but not installed"
    exit 1
fi

# Check required Python packages
log_info "Checking Python dependencies..."
python3 -c "import numpy, scipy, pandas, json" 2>/dev/null || {
    log_warn "Some Python packages may be missing. Installing..."
    pip install numpy scipy pandas -q
}

# Step 1: Fetch latest data
log_info "Step 1/6: Fetching latest data..."
python3 scripts/fetch_latest.py
log_info "Downloaded: eop_latest.json, grace_latest.json, geomag_gfz_latest.json, combined_latest.json"

# Step 2: Process EOP data
log_info "Step 2/6: Processing EOP data..."
python3 scripts/build_eop.py
log_info "Created: eop_historic.json"

# Step 3: Process GFZ-KP geomagnetic data
log_info "Step 3/6: Processing GFZ-KP geomagnetic data..."
python3 scripts/build_geomag_gfz.py
log_info "Created: geomag_gfz_kp.json"

# Step 4: Process GRACE data
log_info "Step 4/6: Processing GRACE data..."
python3 scripts/build_grace.py
log_info "Created: grace_historic.json"

# Step 5: Process inertia data
log_info "Step 5/6: Processing inertia data..."
python3 scripts/build_inertia.py
log_info "Created: inertia_timeseries.json"

# Step 6: Combine all data
log_info "Step 6/6: Combining all data..."
python3 scripts/combine_data.py
log_info "Created: combined_historic.json"

# Compute rolling statistics (optional)
if [ "${1:-}" = "--compute-stats" ] || [ "${COMPUTE_STATS:-}" = "1" ]; then
    log_info "Computing rolling statistics..."
    python3 scripts/compute_rolling_stats.py \
        -i data/eop_historic.json \
        -o data/rolling_stats.json \
        --window-size "${WINDOW_SIZE:-365}" \
        --turn-threshold "${TURN_THRESHOLD:-0.05}"
    log_info "Created: rolling_stats.json"
else
    log_warn "Skipping rolling statistics computation (use --compute-stats to enable)"
fi

echo ""
echo "======================================"
log_info "Pipeline completed successfully!"
echo "======================================"
echo ""
echo "Data files created:"
ls -lh data/*.json 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
echo ""
echo "Next steps:"
echo "  1. Run 'npm run build' to rebuild the frontend"
echo "  2. Run 'npm run dev' to start the development server"
echo "  3. Verify data appears correctly in the dashboard"
