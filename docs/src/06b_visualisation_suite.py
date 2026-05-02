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
# 11. XY PHASE DENSITY + PCA
# =========================================================
def plot_xy_density_pca():
    df = pd.read_csv("filtered_series.csv")

    x = df["x_filt"].values - np.mean(df["x_filt"].values)
    y = df["y_filt"].values - np.mean(df["y_filt"].values)

    C = np.cov(x, y)
    vals, vecs = np.linalg.eigh(C)
    vecs = vecs[:, np.argsort(vals)[::-1]]

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
# 12. RESIDUAL PHASE SPACE (FINAL FORM)
# =========================================================
def compute_residual_phase():
    df = res.dropna(subset=["x_res", "y_res", "date"]).copy()
    df = df.sort_values("date")

    dt = df["date"].diff().dt.total_seconds().fillna(0)

    vx = df["x_res"] / (365.25 * 24 * 3600)
    vy = df["y_res"] / (365.25 * 24 * 3600)

    from scipy.signal import detrend
    vx = detrend(vx)
    vy = detrend(vy)

    df["x_res_pos"] = np.cumsum(vx * dt)
    df["y_res_pos"] = np.cumsum(vy * dt)

    df["year"] = df["date"].dt.year + df["date"].dt.dayofyear / 365.25

    return df, dt


def plot_residual_phase_xy_time(df):
    # =====================================================
    # CENTROID
    # =====================================================
    window = 365

    cx = df["x_res_pos"].rolling(window, center=True).mean()
    cy = df["y_res_pos"].rolling(window, center=True).mean()

    valid = (~cx.isna()) & (~cy.isna())
    cxv, cyv = cx[valid].values, cy[valid].values

    # =====================================================
    # PCA (DRIFT AXIS)
    # =====================================================
    C = np.cov(cxv, cyv)
    vals, vecs = np.linalg.eigh(C)
    vecs = vecs[:, np.argsort(vals)[::-1]]

    v = vecs[:, 0]
    angle_deg = np.degrees(np.arctan2(v[1], v[0]))

    print(f"[Drift Axis] Angle (deg): {angle_deg:.2f}")
    print(f"[Axis Vector] {v}")

    scale = np.max(np.abs(df[["x_res_pos", "y_res_pos"]].values)) * 0.5

    # =====================================================
    # 1. RAW
    # =====================================================
    plt.figure(figsize=(6,6))
    sc = plt.scatter(df["x_res_pos"], df["y_res_pos"], c=df["year"], s=5)
    plt.colorbar(sc, label="Calendar year")
    plt.xlabel("x_res (mas)")
    plt.ylabel("y_res (mas)")
    plt.title("Residual Phase Space (XY)")
    plt.axis("equal")
    plt.grid()
    plt.savefig("fig_12a_residual_path.png", dpi=300)
    plt.close()

    # =====================================================
    # 2. STRUCTURE
    # =====================================================
    plt.figure(figsize=(6,6))
    plt.plot(cxv, cyv, color="black", linewidth=2, label="Centroid")

    plt.quiver(
        0, 0, v[0], v[1],
        scale=1/scale,
        color="red",
        width=0.01,
        label=f"Axis ({angle_deg:.1f}°)"
    )

    plt.legend()
    plt.axis("equal")
    plt.grid()
    plt.title("Residual Drift Structure")
    plt.savefig("fig_12b_residual_structure.png", dpi=300)
    plt.close()

    # =====================================================
    # 3. COMBINED
    # =====================================================
    plt.figure(figsize=(6,6))
    sc = plt.scatter(df["x_res_pos"], df["y_res_pos"], c=df["year"], s=5, alpha=0.7)

    plt.plot(cxv, cyv, color="black", linewidth=2, label="Centroid")

    plt.quiver(
        0, 0, v[0], v[1],
        scale=1/scale,
        color="red",
        width=0.01,
        label=f"Axis ({angle_deg:.1f}°)"
    )

    plt.colorbar(sc, label="Calendar year")
    plt.legend()
    plt.axis("equal")
    plt.grid()
    plt.title("Residual Polar Motion Phase Space (XY)")
    plt.savefig("fig_12c_residual_combined.png", dpi=300)
    plt.close()

    return df


