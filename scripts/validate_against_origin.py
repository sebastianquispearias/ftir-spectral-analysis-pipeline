"""Validate pipeline output against OriginLab-processed spectra.

Compares baseline correction results using the REAL pipeline functions
(not reimplementations) against manually processed .dat files from Origin.

Usage:
    python scripts/validate_against_origin.py
"""
from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.config import RANGO_CARBOXILATO
from backend.ftir_pipeline import (
    calcular_baseline,
    calcular_metricas_pico,
    cargar_espectro,
    suavizar_espectro,
)

DPT_FILE = ROOT / "data" / "examples" / "raw" / "1" / "Amostra TCNF Paul n.1.1.dpt"
ORIGIN_SIN = ROOT / "data" / "examples" / "origin_validation" / "n_1_1_origin_SIN_smooth.dat"
ORIGIN_CON = ROOT / "data" / "examples" / "origin_validation" / "n_1_1_origin_CON_smooth.dat"
OUTPUT_DIR = ROOT / "data" / "examples" / "origin_validation"

ANCHOR_X = [
    399.54543, 469.20977, 651.5664, 825.72723, 909.73422,
    1092.09085, 1186.3426, 1389.18874, 1510.07684, 1686.28662,
    1870.69221, 2005.92297, 2149.34954, 2257.94394, 2378.83204,
    2979.17467, 3712.69911, 3852.02777, 3997.50329,
]


def load_origin_dat(path: Path) -> tuple[np.ndarray, np.ndarray]:
    """Load Origin .dat — columns 2,3 are the baseline-subtracted spectrum."""
    data = np.loadtxt(path, skiprows=2, encoding="latin-1")
    x = data[:, 2]
    y = data[:, 3]
    order = np.argsort(x)
    return x[order], y[order]


def run_pipeline(x, y, apply_smoothing: bool):
    """Run the real pipeline with custom anchors."""
    if apply_smoothing:
        y_input = suavizar_espectro(y, metodo="AAV", ventana=5)
    else:
        y_input = y

    baseline, anchor_x, anchor_y = calcular_baseline(
        x, y_input, custom_anchor_points=ANCHOR_X,
    )
    y_corrected = y_input - baseline
    metrics = calcular_metricas_pico(x, y_corrected, RANGO_CARBOXILATO)
    return y_corrected, baseline, anchor_x, anchor_y, metrics


def compute_origin_metrics(path: Path):
    """Load Origin .dat and compute metrics with the same function."""
    x_orig, y_orig = load_origin_dat(path)
    metrics = calcular_metricas_pico(x_orig, y_orig, RANGO_CARBOXILATO)
    return x_orig, y_orig, metrics


