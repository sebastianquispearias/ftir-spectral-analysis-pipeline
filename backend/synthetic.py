"""Generate synthetic FTIR spectra for the Box-Behnken 15x10 example dataset."""
from __future__ import annotations

import io
from pathlib import Path

import numpy as np

from backend.anova_analysis import construir_matriz_diseno_box_behnken

SEED = 42
N_REPLICAS = 10
WAVENUMBERS = np.linspace(400, 4000, 1757)


def _area_model(x1: float, x2: float, x3: float) -> float:
    return (0.70
            - 0.13 * x1
            + 0.07 * x2
            + 0.12 * x2 ** 2
            - 0.13 * x3 ** 2
            + 0.13 * x1 * x2
            - 0.16 * x2 * x3)


def _gaussian(x: np.ndarray, center: float, width: float, height: float) -> np.ndarray:
    return height * np.exp(-0.5 * ((x - center) / width) ** 2)


def _generate_spectrum(area: float, rng: np.random.Generator) -> np.ndarray:
    x = WAVENUMBERS
    baseline = 0.08 - 3e-5 * (x - 2000) + 1.5e-9 * (x - 2000) ** 2
    carb_height = area * 0.033
    carb = _gaussian(x, 1620, 15, carb_height)
    ref = _gaussian(x, 1050, 40, 0.06)
    oh = _gaussian(x, 3400, 200, 0.03)
    noise = rng.normal(0, 0.0008, len(x))
    return baseline + carb + ref + oh + noise


def generate_all_synthetic() -> list[tuple[str, bytes]]:
    """Return list of (filename, dpt_bytes) for 150 synthetic spectra."""
    rng = np.random.default_rng(SEED)
    diseno = construir_matriz_diseno_box_behnken()
    files = []

    for _, row in diseno.iterrows():
        exp = int(row["exp"])
        x1, x2, x3 = row["X1"], row["X2"], row["X3"]
        base_area = _area_model(x1, x2, x3)

        for rep in range(1, N_REPLICAS + 1):
            area = base_area + rng.normal(0, 0.02)
            spectrum = _generate_spectrum(area, rng)

            buf = io.BytesIO()
            for xi, yi in zip(WAVENUMBERS[::-1], spectrum[::-1]):
                buf.write(f"{xi:.5f}\t{yi:.6f}\n".encode())
            content = buf.getvalue()

            filename = f"Synthetic_TCNF_n.{exp}.{rep}.dpt"
            files.append((filename, content))

    return files
