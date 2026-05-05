import numpy as np
import pandas as pd
import pytest

from backend.anova_analysis import (
    construir_matriz_diseno_box_behnken,
    correr_anova_completo,
    preparar_datos_anova,
    superficie_respuesta,
)


class TestMatrizBoxBehnken:
    def test_dimensiones(self):
        df = construir_matriz_diseno_box_behnken()
        assert len(df) == 15
        assert "exp" in df.columns
        assert all(col in df.columns for col in ["X1", "X2", "X3", "temperatura", "tiempo", "naclo"])

    def test_puntos_centrales(self):
        df = construir_matriz_diseno_box_behnken()
        centrales = df[df["exp"].isin([13, 14, 15])]
        assert len(centrales) == 3
        assert all(centrales["X1"] == 0)
        assert all(centrales["X2"] == 0)
        assert all(centrales["X3"] == 0)
        assert all(centrales["temperatura"] == 30)
        assert all(centrales["tiempo"] == 90)
        assert all(centrales["naclo"] == 8.0)

    def test_codificacion(self):
        df = construir_matriz_diseno_box_behnken()
        for col in ["X1", "X2", "X3"]:
            assert set(df[col].unique()).issubset({-1, 0, 1})

    def test_valores_reales(self):
        df = construir_matriz_diseno_box_behnken()
        assert set(df["temperatura"].unique()) == {20, 30, 40}
        assert set(df["tiempo"].unique()) == {60, 90, 120}
        assert set(df["naclo"].unique()) == {6.1, 8.0, 10.0}

    def test_primer_experimento(self):
        df = construir_matriz_diseno_box_behnken()
        exp1 = df[df["exp"] == 1].iloc[0]
        assert exp1["X1"] == -1
        assert exp1["X2"] == -1
        assert exp1["X3"] == 0
        assert exp1["temperatura"] == 20
        assert exp1["tiempo"] == 60
        assert exp1["naclo"] == 8.0


def _generar_resultados_sinteticos(seed: int = 42) -> pd.DataFrame:
    """Generate synthetic results with a known quadratic relationship."""
    rng = np.random.default_rng(seed)
    diseno = construir_matriz_diseno_box_behnken()
    rows = []
    for _, exp_row in diseno.iterrows():
        x1, x2, x3 = exp_row["X1"], exp_row["X2"], exp_row["X3"]
        # Y = 1.0 + 2.0*X1 + 3.0*X2² + 0.5*X3 + noise
        for rep in range(1, 11):
            y = 1.0 + 2.0 * x1 + 3.0 * x2**2 + 0.5 * x3 + rng.normal(0, 0.05)
            rows.append({
                "archivo": f"Amostra_TCNF_Paul_n_{int(exp_row['exp'])}_{rep}.dpt",
                "experimento": int(exp_row["exp"]),
                "replica": rep,
                "altura_carb": y * 0.03,
                "area_carb": y,
                "normalizada": y * 0.27,
                "altura_ref": 0.11,
                "x_pico_carb": 1602.0,
            })
    return pd.DataFrame(rows)


class TestPrepararDatos:
    def test_merge_correcto(self):
        df = _generar_resultados_sinteticos()
        merged = preparar_datos_anova(df)
        assert len(merged) == 150
        assert "X1" in merged.columns
        assert "area_carb" in merged.columns
        assert "experimento" in merged.columns

    def test_valores_razonables(self):
        df = _generar_resultados_sinteticos()
        merged = preparar_datos_anova(df)
        assert all(merged["area_carb"].notna())
        assert merged["area_carb"].std() > 0


class TestAnovaCompleto:
    def test_estructura_resultado(self):
        df = _generar_resultados_sinteticos()
        resultado = correr_anova_completo(df, "area_carb")
        assert "tabla_anova" in resultado
        assert "coeficientes" in resultado
        assert "r_squared" in resultado
        assert "r_squared_adj" in resultado
        assert "p_values" in resultado
        assert "condicion_optima" in resultado
        assert "superficies" in resultado

    def test_detecta_terminos_significativos(self):
        df = _generar_resultados_sinteticos()
        resultado = correr_anova_completo(df, "area_carb")
        sig = resultado["terminos_significativos"]
        assert "X1" in sig, f"X1 should be significant, got: {sig}"

    def test_r_squared_alto(self):
        df = _generar_resultados_sinteticos()
        resultado = correr_anova_completo(df, "area_carb")
        assert resultado["r_squared"] > 0.8

    def test_variable_invalida(self):
        df = _generar_resultados_sinteticos()
        with pytest.raises(ValueError, match="not found"):
            correr_anova_completo(df, "inexistente")

    def test_tres_superficies(self):
        df = _generar_resultados_sinteticos()
        resultado = correr_anova_completo(df, "area_carb")
        assert len(resultado["superficies"]) == 3

    def test_condicion_optima_en_rango(self):
        df = _generar_resultados_sinteticos()
        resultado = correr_anova_completo(df, "area_carb")
        opt = resultado["condicion_optima"]
        assert -1 <= opt["X1"] <= 1
        assert -1 <= opt["X2"] <= 1
        assert -1 <= opt["X3"] <= 1
        assert 20 <= opt["temperatura"] <= 40
        assert 60 <= opt["tiempo"] <= 120


class TestSuperficieRespuesta:
    def test_dimensiones_grid(self):
        df = _generar_resultados_sinteticos()
        resultado = correr_anova_completo(df, "area_carb")
        surf = resultado["superficies"][0]
        assert len(surf["x"]) == 50
        assert len(surf["x"][0]) == 50
        assert len(surf["z"]) == 50
        assert len(surf["z"][0]) == 50
