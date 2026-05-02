import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns

# =========================================================
# LOAD DATA
# =========================================================
inst = pd.read_csv("instantaneous_velocity.csv", parse_dates=["date"])
res  = pd.read_csv("residual_velocity.csv", parse_dates=["date"])
mode = pd.read_csv("mode_projection_analysis_filtered.csv", parse_dates=["date"])
time = pd.read_csv("time_window_mode_tracking.csv", parse_dates=["date"])
state = pd.read_csv("state_transition_analysis.csv", parse_dates=["date"])

# =========================================================
# SETTINGS
# =========================================================
plt.rcParams["figure.figsize"] = (10, 6)
plt.rcParams["font.size"] = 10

# =========================================================
# HELPERS
# =========================================================
def safe_col(df, name_list):
    for n in name_list:
        if n in df.columns:
            return df[n]
    raise KeyError(f"Missing columns: {name_list}")

# =========================================================
# 1. POLAR TRAJECTORY
# =========================================================
def plot_polar_trajectory():
    plt.figure()
    plt.plot(inst["x"], inst["y"], linewidth=0.5)
    plt.xlabel("x pole (mas)")
    plt.ylabel("y pole (mas)")
    plt.title("Polar Motion Trajectory")
    plt.axis("equal")
    plt.grid()
    plt.savefig("fig_01_polar_trajectory.png", dpi=300)
    plt.close()

# =========================================================
# 2. VELOCITY FIELD
# =========================================================
def plot_vector_field():
    df = inst.dropna(subset=["x", "y"]).iloc[::50]

    dx = np.gradient(df["x"])
    dy = np.gradient(df["y"])

    plt.figure()
    plt.quiver(df["x"], df["y"], dx, dy, scale=5000)
    plt.title("Velocity Field")
    plt.axis("equal")
    plt.grid()
    plt.savefig("fig_02_vector_field.png", dpi=300)
    plt.close()

# =========================================================
# 3. DIRECTION TIME SERIES
# =========================================================
def plot_direction_time():
    direction = safe_col(mode, ["direction_deg"])

    plt.figure()
    plt.plot(mode["date"], direction, linewidth=0.5)
    plt.ylabel("Direction (deg)")
    plt.title("Direction Evolution")
    plt.grid()
    plt.savefig("fig_03_direction_time.png", dpi=300)
    plt.close()

# =========================================================
# 4. MODE PROJECTIONS
# =========================================================
def plot_mode_projections():
    plt.figure()

    if "zach_75W_parallel" in mode:
        plt.plot(mode["date"], mode["zach_75W_parallel"], label="75W")

    if "adhikari_100W_parallel" in mode:
        plt.plot(mode["date"], mode["adhikari_100W_parallel"], label="100W")

    if "observed_326_parallel" in mode:
        plt.plot(mode["date"], mode["observed_326_parallel"], label="~45°")

    plt.legend()
    plt.ylabel("Projection (mas/yr)")
    plt.title("Mode Projections")
    plt.grid()
    plt.savefig("fig_04_mode_projections.png", dpi=300)
    plt.close()

# =========================================================
# 5. TIME WINDOW MODES
# =========================================================
def plot_time_window_modes():
    plt.figure()

    plt.plot(time["date"], time["zach_75W_parallel"], label="75W")
    plt.plot(time["date"], time["adhikari_100W_parallel"], label="100W")
    plt.plot(time["date"], time["greenland_45_parallel"], label="45°")

    plt.legend()
    plt.ylabel("Projection (mas/yr)")
    plt.title("Mode Evolution")
    plt.grid()
    plt.savefig("fig_05_time_window_modes.png", dpi=300)
    plt.close()

# =========================================================
# 6. GEOMETRIC STATE PROJECTION (REPLACES R)
# =========================================================
def plot_state_projection():
    plt.figure()

    plt.plot(state["date"], state["projection"], label="Projection", linewidth=1)

    state_scaled = (state["state"] - 0.5) * state["projection"].std() * 2
    plt.plot(state["date"], state_scaled, label="State (scaled)", alpha=0.6)

    plt.legend()
    plt.ylabel("Projection")
    plt.title("Geometric State Evolution")
    plt.grid()

    plt.savefig("fig_06_state_projection.png", dpi=300)
    plt.close()

