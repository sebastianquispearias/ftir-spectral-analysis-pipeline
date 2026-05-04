from __future__ import annotations

import numpy as np
import pandas as pd
import statsmodels.api as sm
from statsmodels.formula.api import ols


def construir_matriz_diseno_box_behnken() -> pd.DataFrame:
    # Source: Mario PPT slide 4, "Box-Behnken design com 3 fatores", validated 2026-05-04
    data = {
        "exp": list(range(1, 16)),
        "X1": [-1, 1, -1, 1, -1, 1, -1, 1, 0, 0, 0, 0, 0, 0, 0],
        "X2": [-1, -1, 1, 1, 0, 0, 0, 0, -1, 1, -1, 1, 0, 0, 0],
        "X3": [0, 0, 0, 0, -1, -1, 1, 1, -1, -1, 1, 1, 0, 0, 0],
        "temperatura": [20, 40, 20, 40, 20, 40, 20, 40, 30, 30, 30, 30, 30, 30, 30],
        "tiempo": [60, 60, 120, 120, 90, 90, 90, 90, 60, 120, 60, 120, 90, 90, 90],
        "naclo": [8.0, 8.0, 8.0, 8.0, 6.1, 6.1, 10.0, 10.0, 6.1, 6.1, 10.0, 10.0, 8.0, 8.0, 8.0],
    }
    return pd.DataFrame(data)


def preparar_datos_anova(df_resultados: pd.DataFrame) -> pd.DataFrame:
    """Aggregate replicas by experiment (mean, std) and merge with design matrix."""
    metricas = ["altura_carb", "area_carb", "normalizada", "altura_ref"]

    agg_dict: dict[str, list[str]] = {m: ["mean", "std"] for m in metricas if m in df_resultados.columns}
    resumen = df_resultados.groupby("experimento").agg(agg_dict)
    resumen.columns = [f"{col}_{stat}" for col, stat in resumen.columns]
    resumen = resumen.reset_index()

    diseno = construir_matriz_diseno_box_behnken()
    merged = diseno.merge(resumen, left_on="exp", right_on="experimento", how="left")
    return merged


def correr_anova_completo(
    df_resultados: pd.DataFrame,
    variable_respuesta: str = "area_carb",
) -> dict:
    """Fit a full quadratic model on the 15 experiment means.

    Model fitted on per-experiment means (n=15), not individual replicas.
    TODO: consider model with 150 individual replicas and experiment
    as a blocking factor in a future iteration.
    """
    datos = preparar_datos_anova(df_resultados)
    col_media = f"{variable_respuesta}_mean"

    if col_media not in datos.columns:
        raise ValueError(f"Column '{col_media}' not found. Available: {list(datos.columns)}")

    datos = datos.rename(columns={col_media: "Y"})
    datos_valid = datos.dropna(subset=["Y"])

    n_exp = len(datos_valid)
    if n_exp < 10:
        present = datos_valid["exp"].tolist()
        raise ValueError(
            f"ANOVA requires data from at least 10 of the 15 experiments "
            f"(full quadratic model has 10 parameters). "
            f"Currently only {n_exp} experiment(s) have data: {present}. "
            f"Upload the remaining experiment files and re-process."
        )

    formula = "Y ~ X1 + X2 + X3 + I(X1**2) + I(X2**2) + I(X3**2) + X1:X2 + X1:X3 + X2:X3"
    modelo = ols(formula, data=datos_valid).fit()
    tabla_anova = sm.stats.anova_lm(modelo, typ=2)

    coeficientes = {name: float(val) for name, val in modelo.params.items()}
    p_values = {name: float(val) for name, val in modelo.pvalues.items()}
    terminos_significativos = [name for name, p in p_values.items() if p < 0.05 and name != "Intercept"]

    condicion_optima = _calcular_optimo(modelo)

    tabla_dict = {
        "fuente": tabla_anova.index.tolist(),
        "sum_sq": tabla_anova["sum_sq"].tolist(),
        "df": tabla_anova["df"].tolist(),
        "F": tabla_anova["F"].tolist(),
        "PR(>F)": tabla_anova["PR(>F)"].tolist(),
    }

    superficies = _generar_todas_superficies(modelo, variable_respuesta)

    return {
        "tabla_anova": tabla_dict,
        "coeficientes": coeficientes,
        "r_squared": float(modelo.rsquared),
        "r_squared_adj": float(modelo.rsquared_adj),
        "p_values": p_values,
        "modelo_significativo": bool(modelo.f_pvalue < 0.05),
        "terminos_significativos": terminos_significativos,
        "condicion_optima": condicion_optima,
        "superficies": superficies,
    }