def pct_diff(pipeline_val, origin_val):
    if origin_val == 0:
        return float("inf")
    return abs(pipeline_val - origin_val) / abs(origin_val) * 100


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("=" * 70)
    print("FTIR Pipeline vs OriginLab — Validation Report")
    print("=" * 70)

    # Load raw spectrum
    x, y = cargar_espectro(DPT_FILE)
    print(f"\nSpectrum: {DPT_FILE.name}")
    print(f"Points: {len(x)}, Range: {x.min():.1f} – {x.max():.1f} cm-1")
    print(f"Anchor points: {len(ANCHOR_X)}")
    print(f"Carboxylate range: {RANGO_CARBOXILATO}")

    # --- Mode A: without smoothing ---
    y_corr_a, bl_a, ax_a, ay_a, met_a = run_pipeline(x, y, apply_smoothing=False)
    x_orig_a, y_orig_a, met_orig_a = compute_origin_metrics(ORIGIN_SIN)

    # --- Mode B: with smoothing ---
    y_corr_b, bl_b, ax_b, ay_b, met_b = run_pipeline(x, y, apply_smoothing=True)
    x_orig_b, y_orig_b, met_orig_b = compute_origin_metrics(ORIGIN_CON)

    # --- Table ---
    rows = [
        ("Sin smoothing", "Altura", met_a["altura"], met_orig_a["altura"]),
        ("Sin smoothing", "Área", met_a["area"], met_orig_a["area"]),
        ("Con smoothing AAV-5", "Altura", met_b["altura"], met_orig_b["altura"]),
        ("Con smoothing AAV-5", "Área", met_b["area"], met_orig_b["area"]),
    ]

    print(f"\n{'Configuración':<25} {'Métrica':<10} {'Pipeline':>10} {'Origin':>10} {'Diff %':>10}")
    print("-" * 70)
    for config, metric, p_val, o_val in rows:
        diff = pct_diff(p_val, o_val)
        print(f"{config:<25} {metric:<10} {p_val:>10.5f} {o_val:>10.5f} {diff:>9.2f}%")

    # --- Plot ---
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 8), sharex=True)

    rng = RANGO_CARBOXILATO
    for ax, y_pipe, x_orig, y_orig, title in [
        (ax1, y_corr_a, x_orig_a, y_orig_a, "Without smoothing"),
        (ax2, y_corr_b, x_orig_b, y_orig_b, "With AAV-5 smoothing"),
    ]:
        ax.plot(x, y_pipe, color="#4f46e5", linewidth=1.2, label="Pipeline")
        ax.plot(x_orig, y_orig, color="#dc2626", linewidth=1.2,
                linestyle="--", alpha=0.8, label="OriginLab")
        ax.axvspan(rng[0], rng[1], alpha=0.15, color="#10b981", label="Carboxylate region")
        ax.set_ylabel("Absorbance (corrected)")
        ax.set_title(title)
        ax.legend(loc="upper right", fontsize=9)
        ax.grid(True, alpha=0.3)

    ax2.set_xlabel("Wavenumber (cm-1)")
    fig.suptitle("Pipeline vs OriginLab — Baseline-Corrected Spectra", fontsize=14, y=0.98)
    fig.tight_layout()
    plot_path = OUTPUT_DIR / "comparison.png"
    fig.savefig(plot_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"\nPlot saved: {plot_path.relative_to(ROOT)}")

    # --- Zoomed plot: carboxylate region only ---
    fig2, (ax3, ax4) = plt.subplots(2, 1, figsize=(10, 7))
    margin = 50
    x_lo, x_hi = rng[0] - margin, rng[1] + margin

    for ax, y_pipe, x_orig, y_orig, met_p, met_o, title in [
        (ax3, y_corr_a, x_orig_a, y_orig_a, met_a, met_orig_a, "Without smoothing"),
        (ax4, y_corr_b, x_orig_b, y_orig_b, met_b, met_orig_b, "With AAV-5 smoothing"),
    ]:
        mask_p = (x >= x_lo) & (x <= x_hi)
        mask_o = (x_orig >= x_lo) & (x_orig <= x_hi)
        ax.plot(x[mask_p], y_pipe[mask_p], color="#4f46e5", linewidth=1.5, label="Pipeline")
        ax.plot(x_orig[mask_o], y_orig[mask_o], color="#dc2626", linewidth=1.5,
                linestyle="--", alpha=0.8, label="OriginLab")
        ax.axvspan(rng[0], rng[1], alpha=0.12, color="#10b981")
        ax.set_ylabel("Absorbance (corrected)")
        ax.set_title(title)
        ax.legend(loc="upper right", fontsize=9)
        ax.grid(True, alpha=0.3)

        h_diff = pct_diff(met_p["altura"], met_o["altura"])
        a_diff = pct_diff(met_p["area"], met_o["area"])
        ax.text(0.02, 0.95,
                f"Height: {met_p['altura']:.5f} vs {met_o['altura']:.5f} ({h_diff:.2f}%)\n"
                f"Area:   {met_p['area']:.5f} vs {met_o['area']:.5f} ({a_diff:.2f}%)",
                transform=ax.transAxes, fontsize=9, verticalalignment="top",
                fontfamily="monospace",
                bbox=dict(boxstyle="round,pad=0.4", facecolor="white", alpha=0.9))

    ax4.set_xlabel("Wavenumber (cm-1)")
    fig2.suptitle(f"Carboxylate Region Zoom ({rng[0]}-{rng[1]} cm-1)", fontsize=14, y=0.98)
    fig2.tight_layout()
    zoom_path = OUTPUT_DIR / "comparison_zoom.png"
    fig2.savefig(zoom_path, dpi=150, bbox_inches="tight")
    plt.close(fig2)
    print(f"Zoom plot saved: {zoom_path.relative_to(ROOT)}")

    # --- Report ---
    report_lines = [
        "# Pipeline vs OriginLab — Validation Report",
        "",
        f"**Date:** {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"**Spectrum:** `{DPT_FILE.name}`",
        f"**Anchor points:** {len(ANCHOR_X)} (manual, identical for both)",
        f"**Carboxylate range:** {rng[0]}–{rng[1]} cm-1",
        "",
        "## Results",
        "",
        "| Configuration | Metric | Pipeline | Origin | Diff % |",
        "|---|---|---|---|---|",
    ]
    for config, metric, p_val, o_val in rows:
        diff = pct_diff(p_val, o_val)
        report_lines.append(f"| {config} | {metric} | {p_val:.5f} | {o_val:.5f} | {diff:.2f}% |")

    report_lines.extend([
        "",
        "## Comparison Plot",
        "",
        "![comparison](comparison.png)",
        "",
        "## Conclusion",
        "",
        f"Peak height deviation: {pct_diff(met_a['altura'], met_orig_a['altura']):.2f}% (no smooth), "
        f"{pct_diff(met_b['altura'], met_orig_b['altura']):.2f}% (with smooth).",
        f"Integrated area deviation: {pct_diff(met_a['area'], met_orig_a['area']):.2f}% (no smooth), "
        f"{pct_diff(met_b['area'], met_orig_b['area']):.2f}% (with smooth).",
        "",
        "Pipeline uses scipy `make_interp_spline` (k=3) for baseline interpolation. "
        "OriginLab uses its proprietary Peak Analyzer. Small deviations are expected "
        "due to differences in spline implementation details.",
    ])

    report_path = OUTPUT_DIR / "validation_report.md"
    report_path.write_text("\n".join(report_lines), encoding="utf-8")
    print(f"Report saved: {report_path.relative_to(ROOT)}")
    print("\nDone.")


if __name__ == "__main__":
    main()
