from __future__ import annotations

from concurrent.futures import Executor, ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Callable

import numpy as np
import pandas as pd
from scipy.interpolate import make_interp_spline
from scipy.ndimage import percentile_filter, uniform_filter1d
from scipy.signal import find_peaks, savgol_filter

from backend.config import (
    DEFAULT_SMOOTHING_METHOD,
    DEFAULT_SMOOTHING_WINDOW,
    FILENAME_PATTERN,
    MAX_ANCHOR_POINTS,
    MIN_ANCHOR_POINTS,
    PEAK_FIND_DISTANCE,
    PEAK_FIND_PROMINENCE,
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


def suavizar_espectro(
    y: np.ndarray,
    metodo: str = "AAV",
    ventana: int = 5,
) -> np.ndarray:
    """Apply smoothing to a spectrum.

    Validated empirically: AAV with window=5 produces <3% deviation from
    Origin's manual processing on TCNF FTIR spectra.
    """
    if metodo == "AAV":
        return uniform_filter1d(y, size=ventana, mode="reflect")
    elif metodo == "SG":
        if ventana % 2 == 0:
            ventana += 1
        polyorder = min(2, ventana - 1)
        return savgol_filter(y, window_length=ventana, polyorder=polyorder)
    elif metodo == "PF":
        return percentile_filter(y, percentile=50, size=ventana, mode="reflect")
    elif metodo == "FFT":
        yf = np.fft.fft(y)
        n = len(y)
        cutoff = max(1, n // ventana)
        yf_filtered = yf.copy()
        yf_filtered[cutoff:-cutoff] = 0
        return np.real(np.fft.ifft(yf_filtered))
    elif metodo == "Binomial":
        result = y.copy()
        kernel = np.array([1, 2, 1]) / 4.0
        for _ in range(ventana):
            result = np.convolve(result, kernel, mode="same")
        return result
    else:
        raise ValueError(
            f"Unknown smoothing method: {metodo}. "
            f"Options: AAV, SG, PF, FFT, Binomial"
        )


def calcular_baseline(
    x: np.ndarray,
    y: np.ndarray,
    metodo_suavizado: str = DEFAULT_SMOOTHING_METHOD,
    ventana_suavizado: int = DEFAULT_SMOOTHING_WINDOW,
    distance: int = PEAK_FIND_DISTANCE,
    prominence: float = PEAK_FIND_PROMINENCE,
    custom_anchor_points: list[float] | None = None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Compute baseline using automatic valley detection or custom anchor points.

    Approximates the OriginLab Peak Analyzer workflow followed by the
    researcher, empirically validated against one manually processed
    reference spectrum (deviation: 0.5% peak height, 2.6% peak area).

    Uses not-a-knot boundary condition for the cubic B-spline, which is
    the most common convention in commercial spectroscopy software
    including OriginLab.

    Returns (baseline, anchor_x, anchor_y).
    """
    if custom_anchor_points is not None:
        anchors = np.unique(custom_anchor_points)

        if len(anchors) < MIN_ANCHOR_POINTS:
            raise ValueError(
                f"At least {MIN_ANCHOR_POINTS} unique anchor points required, "
                f"got {len(anchors)}"
            )

        x_min, x_max = float(x.min()), float(x.max())
        tolerance = (x_max - x_min) * 0.001
        out_of_range = anchors[(anchors < x_min - tolerance) | (anchors > x_max + tolerance)]
        if len(out_of_range) > 0:
            raise ValueError(
                f"Anchor points outside spectrum range "
                f"[{x_min:.1f}, {x_max:.1f}]: {out_of_range.tolist()}"
            )
        anchors = np.clip(anchors, x_min, x_max)

        indices = sorted([int(np.argmin(np.abs(x - ap))) for ap in anchors])
        anchor_x = x[indices]
        anchor_y = y[indices]
    else:
        y_suave = suavizar_espectro(y, metodo=metodo_suavizado, ventana=ventana_suavizado)
        neg_y = -y_suave
        valleys_idx, _ = find_peaks(neg_y, distance=distance, prominence=prominence)
        all_anchor_idx = sorted(set([0, len(x) - 1] + list(valleys_idx)))

        if len(all_anchor_idx) < MIN_ANCHOR_POINTS:
            raise ValueError(
                f"Only {len(all_anchor_idx)} anchor points detected. "
                f"Minimum required: {MIN_ANCHOR_POINTS}. "
                f"Try lowering 'prominence' or adjusting smoothing."
            )

        if len(all_anchor_idx) > MAX_ANCHOR_POINTS:
            raise ValueError(
                f"{len(all_anchor_idx)} anchor points detected. "
                f"Maximum allowed: {MAX_ANCHOR_POINTS}. "
                f"Try raising 'prominence' or using stronger smoothing."
            )

        anchor_x = x[all_anchor_idx]
        anchor_y = y[all_anchor_idx]

    spline = make_interp_spline(anchor_x, anchor_y, k=3, bc_type="not-a-knot")
    baseline = spline(x)

    return baseline, anchor_x, anchor_y


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


def extraer_experimento_replica(nombre: str) -> tuple[int | None, int | None]:
    """Extract experiment and replica numbers from a .dpt filename."""
    match = FILENAME_PATTERN.search(nombre)
    if match:
        return int(match.group(1)), int(match.group(2))
    return None, None


def procesar_archivo(
    ruta: str | Path,
    metodo_suavizado: str = DEFAULT_SMOOTHING_METHOD,
    ventana_suavizado: int = DEFAULT_SMOOTHING_WINDOW,
    distance: int = PEAK_FIND_DISTANCE,
    prominence: float = PEAK_FIND_PROMINENCE,
    custom_anchor_points: list[float] | None = None,
    apply_spectrum_smoothing: bool = False,
    rango_carboxilato: tuple[float, float] = RANGO_CARBOXILATO,
    rango_referencia: tuple[float, float] = RANGO_REFERENCIA,
    nombre_original: str | None = None,
) -> dict:
    """Full processing pipeline for a single .dpt file."""
    ruta = Path(ruta)
    nombre = nombre_original or ruta.name
    x, y_raw = cargar_espectro(ruta)

    if apply_spectrum_smoothing:
        y = suavizar_espectro(y_raw, metodo=metodo_suavizado, ventana=ventana_suavizado)
    else:
        y = y_raw

    baseline, anchor_x, anchor_y = calcular_baseline(
        x, y, metodo_suavizado, ventana_suavizado, distance, prominence,
        custom_anchor_points,
    )
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
        "n_anchor_points": len(anchor_x),
    }


def procesar_lote(
    rutas: list[str | Path],
    metodo_suavizado: str = DEFAULT_SMOOTHING_METHOD,
    ventana_suavizado: int = DEFAULT_SMOOTHING_WINDOW,
    distance: int = PEAK_FIND_DISTANCE,
    prominence: float = PEAK_FIND_PROMINENCE,
    custom_anchor_points: list[float] | None = None,
    apply_spectrum_smoothing: bool = False,
    progress_callback: Callable[[int, int], None] | None = None,
    executor: Executor | None = None,
    nombres_originales: dict[str, str] | None = None,
) -> pd.DataFrame:
    """Process a batch of .dpt files in parallel."""
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
            future = executor.submit(
                procesar_archivo, ruta,
                metodo_suavizado, ventana_suavizado, distance, prominence,
                custom_anchor_points, apply_spectrum_smoothing,
                nombre_original=nombre,
            )
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
