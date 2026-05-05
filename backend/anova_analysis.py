from __future__ import annotations

import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy.optimize import minimize
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
    """Merge individual replicas with design matrix (no averaging)."""
    diseno = construir_matriz_diseno_box_behnken()
    merged = diseno.merge(
        df_resultados, left_on="exp", right_on="experimento", how="inner",
    )
    return merged


def correr_anova_completo(
    df_resultados: pd.DataFrame,
    variable_respuesta: str = "area_carb",
    maximize: bool = True,
) -> dict:
    """Fit a full quadratic model on individual replicas.

    Uses all replicas (e.g. 150 observations for 15 experiments × 10 reps)
    instead of experiment means, giving more degrees of freedom and the
    ability to separate pure error from lack of fit.
    """
    datos = preparar_datos_anova(df_resultados)

    if variable_respuesta not in datos.columns:
        raise ValueError(f"Column '{variable_respuesta}' not found. Available: {list(datos.columns)}")

    datos = datos.rename(columns={variable_respuesta: "Y"})
    datos_valid = datos.dropna(subset=["Y"])

    n_experiments = datos_valid["exp"].nunique()
    if n_experiments < 10:
        present = sorted(datos_valid["exp"].unique().tolist())
        raise ValueError(
            f"ANOVA requires data from at least 10 of the 15 experiments "
            f"(full quadratic model has 10 parameters). "
            f"Currently only {n_experiments} experiment(s) have data: {present}. "
            f"Upload the remaining experiment files and re-process."
        )

    formula = "Y ~ X1 + X2 + X3 + I(X1**2) + I(X2**2) + I(X3**2) + X1:X2 + X1:X3 + X2:X3"
    modelo = ols(formula, data=datos_valid).fit()
    tabla_anova = sm.stats.anova_lm(modelo, typ=2)

    coeficientes = {name: float(val) for name, val in modelo.params.items()}
    p_values = {name: float(val) for name, val in modelo.pvalues.items()}
    terminos_significativos = [name for name, p in p_values.items() if p < 0.05 and name != "Intercept"]

    condicion_optima = _calcular_optimo(modelo, maximize=maximize)

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


def _calcular_optimo(modelo, maximize: bool = True) -> dict[str, float]:
    """Find optimal conditions via bounded optimization (L-BFGS-B)."""
    def objective(x):
        pred = float(modelo.predict(
            pd.DataFrame([{"X1": x[0], "X2": x[1], "X3": x[2]}])
        ).iloc[0])
        return -pred if maximize else pred

    starts = [
        (0, 0, 0), (1, 1, 1), (-1, -1, -1), (1, -1, 1), (-1, 1, -1),
        (-1, -1, 1), (1, 1, -1), (1, -1, -1), (-1, 1, 1),
    ]
    best = None
    for x0 in starts:
        res = minimize(objective, x0=x0, bounds=[(-1, 1)] * 3, method="L-BFGS-B")
        if best is None or res.fun < best.fun:
            best = res

    x_opt = best.x
    y_opt = -best.fun if maximize else best.fun

    return {
        "X1": float(x_opt[0]),
        "X2": float(x_opt[1]),
        "X3": float(x_opt[2]),
        "temperatura": float(30 + 10 * x_opt[0]),
        "tiempo": float(90 + 30 * x_opt[1]),
        "naclo": float(8.0 + 1.95 * x_opt[2]),
        "predicted_y": y_opt,
        "objective": "maximize" if maximize else "minimize",
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