# =========================================================
# 7. STATE TIME SERIES
# =========================================================
def plot_state_timeseries():
    plt.figure(figsize=(10,3))
    plt.step(state["date"], state["state"], where="post")

    plt.title("State Time Series (Geometric)")
    plt.yticks([0,1])
    plt.grid()

    plt.savefig("fig_07_state_timeseries.png", dpi=300)
    plt.close()

# =========================================================
# 8. PHASE SPACE (FIXED: projection vs direction)
# =========================================================
def plot_phase_space():
    merged = pd.merge(state, time, on="date")

    direction = safe_col(merged, ["mean_direction", "direction_deg"])

    plt.figure()

    plt.scatter(
        merged["projection"],
        direction,
        c=np.linspace(0, 1, len(merged)),
        s=5
    )

    plt.colorbar(label="Time progression")
    plt.xlabel("Projection")
    plt.ylabel("Direction (deg)")
    plt.title("Phase Space: Projection vs Direction")
    plt.grid()

    plt.savefig("fig_08_phase_space_projection.png", dpi=300)
    plt.close()

# =========================================================
# 9. RESIDUAL FIELD
# =========================================================
def plot_residual_field():
    df = res.dropna(subset=["x_res", "y_res"]).iloc[::50]

    dx = np.gradient(df["x_res"])
    dy = np.gradient(df["y_res"])

    plt.figure()
    plt.quiver(df["x_res"], df["y_res"], dx, dy, scale=5000)
    plt.title("Residual Field")
    plt.axis("equal")
    plt.grid()
    plt.savefig("fig_09_residual_field.png", dpi=300)
    plt.close()

# =========================================================
# 10. MAGNITUDE
# =========================================================
def plot_magnitude():
    mag = safe_col(mode, ["v_mag"])

    plt.figure()
    plt.plot(mode["date"], mag)
    plt.ylabel("|v| (mas/yr)")
    plt.title("Magnitude Evolution")
    plt.grid()
    plt.savefig("fig_10_magnitude.png", dpi=300)
    plt.close()

# =========================================================
# 11. XY PHASE DENSITY + PCA (CRITICAL FIGURE)
# =========================================================
def plot_xy_density_pca():
    df = pd.read_csv("filtered_series.csv")

    x = df["x_filt"].values
    y = df["y_filt"].values

    # mean center
    x = x - np.mean(x)
    y = y - np.mean(y)

    C = np.cov(x, y)
    vals, vecs = np.linalg.eigh(C)

    order = np.argsort(vals)[::-1]
    vecs = vecs[:, order]

    plt.figure(figsize=(6,6))
    sns.kdeplot(x=x, y=y, fill=True, levels=50)

    plt.plot(x, y, color="white", alpha=0.3, linewidth=0.5)

    for i in range(2):
        v = vecs[:, i]
        plt.quiver(0, 0, v[0], v[1], scale=3, color="red")

    plt.xlabel("x_p")
    plt.ylabel("y_p")
    plt.title("Phase Space with Principal Axes")

    plt.axis("equal")
    plt.savefig("fig_11_xy_phase_density.png", dpi=300)
    plt.close()


