import numpy as np
import pytest

from backend.config import DEFAULT_ANCHOR_POINTS
from backend.ftir_pipeline import (
    calcular_baseline,
    calcular_metricas_pico,
    cargar_espectro,
    extraer_experimento_replica,
    procesar_archivo,
    procesar_lote,
)
from tests.conftest import escribir_dpt, generar_espectro_sintetico


# --- cargar_espectro ---

class TestCargarEspectro:
    def test_carga_y_ordena_ascendente(self, archivo_dpt_temporal):
        x, y = cargar_espectro(archivo_dpt_temporal)
        assert len(x) == len(y)
        assert len(x) > 0
        assert np.all(np.diff(x) >= 0), "x must be sorted ascending"

    def test_archivo_vacio(self, tmp_path):
        path = tmp_path / "empty.dpt"
        path.write_text("")
        with pytest.raises(ValueError, match="empty"):
            cargar_espectro(path)

    def test_archivo_corrupto(self, tmp_path):
        path = tmp_path / "corrupto.dpt"
        path.write_text("hello\tworld\nfoo\tbar\n")
        with pytest.raises(ValueError, match="non-numeric"):
            cargar_espectro(path)

    def test_tres_columnas(self, tmp_path):
        path = tmp_path / "tres_cols.dpt"
        data = np.column_stack([np.arange(10), np.arange(10), np.arange(10)])
        np.savetxt(path, data, delimiter="\t")
        with pytest.raises(ValueError, match="2 columns"):
            cargar_espectro(path)


# --- calcular_baseline ---

class TestCalcularBaseline:
    def test_pasa_por_anchor_points(self, espectro_sintetico):
        x, y = espectro_sintetico
        anchors = [500, 800, 1500, 1750, 1850, 2400, 3500]
        baseline = calcular_baseline(x, y, anchors)
        for ap in anchors:
            idx = np.argmin(np.abs(x - ap))
            assert abs(baseline[idx] - y[idx]) < 1e-10

    def test_forma_correcta(self, espectro_sintetico):
        x, y = espectro_sintetico
        anchors = [500, 800, 1500, 1750, 1850, 2400, 3500]
        baseline = calcular_baseline(x, y, anchors)
        assert baseline.shape == x.shape

    def test_anchor_points_insuficientes(self, espectro_sintetico):
        x, y = espectro_sintetico
        with pytest.raises(ValueError, match="At least 4"):
            calcular_baseline(x, y, [500, 1000, 2000])

    def test_anchor_points_duplicados(self, espectro_sintetico):
        x, y = espectro_sintetico
        anchors = [500, 500, 800, 800, 1500, 1750, 1850, 2400, 3500]
        baseline = calcular_baseline(x, y, anchors)
        assert baseline.shape == x.shape

    def test_duplicados_insuficientes_despues_de_dedup(self, espectro_sintetico):
        x, y = espectro_sintetico
        with pytest.raises(ValueError, match="At least 4"):
            calcular_baseline(x, y, [500, 500, 500, 1000])

    def test_anchor_points_fuera_de_rango(self, espectro_sintetico):
        x, y = espectro_sintetico
        with pytest.raises(ValueError, match="outside spectrum range"):
            calcular_baseline(x, y, [100, 500, 1000, 2000])

    def test_anchor_points_fuera_de_rango_superior(self, espectro_sintetico):
        x, y = espectro_sintetico
        with pytest.raises(ValueError, match="outside spectrum range"):
            calcular_baseline(x, y, [500, 1000, 2000, 5000])


# --- calcular_metricas_pico ---

class TestCalcularMetricasPico:
    def test_pico_gaussiano_conocido(self):
        x = np.linspace(1580, 1670, 500)
        altura_real = 0.05
        centro = 1620.0
        sigma = 10.0
        y = altura_real * np.exp(-0.5 * ((x - centro) / sigma) ** 2)

        metricas = calcular_metricas_pico(x, y, (1580, 1670))
        assert abs(metricas["altura"] - altura_real) < 1e-4
        assert abs(metricas["x_pico"] - centro) < 1.0
        area_analitica = altura_real * sigma * np.sqrt(2 * np.pi)
        assert abs(metricas["area"] - area_analitica) / area_analitica < 0.01

    def test_rango_sin_datos(self):
        x = np.linspace(400, 1000, 300)
        y = np.ones_like(x)
        with pytest.raises(ValueError, match="No data points"):
            calcular_metricas_pico(x, y, (2000, 3000))


# --- extraer_experimento_replica ---

class TestExtraerExperimentoReplica:
    def test_nombre_valido(self):
        assert extraer_experimento_replica("Amostra_TCNF_Paul_n_5_3.dpt") == (5, 3)
        assert extraer_experimento_replica("Amostra_TCNF_Paul_n_15_10.dpt") == (15, 10)

    def test_nombre_invalido(self):
        assert extraer_experimento_replica("random_file.dpt") == (None, None)
        assert extraer_experimento_replica("spectrum.csv") == (None, None)


# --- procesar_archivo ---

class TestProcesarArchivo:
    def test_pipeline_completo(self, archivo_dpt_temporal):
        resultado = procesar_archivo(
            archivo_dpt_temporal,
            DEFAULT_ANCHOR_POINTS,
        )
        assert resultado["archivo"] == "Amostra_TCNF_Paul_n_1_1.dpt"
        assert resultado["experimento"] == 1
        assert resultado["replica"] == 1
        assert resultado["altura_carb"] > 0
        assert resultado["area_carb"] > 0
        assert resultado["normalizada"] > 0
        assert resultado["altura_ref"] > 0
        assert 1600 <= resultado["x_pico_carb"] <= 1650


# --- procesar_lote ---

class TestProcesarLote:
    def test_lote_completo(self, archivos_lote_temporal):
        df = procesar_lote(archivos_lote_temporal, DEFAULT_ANCHOR_POINTS)
        assert len(df) == 6  # 3 exp x 2 rep
        assert list(df.columns) == [
            "archivo", "experimento", "replica",
            "altura_carb", "area_carb", "normalizada",
            "altura_ref", "x_pico_carb",
        ]
        assert df["experimento"].nunique() == 3
        assert df["replica"].nunique() == 2

    def test_progress_callback(self, archivos_lote_temporal):
        calls = []
        procesar_lote(
            archivos_lote_temporal,
            DEFAULT_ANCHOR_POINTS,
            progress_callback=lambda done, total: calls.append((done, total)),
        )
        assert len(calls) == 6
        assert calls[-1] == (6, 6)