# # =========================================================
# 13. ENHANCED SPECTRAL DIAGNOSTIC
# =========================================================
def plot_residual_spectrum(df, dt):
    from scipy.signal import periodogram, find_peaks

    dt_mean = np.median(dt[dt > 0])
    fs = 1 / dt_mean

    # Compute spectrum
    f, Pxx = periodogram(df["x_res_pos"].dropna(), fs=fs)

    # Remove zero frequency
    f = f[1:]
    Pxx = Pxx[1:]

    # Convert to period (years)
    period = 1 / f / (365.25 * 24 * 3600)

    # Sort by period (ascending for plotting)
    idx = np.argsort(period)
    period = period[idx]
    Pxx = Pxx[idx]

    # Normalize for readability
    Pxx_norm = Pxx / np.max(Pxx)

    # Find peaks
    peaks, _ = find_peaks(Pxx_norm, height=0.1)

    # =====================================================
    # MAIN PLOT (LOG SCALE)
    # =====================================================
    plt.figure(figsize=(8,6))

    plt.plot(period, Pxx_norm)

    plt.yscale("log")
    plt.xlim(0, 5)

    # Reference lines
    plt.axvline(1.0, linestyle="--", label="Annual (1 yr)")
    plt.axvline(1.19, linestyle="--", label="Chandler (~1.19 yr)")

    # Mark peaks
    plt.scatter(period[peaks], Pxx_norm[peaks], zorder=3)

    for p in peaks:
        plt.text(period[p], Pxx_norm[p]*1.2, f"{period[p]:.2f}", fontsize=8)

    plt.xlabel("Period (years)")
    plt.ylabel("Normalized Power (log scale)")
    plt.title("Residual Spectrum (Enhanced)")
    plt.legend()
    plt.grid()

    plt.savefig("fig_13_residual_spectrum.png", dpi=300)
    plt.close()

    # =====================================================
    # ZOOMED VIEW (0.5–2.5 years)
    # =====================================================
    mask = (period > 0.5) & (period < 2.5)

    plt.figure(figsize=(8,5))
    plt.plot(period[mask], Pxx_norm[mask])

    plt.axvline(1.0, linestyle="--")
    plt.axvline(1.19, linestyle="--")

    plt.xlabel("Period (years)")
    plt.ylabel("Normalized Power")
    plt.title("Residual Spectrum (Zoom: Annual + Chandler)")
    plt.grid()

    plt.savefig("fig_13b_residual_spectrum_zoom.png", dpi=300)
    plt.close()