def superficie_respuesta(
    modelo,
    factor_fijo: dict[str, float],
    factor_x: str,
    factor_y: str,
) -> dict:
    """Generate response surface grid data for a pair of factors."""
    grid_size = 50
    x_vals = np.linspace(-1, 1, grid_size)
    y_vals = np.linspace(-1, 1, grid_size)
    x_grid, y_grid = np.meshgrid(x_vals, y_vals)

    prediction_data = []
    for i in range(grid_size):
        for j in range(grid_size):
            row = {**factor_fijo, factor_x: x_grid[i, j], factor_y: y_grid[i, j]}
            prediction_data.append(row)

    pred_df = pd.DataFrame(prediction_data)
    z_flat = modelo.predict(pred_df)
    z_grid = z_flat.values.reshape(grid_size, grid_size)

    factor_labels = {
        "X1": "Temperatura (°C)",
        "X2": "Tiempo (min)",
        "X3": "NaClO (mL)",
    }

    return {
        "x": x_grid.tolist(),
        "y": y_grid.tolist(),
        "z": z_grid.tolist(),
        "x_label": factor_labels.get(factor_x, factor_x),
        "y_label": factor_labels.get(factor_y, factor_y),
    }


def _calcular_optimo(modelo) -> dict[str, float]:
    """Estimate optimal conditions from the quadratic model gradient."""
    params = modelo.params

    b = np.array([
        params.get("X1", 0),
        params.get("X2", 0),
        params.get("X3", 0),
    ])

    B = np.array([
        [params.get("I(X1 ** 2)", 0), params.get("X1:X2", 0) / 2, params.get("X1:X3", 0) / 2],
        [params.get("X1:X2", 0) / 2, params.get("I(X2 ** 2)", 0), params.get("X2:X3", 0) / 2],
        [params.get("X1:X3", 0) / 2, params.get("X2:X3", 0) / 2, params.get("I(X3 ** 2)", 0)],
    ])

    try:
        x_opt = -0.5 * np.linalg.solve(B, b)
    except np.linalg.LinAlgError:
        x_opt = np.array([0.0, 0.0, 0.0])

    x_opt = np.clip(x_opt, -1, 1)

    return {
        "X1": float(x_opt[0]),
        "X2": float(x_opt[1]),
        "X3": float(x_opt[2]),
        "temperatura": float(30 + 10 * x_opt[0]),
        "tiempo": float(90 + 30 * x_opt[1]),
        "naclo": float(8.0 + 1.95 * x_opt[2]),
    }


def _generar_todas_superficies(modelo, variable_respuesta: str) -> list[dict]:
    """Generate response surfaces for all three factor pairs."""
    pairs = [
        ("X1", "X2", {"X3": 0}),
        ("X1", "X3", {"X2": 0}),
        ("X2", "X3", {"X1": 0}),
    ]

    superficies = []
    for fx, fy, fijo in pairs:
        surf = superficie_respuesta(modelo, fijo, fx, fy)
        fijo_key = list(fijo.keys())[0]
        surf["z_label"] = variable_respuesta
        surf["factor_fijo"] = fijo_key
        surf["valor_fijo"] = fijo[fijo_key]
        superficies.append(surf)

    return superficies
