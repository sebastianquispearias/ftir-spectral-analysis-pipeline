import numpy as np
import pytest

from backend.config import MIN_ANCHOR_POINTS
from backend.ftir_pipeline import (
    calcular_baseline,
    calcular_metricas_pico,
    cargar_espectro,
    extraer_experimento_replica,
    procesar_archivo,
    procesar_lote,
    suavizar_espectro,
)
from tests.conftest import escribir_dpt, generar_espectro_sintetico


# --- cargar_espectro ---

class TestCargarEspectro:
    def test_carga_y_ordena_ascendente(self, archivo_dpt_temporal):
        x, y = cargar_espectro(archivo_dpt_temporal)
        assert len(x) == len(y)
        assert len(x) > 0
        assert np.all(np.diff(x) >= 0)

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


# --- suavizar_espectro ---

class TestSuavizarEspectro:
    def test_aav_reduce_ruido(self):
        x = np.linspace(0, 100, 1000)
        y_clean = np.sin(x)
        y_noisy = y_clean + np.random.default_rng(42).normal(0, 0.1, 1000)
        y_smooth = suavizar_espectro(y_noisy, metodo="AAV", ventana=5)
        assert len(y_smooth) == len(y_noisy)
        assert np.std(y_smooth - y_clean) < np.std(y_noisy - y_clean)

    def test_todos_metodos(self):
        y = np.random.default_rng(42).normal(0, 1, 200)
        for metodo in ["AAV", "SG", "PF", "FFT", "Binomial"]:
            result = suavizar_espectro(y, metodo=metodo, ventana=5)
            assert len(result) == len(y)

    def test_metodo_invalido(self):
        y = np.ones(100)
        with pytest.raises(ValueError, match="Unknown smoothing method"):
            suavizar_espectro(y, metodo="INVALID", ventana=5)


# --- calcular_baseline (modo automático) ---

class TestCalcularBaselineAuto:
    def test_detecta_valles_e_incluye_endpoints(self, espectro_sintetico):
        x, y = espectro_sintetico
        baseline, anchor_x, anchor_y = calcular_baseline(x, y)
        assert len(baseline) == len(x)
        assert len(anchor_x) >= MIN_ANCHOR_POINTS
        assert len(anchor_x) == len(anchor_y)
        assert float(anchor_x[0]) == float(x[0])
        assert float(anchor_x[-1]) == float(x[-1])

    def test_retorna_tupla_de_3(self, espectro_sintetico):
        x, y = espectro_sintetico
        result = calcular_baseline(x, y)
        assert isinstance(result, tuple)
        assert len(result) == 3

    def test_forma_correcta(self, espectro_sintetico):
        x, y = espectro_sintetico
        baseline, _, _ = calcular_baseline(x, y)
        assert baseline.shape == x.shape

    def test_pocos_valles_error(self):
        x = np.linspace(400, 4000, 100)
        y = np.linspace(0, 1, 100)
        with pytest.raises(ValueError, match="anchor points"):
            calcular_baseline(x, y, prominence=0.5)


# --- calcular_baseline (modo manual) ---

class TestCalcularBaselineManual:
    def test_spline_pasa_por_anchors(self, espectro_sintetico):
        x, y = espectro_sintetico
        custom = [500.0, 1200.0, 1800.0, 2500.0, 3500.0]
        baseline, anchor_x, anchor_y = calcular_baseline(x, y, custom_anchor_points=custom)
        for ax, ay in zip(anchor_x, anchor_y):
            idx = np.argmin(np.abs(x - ax))
            assert abs(baseline[idx] - y[idx]) < 1e-10

    def test_fuera_de_rango(self, espectro_sintetico):
        x, y = espectro_sintetico
        with pytest.raises(ValueError, match="outside spectrum range"):
            calcular_baseline(x, y, custom_anchor_points=[100.0, 500.0, 1000.0, 2000.0])

    def test_pocos_puntos(self, espectro_sintetico):
        x, y = espectro_sintetico
        with pytest.raises(ValueError, match="At least 4"):
            calcular_baseline(x, y, custom_anchor_points=[500.0, 1000.0, 2000.0])

    def test_duplicados_se_deduplican(self, espectro_sintetico):
        x, y = espectro_sintetico
        custom = [500.0, 500.0, 1200.0, 1200.0, 1800.0, 2500.0, 3500.0]
        baseline, anchor_x, _ = calcular_baseline(x, y, custom_anchor_points=custom)
        assert baseline.shape == x.shape
        assert len(anchor_x) == 5


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


# --- procesar_archivo ---

class TestProcesarArchivo:
    def test_pipeline_completo(self, archivo_dpt_temporal):
        resultado = procesar_archivo(archivo_dpt_temporal)
        assert resultado["archivo"] == "Amostra_TCNF_Paul_n_1_1.dpt"
        assert resultado["experimento"] == 1
        assert resultado["replica"] == 1
        assert resultado["altura_carb"] > 0
        assert resultado["area_carb"] > 0
        assert resultado["normalizada"] > 0
        assert resultado["altura_ref"] > 0
        assert 1600 <= resultado["x_pico_carb"] <= 1650
        assert resultado["n_anchor_points"] >= MIN_ANCHOR_POINTS


# --- procesar_lote ---

class TestProcesarLote:
    def test_lote_completo(self, archivos_lote_temporal):
        df = procesar_lote(archivos_lote_temporal)
        assert len(df) == 6
        assert "n_anchor_points" in df.columns
        assert all(df["n_anchor_points"] >= MIN_ANCHOR_POINTS)
        assert df["experimento"].nunique() == 3
        assert df["replica"].nunique() == 2

    def test_progress_callback(self, archivos_lote_temporal):
        calls = []
        procesar_lote(
            archivos_lote_temporal,
            progress_callback=lambda done, total: calls.append((done, total)),
        )
        assert len(calls) == 6
        assert calls[-1] == (6, 6)
