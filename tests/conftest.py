import tempfile
from pathlib import Path

import numpy as np
import pytest


def generar_espectro_sintetico(
    x_min: float = 400,
    x_max: float = 4000,
    n_points: int = 1800,
    baseline_slope: float = 1e-4,
    baseline_offset: float = 0.05,
    pico_carb_centro: float = 1602,
    pico_carb_altura: float = 0.03,
    pico_carb_ancho: float = 15,
    pico_ref_centro: float = 1024,
    pico_ref_altura: float = 0.11,
    pico_ref_ancho: float = 40,
) -> tuple[np.ndarray, np.ndarray]:
    """Generate a synthetic FTIR spectrum with known Gaussian peaks and linear baseline."""
    x = np.linspace(x_min, x_max, n_points)
    baseline = baseline_offset + baseline_slope * x
    carb = pico_carb_altura * np.exp(-0.5 * ((x - pico_carb_centro) / pico_carb_ancho) ** 2)
    ref = pico_ref_altura * np.exp(-0.5 * ((x - pico_ref_centro) / pico_ref_ancho) ** 2)
    y = baseline + carb + ref
    return x, y


def escribir_dpt(path: Path, x: np.ndarray, y: np.ndarray, descendente: bool = True) -> None:
    """Write a .dpt file (tab-separated, optionally descending x like real files)."""
    if descendente:
        x = x[::-1]
        y = y[::-1]
    np.savetxt(path, np.column_stack([x, y]), delimiter="\t", fmt="%.6f")


@pytest.fixture
def espectro_sintetico():
    return generar_espectro_sintetico()


@pytest.fixture
def archivo_dpt_temporal(tmp_path):
    x, y = generar_espectro_sintetico()
    path = tmp_path / "Amostra_TCNF_Paul_n_1_1.dpt"
    escribir_dpt(path, x, y)
    return path


@pytest.fixture
def archivos_lote_temporal(tmp_path):
    paths = []
    for exp in range(1, 4):
        for rep in range(1, 3):
            x, y = generar_espectro_sintetico(
                pico_carb_altura=0.03 + 0.005 * exp,
                pico_ref_altura=0.11 + 0.002 * exp,
            )
            path = tmp_path / f"Amostra_TCNF_Paul_n_{exp}_{rep}.dpt"
            escribir_dpt(path, x, y)
            paths.append(path)
    return paths
