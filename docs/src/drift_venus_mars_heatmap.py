#!/usr/bin/env python3
import argparse
import json
import requests
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.dates import DateFormatter

BASE = "https://drift.nobulart.com"


def get_json(path, params=None):
    r = requests.get(f"{BASE}{path}", params=params or {}, timeout=120)
    r.raise_for_status()
    return r.json()


def normalize_datetime_ns(df):
    df = df.copy()
    df["date"] = pd.to_datetime(df["date"], errors="coerce").astype("datetime64[ns]")
    return df.dropna(subset=["date"]).sort_values("date")


def zscore(s):
    s = pd.to_numeric(s, errors="coerce")
    std = s.std(ddof=0)
    if std == 0 or np.isnan(std):
        return pd.Series(np.zeros(len(s)), index=s.index)
    return (s - s.mean()) / std


def extract_rolling(payload, start=None, end=None):
    if not isinstance(payload, dict):
        raise ValueError("rolling payload is not a dict")

    required = ["omega", "rRatio"]
    missing = [k for k in required if k not in payload]
    if missing:
        raise ValueError(f"Missing rolling keys: {missing}. Available keys: {list(payload.keys())}")

    omega = payload["omega"]
    r_ratio = payload["rRatio"]
    n = min(len(omega), len(r_ratio))

    if start is not None and end is not None:
        dates = pd.date_range(
            start=pd.to_datetime(start),
            end=pd.to_datetime(end),
            periods=n,
        )
    else:
        t = payload.get("t")
        if t is None:
            raise ValueError("No t array and no start/end supplied")
        dates = pd.to_datetime(t[:n], errors="coerce")

    df = pd.DataFrame({
        "date": dates,
        "angular_velocity": pd.to_numeric(omega[:n], errors="coerce"),
        "r_ratio": pd.to_numeric(r_ratio[:n], errors="coerce"),
    })

    return normalize_datetime_ns(df).dropna()