# =========================================================
# 12. RESIDUAL PHASE SPACE (XY + DECOMPOSED VIEWS)
# =========================================================
def plot_residual_phase_xy_time():
    df = res.dropna(subset=["x_res", "y_res", "date"]).copy()

    # Ensure sorted time
    df = df.sort_values("date")

    # Convert time to seconds
    dt = df["date"].diff().dt.total_seconds().fillna(0)

    # Convert to mas/sec (if needed)
    vx = df["x_res"] / (365.25 * 24 * 3600)
    vy = df["y_res"] / (365.25 * 24 * 3600)

    from scipy.signal import detrend

    # Remove drift / bias
    vx = detrend(vx)
    vy = detrend(vy)

    # Integrate to recover residual position
    df["x_res_pos"] = np.cumsum(vx * dt)
    df["y_res_pos"] = np.cumsum(vy * dt)

    # Time in calendar years (fractional)
    df["year"] = df["date"].dt.year + df["date"].dt.dayofyear / 365.25

    # =====================================================
    # CENTROID (SLOW MANIFOLD)
    # =====================================================
    window = 365

    cx = df["x_res_pos"].rolling(window, center=True).mean()
    cy = df["y_res_pos"].rolling(window, center=True).mean()

    valid = (~cx.isna()) & (~cy.isna())

    cxv = cx[valid].values
    cyv = cy[valid].values

    # =====================================================
    # PCA ON CENTROID PATH (DRIFT AXIS)
    # =====================================================
    C = np.cov(cxv, cyv)
    vals, vecs = np.linalg.eigh(C)

    order = np.argsort(vals)[::-1]
    vecs = vecs[:, order]

    v = vecs[:, 0]

    angle_deg = np.degrees(np.arctan2(v[1], v[0]))
    print(f"[Drift Axis] Angle (deg): {angle_deg:.2f}")

    # Scaling for axis visualization
    scale = np.max(np.abs(df[["x_res_pos", "y_res_pos"]].values)) * 0.5

    # =====================================================
    # 1. RAW RESIDUAL PATH ONLY
    # =====================================================
    plt.figure(figsize=(6,6))

    sc = plt.scatter(
        df["x_res_pos"],
        df["y_res_pos"],
        c=df["year"],
        s=5
    )

    plt.colorbar(sc, label="Calendar year")
    plt.xlabel("x_res (mas)")
    plt.ylabel("y_res (mas)")
    plt.title("Residual Phase Space (XY)")

    plt.axis("equal")
    plt.grid()

    plt.savefig("fig_12a_residual_path.png", dpi=300)
    plt.close()

    # =====================================================
    # 2. DERIVED STRUCTURE ONLY (CENTROID + AXIS)
    # =====================================================
    plt.figure(figsize=(6,6))

    plt.plot(cxv, cyv, color="black", linewidth=2, label="Centroid path")

    plt.quiver(
        0, 0,
        v[0], v[1],
        scale=1/scale,
        color="red",
        width=0.01,
        label=f"Drift axis ({angle_deg:.1f}°)"
    )

    plt.xlabel("x_res (mas)")
    plt.ylabel("y_res (mas)")
    plt.title("Residual Drift Structure")

    plt.legend()
    plt.axis("equal")
    plt.grid()

    plt.savefig("fig_12b_residual_structure.png", dpi=300)
    plt.close()

    # =====================================================
    # 3. COMBINED (FULL VIEW)
    # =====================================================
    plt.figure(figsize=(6,6))

    sc = plt.scatter(
        df["x_res_pos"],
        df["y_res_pos"],
        c=df["year"],
        s=5,
        alpha=0.7
    )

    plt.plot(cxv, cyv, color="black", linewidth=2, label="Centroid path")

    plt.quiver(
        0, 0,
        v[0], v[1],
        scale=1/scale,
        color="red",
        width=0.01,
        label=f"Drift axis ({angle_deg:.1f}°)"
    )

    plt.colorbar(sc, label="Calendar year")
    plt.xlabel("x_res (mas)")
    plt.ylabel("y_res (mas)")
    plt.title("Residual Polar Motion Phase Space (XY)")

    plt.legend()
    plt.axis("equal")
    plt.grid()

    plt.savefig("fig_12c_residual_combined.png", dpi=300)
    plt.close()

# =========================================================
# RUN
# =========================================================
if __name__ == "__main__":
    print("Columns check:")
    print("mode:", mode.columns.tolist())
    print("time:", time.columns.tolist())
    print("state:", state.columns.tolist())

    plot_polar_trajectory()
    plot_vector_field()
    plot_direction_time()
    plot_mode_projections()
    plot_time_window_modes()

    # NEW GEOMETRIC REPLACEMENTS
    plot_state_projection()
    plot_state_timeseries()
    plot_phase_space()

    plot_residual_field()
    plot_magnitude()
    plot_xy_density_pca()
    plot_residual_phase_xy_time()

    from scipy.signal import periodogram

    # use one component (x or y)
    fs = 1 / np.median(dt)  # sampling frequency (Hz)

    f, Pxx = periodogram(df["x_res_pos"].dropna(), fs=fs)

    # convert to period (years)
    period_years = 1 / f / (365.25 * 24 * 3600)

    plt.figure()
    plt.plot(period_years, Pxx)
    plt.xlim(0, 5)
    plt.xlabel("Period (years)")
    plt.ylabel("Power")
    plt.title("Residual Spectrum")
    plt.grid()


    print("\nAll figures generated successfully.")