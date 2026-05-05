from pathlib import Path

import numpy as np
import pytest


def generar_espectro_sintetico(
    x_min: float = 400,
    x_max: float = 4000,
    n_points: int = 1800,
    baseline_slope: float = 1e-4,
    baseline_offset: float = 0.05,
) -> tuple[np.ndarray, np.ndarray]:
    """Generate a synthetic FTIR spectrum with 6 Gaussian peaks and linear baseline.

    Produces enough valleys between peaks for automatic anchor point detection
    (find_peaks needs at least 4 valleys + 2 endpoints).
    """
    x = np.linspace(x_min, x_max, n_points)
    baseline = baseline_offset + baseline_slope * x

    peaks = [
        (700, 0.06, 30),
        (1024, 0.11, 40),
        (1602, 0.03, 15),
        (2100, 0.04, 25),
        (2900, 0.08, 50),
        (3400, 0.05, 35),
    ]
    y = baseline.copy()
    for centro, altura, ancho in peaks:
        y += altura * np.exp(-0.5 * ((x - centro) / ancho) ** 2)

    return x, y


def escribir_dpt(path: Path, x: np.ndarray, y: np.ndarray, descendente: bool = True) -> None:
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
            x, y = generar_espectro_sintetico()
            y += 0.005 * exp * np.exp(-0.5 * ((x - 1602) / 15) ** 2)
            path = tmp_path / f"Amostra_TCNF_Paul_n_{exp}_{rep}.dpt"
            escribir_dpt(path, x, y)
            paths.append(path)
    return paths