def extract_ephemeris(payload, debug=False):
    rows = None

    if isinstance(payload, dict):
        if "records" in payload:
            rows = payload["records"]
        elif "data" in payload:
            rows = payload["data"]
        elif "rows" in payload:
            rows = payload["rows"]
    elif isinstance(payload, list):
        rows = payload

    if not rows:
        if debug:
            print("\nEPHEMERIS PAYLOAD SAMPLE:")
            print(json.dumps(payload, indent=2)[:5000])
        raise ValueError("Could not find ephemeris records/data/rows list")

    out = []

    for rec in rows:
        if not isinstance(rec, dict):
            continue

        t = rec.get("t") or rec.get("date") or rec.get("time")
        if t is None:
            continue

        venus_torque = np.nan
        mars_torque = np.nan

        bodies = rec.get("bodies")

        if isinstance(bodies, dict):
            venus = bodies.get("venus") or bodies.get("Venus") or {}
            mars = bodies.get("mars") or bodies.get("Mars") or {}

            if isinstance(venus, dict):
                venus_torque = (
                    venus.get("torque_proxy")
                    or venus.get("torqueProxy")
                    or venus.get("torque")
                    or venus.get("proxy")
                )

            if isinstance(mars, dict):
                mars_torque = (
                    mars.get("torque_proxy")
                    or mars.get("torqueProxy")
                    or mars.get("torque")
                    or mars.get("proxy")
                )

        # Fallbacks for flat record schemas
        venus_torque = rec.get("venus_torque", venus_torque)
        venus_torque = rec.get("venusTorque", venus_torque)
        venus_torque = rec.get("Venus_torque_proxy", venus_torque)
        venus_torque = rec.get("venus_torque_proxy", venus_torque)

        mars_torque = rec.get("mars_torque", mars_torque)
        mars_torque = rec.get("marsTorque", mars_torque)
        mars_torque = rec.get("Mars_torque_proxy", mars_torque)
        mars_torque = rec.get("mars_torque_proxy", mars_torque)

        out.append({
            "date": t,
            "venus_torque": venus_torque,
            "mars_torque": mars_torque,
        })

    df = pd.DataFrame(out)

    if df.empty:
        raise ValueError("Parsed ephemeris dataframe is empty")

    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["venus_torque"] = pd.to_numeric(df["venus_torque"], errors="coerce")
    df["mars_torque"] = pd.to_numeric(df["mars_torque"], errors="coerce")
    df["venus_mars_torque"] = df[["venus_torque", "mars_torque"]].sum(axis=1, min_count=1)

    df = normalize_datetime_ns(df)
    df = df.dropna(subset=["venus_mars_torque"])

    if debug:
        print("\nEPHEMERIS DF HEAD:")
        print(df.head())
        print("\nEPHEMERIS DF DESCRIBE:")
        print(df.describe(include="all"))

    return df[["date", "venus_mars_torque"]]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--start", default="1962-01-01")
    p.add_argument("--end", default="2026-05-08")
    p.add_argument("--window-size", type=int, default=365)
    p.add_argument("--center-window", type=int, default=433)
    p.add_argument("--center-step", type=int, default=30)
    p.add_argument("--dance-window", type=int, default=433)
    p.add_argument("--tolerance-days", type=int, default=3)
    p.add_argument("--debug", action="store_true")
    p.add_argument("--out", default="drift_venus_mars_heatmap.png")
    args = p.parse_args()

    rolling_payload = get_json("/api/rolling-stats", {
        "windowSize": args.window_size,
        "centerWindow": args.center_window,
        "centerStep": args.center_step,
        "danceWindow": args.dance_window,
    })

    eph_payload = get_json("/api/ephemeris", {
        "start": args.start,
        "end": args.end,
    })

    rolling = extract_rolling(rolling_payload, start=args.start, end=args.end)
    eph = extract_ephemeris(eph_payload, debug=args.debug)

    if args.debug:
        print("\nROLLING KEYS:")
        print(list(rolling_payload.keys()))
        print("\nROLLING DF HEAD:")
        print(rolling.head())
        print("\nROLLING DF DESCRIBE:")
        print(rolling.describe(include="all"))

    df = pd.merge_asof(
        rolling.sort_values("date"),
        eph.sort_values("date"),
        on="date",
        direction="nearest",
        tolerance=pd.Timedelta(days=args.tolerance_days),
    )

    start = pd.to_datetime(args.start)
    end = pd.to_datetime(args.end)

    df = df[
        (df["date"] >= start) &
        (df["date"] <= end)
    ].dropna(subset=["angular_velocity", "r_ratio", "venus_mars_torque"])

    if args.debug:
        print("\nMERGED DF HEAD:")
        print(df.head())
        print("\nMERGED DF TAIL:")
        print(df.tail())
        print("\nMERGED DF DESCRIBE:")
        print(df.describe(include="all"))
        print(f"\nRows merged: {len(df)}")

    if df.empty:
        raise ValueError(
            "Merged dataframe is empty. Try increasing --tolerance-days or inspect with --debug."
        )

    heat_values = np.vstack([
        zscore(df["angular_velocity"]).to_numpy(),
        zscore(df["r_ratio"]).to_numpy(),
        zscore(df["venus_mars_torque"]).to_numpy(),
    ])

    heat = pd.DataFrame(
        heat_values,
        index=[
            "Angular velocity ω",
            "Orthogonality R(t)",
            "Venus+Mars torque",
        ],
        columns=df["date"].to_numpy(),
    )

    finite_vals = heat_values[np.isfinite(heat_values)]
    if finite_vals.size == 0:
        raise ValueError("Heatmap values are all NaN after z-score normalization")

    vmax = np.nanpercentile(np.abs(finite_vals), 98)
    if vmax == 0 or np.isnan(vmax):
        vmax = 1.0
    
    fig, ax = plt.subplots(figsize=(18, 5.2))

    im = ax.imshow(
        heat.values,
        aspect="auto",
        interpolation="nearest",
        cmap="viridis",
        vmin=-vmax,
        vmax=vmax,
        extent=[
            mdates.date2num(df["date"].min()),
            mdates.date2num(df["date"].max()),
            0,
            heat.shape[0],
        ],
    )

    ax.set_yticks(np.arange(heat.shape[0]) + 0.5)
    ax.set_yticklabels(heat.index)
    ax.set_title("DRIFT timeline comparison: angular velocity, R(t), and Venus+Mars torque proxy")
    ax.set_xlabel("Date")

    ax.xaxis_date()
    ax.xaxis.set_major_locator(mdates.YearLocator(base=5))
    ax.xaxis.set_major_formatter(DateFormatter("%Y"))
    fig.autofmt_xdate()

    cbar = fig.colorbar(im, ax=ax, pad=0.015)
    cbar.set_label("z-score")

    fig.tight_layout()
    fig.savefig(args.out, dpi=240)

    print(f"Saved: {args.out}")
    print(f"Rows merged: {len(df)}")
    print(df[["date", "angular_velocity", "r_ratio", "venus_mars_torque"]].tail())


if __name__ == "__main__":
    main()