from __future__ import annotations

import re
from concurrent.futures import Executor, ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Callable

import numpy as np
import pandas as pd
from scipy.interpolate import make_interp_spline

from backend.config import (
    FILENAME_PATTERN,
    MIN_ANCHOR_POINTS,
    RANGO_CARBOXILATO,
    RANGO_REFERENCIA,
)


def cargar_espectro(ruta: str | Path) -> tuple[np.ndarray, np.ndarray]:
    """Load a .dpt file (two tab/space-separated numeric columns).

    Returns (x, y) sorted ascending by x (wavenumber cm⁻¹).
    """
    ruta = Path(ruta)
    try:
        data = np.loadtxt(ruta)
    except ValueError as e:
        raise ValueError(f"File contains non-numeric data: {ruta.name}") from e

    if data.size == 0:
        raise ValueError(f"File is empty: {ruta.name}")

    if data.ndim != 2 or data.shape[1] != 2:
        raise ValueError(
            f"Expected 2 columns, got {data.shape[1] if data.ndim == 2 else 'malformed'}: {ruta.name}"
        )

    order = np.argsort(data[:, 0])
    x = data[order, 0]
    y = data[order, 1]
    return x, y


def calcular_baseline(
    x: np.ndarray,
    y: np.ndarray,
    anchor_points_cm: list[float],
) -> np.ndarray:
    """Compute a cubic B-spline baseline through the given anchor points.

    Uses scipy make_interp_spline(k=3) with not-a-knot boundary condition,
    which is the most common default in commercial spectroscopy software.
    This is a reproducible approximation to Origin's baseline correction
    workflow — empirical validation against Origin outputs on identical
    anchor points is recommended.
    """
    anchors = np.unique(anchor_points_cm)

    if len(anchors) < MIN_ANCHOR_POINTS:
        raise ValueError(
            f"At least {MIN_ANCHOR_POINTS} unique anchor points required "
            f"for cubic spline (k=3), got {len(anchors)}"
        )

    x_min, x_max = float(x.min()), float(x.max())
    out_of_range = anchors[(anchors < x_min) | (anchors > x_max)]
    if len(out_of_range) > 0:
        raise ValueError(
            f"Anchor points outside spectrum range [{x_min:.1f}, {x_max:.1f}]: "
            f"{out_of_range.tolist()}"
        )

    indices = np.array([np.argmin(np.abs(x - ap)) for ap in anchors])
    x_anchor = x[indices]
    y_anchor = y[indices]

    spline = make_interp_spline(x_anchor, y_anchor, k=3)
    baseline = spline(x)
    return baseline


def calcular_metricas_pico(
    x: np.ndarray,
    y_corregido: np.ndarray,
    rango: tuple[float, float],
) -> dict[str, float]:
    """Calculate peak metrics (height, area, position) within a wavenumber range."""
    mask = (x >= rango[0]) & (x <= rango[1])
    x_region = x[mask]
    y_region = y_corregido[mask]

    if len(x_region) == 0:
        raise ValueError(f"No data points in range [{rango[0]}, {rango[1]}]")

    idx_max = np.argmax(y_region)
    altura = float(y_region[idx_max])
    x_pico = float(x_region[idx_max])
    area = float(np.trapezoid(np.maximum(y_region, 0), x_region))

    return {"altura": altura, "area": area, "x_pico": x_pico}