# =========================================================
# 14. PHASE VELOCITY FIELD (CONSISTENT WITH PHASE SPACE)
# =========================================================
def plot_phase_velocity_field(df):
    import numpy as np
    import matplotlib.pyplot as plt
    from scipy.ndimage import gaussian_filter1d

    df = df.dropna(subset=["x_res_pos", "y_res_pos", "date"]).copy()
    df = df.sort_values("date")

    # -----------------------------------------------------
    # Time step (seconds)
    # -----------------------------------------------------
    dt = df["date"].diff().dt.total_seconds().to_numpy(copy=True)

    dt[dt <= 0] = np.nan
    dt = np.nan_to_num(dt, nan=np.nanmedian(dt))

    # -----------------------------------------------------
    # Velocity (finite difference)
    # -----------------------------------------------------
    # -----------------------------------------------------
    # Robust finite difference (forward difference)
    # -----------------------------------------------------
    x = df["x_res_pos"].values
    y = df["y_res_pos"].values

    dx = np.diff(x)
    dy = np.diff(y)
    dt_safe = dt[1:]  # align with diff

    # Prevent division issues
    dt_safe[dt_safe <= 0] = np.nanmedian(dt_safe[dt_safe > 0])

    vx = dx / dt_safe
    vy = dy / dt_safe

    # Pad to original length
    vx = np.concatenate([[vx[0]], vx])
    vy = np.concatenate([[vy[0]], vy])

    # -----------------------------------------------------
    # Smooth (remove noise, preserve structure)
    # -----------------------------------------------------
    vx = gaussian_filter1d(vx, sigma=2)
    vy = gaussian_filter1d(vy, sigma=2)

    # -----------------------------------------------------
    # Subsample for clarity
    # -----------------------------------------------------
    step = max(1, len(df) // 400)

    x = df["x_res_pos"].values[::step]
    y = df["y_res_pos"].values[::step]
    vx = vx[::step]
    vy = vy[::step]

    # -----------------------------------------------------
    # Magnitude (for coloring)
    # -----------------------------------------------------
    mag = np.sqrt(vx**2 + vy**2)
    mag_norm = mag / np.max(mag)

    # -----------------------------------------------------
    # Drift axis (PCA on full trajectory)
    # -----------------------------------------------------
    C = np.cov(df["x_res_pos"], df["y_res_pos"])
    vals, vecs = np.linalg.eigh(C)
    vecs = vecs[:, np.argsort(vals)[::-1]]
    v = vecs[:, 0]

    # -----------------------------------------------------
    # Plot
    # -----------------------------------------------------
    plt.figure(figsize=(7,7))

    # Background trajectory
    plt.plot(df["x_res_pos"], df["y_res_pos"], alpha=0.15)

    # Velocity field (colored by magnitude)
    q = plt.quiver(
        x, y,
        vx, vy,
        mag_norm,
        angles='xy',
        scale_units='xy',
        scale=50,
        width=0.003
    )

    plt.colorbar(q, label="Normalized velocity magnitude")

    # Drift axis
    L = np.max(np.abs(df[["x_res_pos", "y_res_pos"]].values))
    plt.plot(
        [-L*v[0], L*v[0]],
        [-L*v[1], L*v[1]],
        linewidth=2,
        label="Drift axis"
    )

    plt.xlabel("x_res (mas)")
    plt.ylabel("y_res (mas)")
    plt.title("Phase Velocity Field (Residual Polar Motion)")

    plt.axis("equal")
    plt.grid()

    plt.savefig("fig_14_phase_velocity_field.png", dpi=300)
    plt.close()


# =========================================================
# 15. LOOP CENTER TRACKING (GEOMETRIC LOW-FREQ DIAGNOSTIC)
# =========================================================
def plot_loop_centers(df):
    import numpy as np
    import matplotlib.pyplot as plt
    from scipy.signal import find_peaks

    df = df.copy().dropna(subset=["x_res_pos", "y_res_pos", "date"])
    df = df.sort_values("date")

    x = df["x_res_pos"].values
    y = df["y_res_pos"].values

    # -----------------------------------------------------
    # Radius from origin (phase-space distance)
    # -----------------------------------------------------
    r = np.sqrt(x**2 + y**2)

    # -----------------------------------------------------
    # Detect loop boundaries via peaks in radius
    # (Chandler-scale loops)
    # -----------------------------------------------------
    peaks, _ = find_peaks(
        r,
        distance=200,      # ~1 year spacing (tune if needed)
        prominence=np.std(r) * 0.2
    )

    # -----------------------------------------------------
    # Estimate loop centers (mean within each segment)
    # -----------------------------------------------------
    centers_x = []
    centers_y = []
    centers_t = []

    for i in range(len(peaks) - 1):
        i0 = peaks[i]
        i1 = peaks[i+1]

        seg_x = x[i0:i1]
        seg_y = y[i0:i1]

        if len(seg_x) < 10:
            continue

        centers_x.append(np.mean(seg_x))
        centers_y.append(np.mean(seg_y))
        centers_t.append(df["date"].iloc[i0])

    centers_x = np.array(centers_x)
    centers_y = np.array(centers_y)
    centers_t = np.array(centers_t)

    # -----------------------------------------------------
    # Plot 1: centers in phase space
    # -----------------------------------------------------
    plt.figure(figsize=(6,6))

    # background trajectory
    plt.plot(x, y, alpha=0.1)

    # centers
    plt.scatter(centers_x, centers_y, c=np.arange(len(centers_x)), s=40)

    # connect centers
    plt.plot(centers_x, centers_y, linewidth=2)

    plt.xlabel("x_res (mas)")
    plt.ylabel("y_res (mas)")
    plt.title("Loop Center Trajectory")

    plt.axis("equal")
    plt.grid()

    plt.savefig("fig_15_loop_centers.png", dpi=300)
    plt.close()

    # -----------------------------------------------------
    # Compute angular evolution
    # -----------------------------------------------------
    theta = np.unwrap(np.arctan2(centers_y, centers_x))

    # Convert time to fractional years
    years = np.array([
        t.year + t.dayofyear / 365.25 for t in centers_t
    ])

    # -----------------------------------------------------
    # Plot 2: angle vs time
    # -----------------------------------------------------
    plt.figure(figsize=(8,5))
    plt.plot(years, theta)

    plt.xlabel("Year")
    plt.ylabel("Angle (radians)")
    plt.title("Loop Center Angular Evolution")

    plt.grid()

    plt.savefig("fig_15b_center_angle_timeseries.png", dpi=300)
    plt.close()

    # -----------------------------------------------------
    # Diagnostics
    # -----------------------------------------------------
    dtheta = theta[-1] - theta[0]

    print("\n[Loop Center Diagnostics]")
    print(f"Total angular change (rad): {dtheta:.2f}")
    print(f"Total angular change (deg): {np.degrees(dtheta):.2f}")

    if abs(dtheta) > 5:
        print("→ Indicates substantial rotation (possible long-period cycle)")
    else:
        print("→ Indicates drift without full rotation")

    return centers_x, centers_y, theta, years

# =========================================================
# 16. ANGULAR VELOCITY ω(t) — ROBUST + PUBLICATION GRADE
# =========================================================
def plot_angular_velocity(theta, years):
    import numpy as np
    import matplotlib.pyplot as plt
    from scipy.signal import savgol_filter

    years = np.asarray(years)
    theta = np.asarray(theta)

    # -----------------------------------------------------
    # Sort
    # -----------------------------------------------------
    order = np.argsort(years)
    years = years[order]
    theta = theta[order]

    # -----------------------------------------------------
    # Finite difference (robust)
    # -----------------------------------------------------
    dt = np.diff(years)
    dtheta = np.diff(theta)

    dt[dt <= 0] = np.nanmedian(dt[dt > 0])

    omega_raw = dtheta / dt
    t_mid = 0.5 * (years[:-1] + years[1:])

    # -----------------------------------------------------
    # Savitzky–Golay smoothing (adaptive)
    # -----------------------------------------------------
    window = min(9, len(omega_raw)//2*2 + 1)
    if window < 5:
        window = 5

    omega_smooth = savgol_filter(omega_raw, window_length=window, polyorder=2)

    # -----------------------------------------------------
    # Robust uncertainty (MAD-based)
    # -----------------------------------------------------
    residual = omega_raw - omega_smooth

    mad = np.median(np.abs(residual - np.median(residual)))
    sigma = 1.4826 * mad  # robust std estimate

    upper = omega_smooth + 2 * sigma
    lower = omega_smooth - 2 * sigma

    # -----------------------------------------------------
    # Period (masked near zero to prevent blow-up)
    # -----------------------------------------------------
    eps = 0.02  # rad/year threshold

    period = np.full_like(omega_smooth, np.nan)
    valid = np.abs(omega_smooth) > eps

    period[valid] = 2 * np.pi / omega_smooth[valid]

    # -----------------------------------------------------
    # PLOT 1: ω(t)
    # -----------------------------------------------------
    plt.figure(figsize=(8,5))

    plt.plot(t_mid, omega_smooth, linewidth=2)
    plt.fill_between(t_mid, lower, upper, alpha=0.25)

    plt.axhline(0, linestyle="--", linewidth=1)

    plt.xlabel("Year")
    plt.ylabel("Angular velocity (rad/year)")
    plt.title("Angular Velocity of Loop-Center Evolution")

    plt.grid()

    plt.savefig("fig_16_angular_velocity.png", dpi=300)
    plt.close()

    # -----------------------------------------------------
    # PLOT 2: Period (clean, no spikes)
    # -----------------------------------------------------
    plt.figure(figsize=(8,5))

    plt.plot(t_mid, period, linewidth=2)

    plt.ylim(0, 100)
    plt.xlabel("Year")
    plt.ylabel("Implied Period (years)")
    plt.title("Implied Long-Period Timescale (Stable Regions Only)")

    plt.grid()

    plt.savefig("fig_16b_period_estimate.png", dpi=300)
    plt.close()

    # -----------------------------------------------------
    # Diagnostics
    # -----------------------------------------------------
    print("\n[Angular Velocity Diagnostics]")
    print(f"Mean ω (rad/yr): {np.nanmean(omega_smooth):.4f}")
    print(f"Median ω (rad/yr): {np.nanmedian(omega_smooth):.4f}")

    if np.nanmean(omega_smooth) != 0:
        T_mean = 2*np.pi / np.nanmean(omega_smooth)
        print(f"Implied mean period (years): {T_mean:.1f}")

    return t_mid, omega_smooth, lower, upper, period

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation
from scipy.signal import savgol_filter

# =========================================================
# 17. ANIMATION — PHASE SPACE + ANGULAR DIAGNOSTICS
# =========================================================
def animate_full_evolution(df, centers_x, centers_y, theta, years,
                          save_path="polar_motion_animation.mp4"):

    # -----------------------------------------------------
    # Prepare data
    # -----------------------------------------------------
    x = df["x_res_pos"].values
    y = df["y_res_pos"].values
    t = df["year"].values

    # Normalize frame count
    N = len(x)

    # Loop centers
    cx = np.array(centers_x)
    cy = np.array(centers_y)

    theta = np.array(theta)
    years = np.array(years)

    # Angular velocity
    dt = np.diff(years)
    dtheta = np.diff(theta)
    dt[dt <= 0] = np.nanmedian(dt[dt > 0])

    omega = dtheta / dt
    t_mid = 0.5 * (years[:-1] + years[1:])

    # Smooth
    window = min(9, len(omega)//2*2 + 1)
    if window < 5:
        window = 5
    omega_smooth = savgol_filter(omega, window, 2)

    # -----------------------------------------------------
    # Drift axis (PCA)
    # -----------------------------------------------------
    C = np.cov(x, y)
    vals, vecs = np.linalg.eigh(C)
    vecs = vecs[:, np.argsort(vals)[::-1]]
    v = vecs[:, 0]

    L = np.max(np.abs(np.vstack([x, y])))

    # -----------------------------------------------------
    # Figure layout
    # -----------------------------------------------------
    fig = plt.figure(figsize=(12, 6))

    gs = fig.add_gridspec(2, 2)

    ax_phase = fig.add_subplot(gs[:, 0])
    ax_theta = fig.add_subplot(gs[0, 1])
    ax_omega = fig.add_subplot(gs[1, 1])

    # -----------------------------------------------------
    # Phase space setup
    # -----------------------------------------------------
    ax_phase.set_xlim(np.min(x)*1.1, np.max(x)*1.1)
    ax_phase.set_ylim(np.min(y)*1.1, np.max(y)*1.1)
    ax_phase.set_title("Residual Polar Motion Phase Evolution")
    ax_phase.set_xlabel("x_res")
    ax_phase.set_ylabel("y_res")
    ax_phase.grid()
    ax_phase.set_aspect("equal")

    # Static drift axis
    ax_phase.plot([-L*v[0], L*v[0]],
                  [-L*v[1], L*v[1]],
                  color="red", linewidth=2, label="Drift Axis")

    path_line, = ax_phase.plot([], [], lw=1, alpha=0.6)
    centroid_line, = ax_phase.plot([], [], lw=2, color="black")
    point, = ax_phase.plot([], [], "o", color="blue")

    # -----------------------------------------------------
    # θ(t)
    # -----------------------------------------------------
    ax_theta.set_title("Loop Center Angle θ(t)")
    ax_theta.set_xlim(years.min(), years.max())
    ax_theta.set_ylim(np.min(theta)*1.1, np.max(theta)*1.1)
    ax_theta.grid()

    theta_line, = ax_theta.plot([], [], lw=2)
    theta_point, = ax_theta.plot([], [], "o")

    # -----------------------------------------------------
    # ω(t)
    # -----------------------------------------------------
    ax_omega.set_title("Angular Velocity ω(t)")
    ax_omega.set_xlim(t_mid.min(), t_mid.max())
    ax_omega.set_ylim(np.min(omega_smooth)*1.2, np.max(omega_smooth)*1.2)
    ax_omega.axhline(0, linestyle="--", linewidth=1)
    ax_omega.grid()

    omega_line, = ax_omega.plot([], [], lw=2)
    omega_point, = ax_omega.plot([], [], "o")

    # -----------------------------------------------------
    # Frame update
    # -----------------------------------------------------
    def update(frame):

        frame = min(frame, len(x)-1)

        # trajectory
        path_line.set_data(x[:frame], y[:frame])
        point.set_data([x[frame]], [y[frame]])

        # centroid
        window = 365
        i0 = max(0, frame - window)
        cx = np.mean(x[i0:frame])
        cy = np.mean(y[i0:frame])
        centroid_line.set_data([cx], [cy])

        # theta
        idx_theta = np.searchsorted(years, t[frame], side="right")
        theta_line.set_data(years[:idx_theta], theta[:idx_theta])
        if idx_theta > 0:
            theta_point.set_data([years[idx_theta-1]], [theta[idx_theta-1]])

        # omega
        idx_omega = np.searchsorted(t_mid, t[frame], side="right")
        omega_line.set_data(t_mid[:idx_omega], omega_smooth[:idx_omega])
        if idx_omega > 0:
            omega_point.set_data([t_mid[idx_omega-1]], [omega_smooth[idx_omega-1]])

        return (
            path_line, centroid_line, point,
            theta_line, theta_point,
            omega_line, omega_point
        )

    # -----------------------------------------------------
    # Animate
    # -----------------------------------------------------
    anim = FuncAnimation(
        fig,
        update,
        frames=N,
        interval=30,
        blit=True
    )

    # Save (ffmpeg required)
    anim.save(save_path, dpi=200, fps=30)

    print(f"Animation saved → {save_path}")


# =========================================================
# RUN
# =========================================================
if __name__ == "__main__":
    print("Columns check:")
    print("mode:", mode.columns.tolist())
    print("time:", time.columns.tolist())
    print("state:", state.columns.tolist())

    plot_xy_density_pca()

    df_res, dt = compute_residual_phase()
    df_res = plot_residual_phase_xy_time(df_res)

    plot_residual_spectrum(df_res, dt)

    # FIX: pass df_res (NOT res)
    plot_phase_velocity_field(df_res)

    plot_loop_centers(df_res)

    centers_x, centers_y, theta, years = plot_loop_centers(df_res)

    plot_angular_velocity(theta, years)

    print("\nAll figures generated successfully.")

    centers_x, centers_y, theta, years = plot_loop_centers(df_res)

    plot_angular_velocity(theta, years)

    animate_full_evolution(
        df_res,
        centers_x,
        centers_y,
        theta,
        years,
        save_path="polar_motion_full.mp4"
    )