def detectar_anchor_points(
    x: np.ndarray,
    y: np.ndarray,
    n_points: int = 10,
    smooth_window: int = 25,
) -> list[float]:
    """Auto-detect flat regions suitable for baseline anchor points.

    Uses the second derivative magnitude: regions where |y''| is near zero
    are flat (no peaks). Selects n_points spread across the spectrum.
    """
    from scipy.ndimage import uniform_filter1d

    y_smooth = uniform_filter1d(y, size=smooth_window)
    dy2 = np.gradient(np.gradient(y_smooth, x), x)
    flatness = 1.0 / (np.abs(dy2) + 1e-12)
    flatness_smooth = uniform_filter1d(flatness, size=smooth_window * 2)

    n_bins = n_points
    bin_edges = np.linspace(x.min(), x.max(), n_bins + 1)
    anchors = []

    for i in range(n_bins):
        mask = (x >= bin_edges[i]) & (x < bin_edges[i + 1])
        if not mask.any():
            continue
        local_flat = flatness_smooth.copy()
        local_flat[~mask] = -np.inf
        best_idx = np.argmax(local_flat)
        anchors.append(float(x[best_idx]))

    anchors.sort()

    min_spacing = (x.max() - x.min()) / (n_points * 2)
    filtered = [anchors[0]]
    for ap in anchors[1:]:
        if ap - filtered[-1] >= min_spacing:
            filtered.append(ap)
    anchors = filtered

    if len(anchors) < MIN_ANCHOR_POINTS:
        anchors = np.linspace(x.min(), x.max(), MIN_ANCHOR_POINTS).tolist()

    return anchors


def extraer_experimento_replica(nombre: str) -> tuple[int | None, int | None]:
    """Extract experiment and replica numbers from a .dpt filename."""
    match = FILENAME_PATTERN.search(nombre)
    if match:
        return int(match.group(1)), int(match.group(2))
    return None, None


def procesar_archivo(
    ruta: str | Path,
    anchor_points: list[float],
    rango_carboxilato: tuple[float, float] = RANGO_CARBOXILATO,
    rango_referencia: tuple[float, float] = RANGO_REFERENCIA,
    nombre_original: str | None = None,
) -> dict:
    """Full processing pipeline for a single .dpt file."""
    ruta = Path(ruta)
    nombre = nombre_original or ruta.name
    x, y = cargar_espectro(ruta)
    baseline = calcular_baseline(x, y, anchor_points)
    y_corregido = y - baseline

    metricas_carb = calcular_metricas_pico(x, y_corregido, rango_carboxilato)
    metricas_ref = calcular_metricas_pico(x, y_corregido, rango_referencia)

    normalizada = (
        metricas_carb["altura"] / metricas_ref["altura"]
        if metricas_ref["altura"] != 0
        else 0.0
    )

    exp, replica = extraer_experimento_replica(nombre)

    return {
        "archivo": nombre,
        "experimento": exp,
        "replica": replica,
        "altura_carb": metricas_carb["altura"],
        "area_carb": metricas_carb["area"],
        "normalizada": normalizada,
        "altura_ref": metricas_ref["altura"],
        "x_pico_carb": metricas_carb["x_pico"],
    }


def procesar_lote(
    rutas: list[str | Path],
    anchor_points: list[float],
    progress_callback: Callable[[int, int], None] | None = None,
    executor: Executor | None = None,
    nombres_originales: dict[str, str] | None = None,
) -> pd.DataFrame:
    """Process a batch of .dpt files in parallel.

    Args:
        executor: Concurrent executor instance. Defaults to ThreadPoolExecutor.
                  Pass a ProcessPoolExecutor for CPU-bound scaling if needed.
        nombres_originales: Map from file path string to original filename,
                           used when files are stored with UUID names on disk.
    """
    total = len(rutas)
    resultados: list[dict] = []
    completados = 0

    own_executor = executor is None
    if own_executor:
        executor = ThreadPoolExecutor()

    try:
        futures = {}
        for ruta in rutas:
            nombre = nombres_originales.get(str(ruta)) if nombres_originales else None
            future = executor.submit(procesar_archivo, ruta, anchor_points, nombre_original=nombre)
            futures[future] = ruta

        for future in as_completed(futures):
            resultado = future.result()
            resultados.append(resultado)
            completados += 1
            if progress_callback:
                progress_callback(completados, total)
    finally:
        if own_executor:
            executor.shutdown(wait=False)

    df = pd.DataFrame(resultados)
    if not df.empty:
        df = df.sort_values(["experimento", "replica"]).reset_index(drop=True)
    return df
