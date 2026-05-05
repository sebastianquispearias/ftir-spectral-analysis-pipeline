const PLOT_COLORS = {
  original: "#6366f1",
  baseline: "#f59e0b",
  corrected: "#10b981",
  anchor: "#ef4444",
};

const PLOTLY_CONFIG = {
  responsive: true,
  displaylogo: false,
  toImageButtonOptions: { format: "png", height: 800, width: 1200, scale: 2 },
};

const PLOT_LAYOUT_BASE = {
  font: { family: "Inter, system-ui, sans-serif", size: 12 },
  paper_bgcolor: "transparent",
  plot_bgcolor: "#f8fafc",
  margin: { t: 40, r: 30, b: 50, l: 60 },
  // X-axis ascending (low to high cm-1) to match the researcher's
  // Origin workflow and PPT figures. Note: many FTIR publications use
  // descending convention, but this project follows the user's preference.
  xaxis: {
    title: "Wavenumber (cm⁻¹)",
    gridcolor: "#e2e8f0",
  },
  yaxis: { title: "Absorbance", gridcolor: "#e2e8f0" },
  hovermode: "closest",
};

let ANCHOR_TRACE_IDX = 3;

function plotBaselinePreview(divId, data, titleText) {
  const traces = [
    {
      x: data.x,
      y: data.y_original,
      type: "scatter",
      mode: "lines",
      name: "Original",
      line: { color: PLOT_COLORS.original, width: 1.5 },
      opacity: data.y_smoothed ? 0.35 : 1,
    },
  ];

  if (data.y_smoothed) {
    traces.push({
      x: data.x,
      y: data.y_smoothed,
      type: "scatter",
      mode: "lines",
      name: "Smoothed",
      line: { color: "#8b5cf6", width: 1.5 },
    });
  }

  traces.push(
    {
      x: data.x,
      y: data.y_baseline,
      type: "scatter",
      mode: "lines",
      name: "Baseline",
      line: { color: PLOT_COLORS.baseline, width: 2, dash: "dash" },
    },
    {
      x: data.x,
      y: data.y_corregido,
      type: "scatter",
      mode: "lines",
      name: "Corrected",
      line: { color: PLOT_COLORS.corrected, width: 1.5 },
      visible: "legendonly",
    },
  );

  ANCHOR_TRACE_IDX = traces.length;
  traces.push({
    x: data.anchor_x || [],
    y: data.anchor_y || [],
    type: "scatter",
    mode: "markers",
    name: `Anchors (${data.n_anchor_points})`,
    marker: {
      color: PLOT_COLORS.anchor,
      size: 10,
      symbol: "diamond",
      line: { color: "white", width: 1.5 },
    },
    hovertemplate: "%{x:.1f} cm⁻¹<extra></extra>",
  });

  const layout = {
    ...PLOT_LAYOUT_BASE,
    title: { text: titleText || "", font: { size: 11, color: "#64748b" } },
    showlegend: true,
    legend: { x: 0.01, y: 0.99, bgcolor: "rgba(255,255,255,0.8)" },
    dragmode: false,
  };

  Plotly.newPlot(divId, traces, layout, {
    ...PLOTLY_CONFIG,
    scrollZoom: true,
    modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d"],
  });
}

function pixelToDataX(plotEl, clientX) {
  const xaxis = plotEl._fullLayout.xaxis;
  const drag = plotEl.querySelector(".draglayer");
  if (!drag) return null;
  const rect = drag.getBoundingClientRect();
  const frac = (clientX - rect.left) / rect.width;
  const r = xaxis.range;
  return r[0] + frac * (r[1] - r[0]);
}

function findNearestAnchorInPixels(plotEl, clientX, clientY, anchorsX, anchorsY) {
  const xaxis = plotEl._fullLayout.xaxis;
  const yaxis = plotEl._fullLayout.yaxis;
  const drag = plotEl.querySelector(".draglayer");
  if (!drag || !anchorsX || anchorsX.length === 0) return -1;
  const rect = drag.getBoundingClientRect();

  let best = -1;
  let minDist = Infinity;

  for (let i = 0; i < anchorsX.length; i++) {
    const fracX = (anchorsX[i] - xaxis.range[0]) / (xaxis.range[1] - xaxis.range[0]);
    const fracY = (anchorsY[i] - yaxis.range[0]) / (yaxis.range[1] - yaxis.range[0]);
    const px = rect.left + fracX * rect.width;
    const py = rect.bottom - fracY * rect.height;
    const dist = Math.sqrt((clientX - px) ** 2 + (clientY - py) ** 2);
    if (dist < minDist) {
      minDist = dist;
      best = i;
    }
  }

  return minDist < 20 ? best : -1;
}

function updateAnchorMarker(plotEl, anchorsX, anchorsY) {
  Plotly.restyle(plotEl, { x: [anchorsX], y: [anchorsY] }, [ANCHOR_TRACE_IDX]);
}

function plotResultsBoxplot(divId, resultados, variable = "area_carb") {
  const labels = {
    area_carb: "Integrated Area (Carboxylate)",
    altura_carb: "Peak Height (Carboxylate)",
    normalizada: "Normalized Intensity",
  };

  const experiments = [...new Set(resultados.map((r) => r.experimento))].sort(
    (a, b) => a - b
  );

  const traces = experiments.map((exp) => ({
    y: resultados.filter((r) => r.experimento === exp).map((r) => r[variable]),
    type: "box",
    name: `Exp ${exp}`,
    marker: { color: PLOT_COLORS.original },
  }));

  const layout = {
    ...PLOT_LAYOUT_BASE,
    title: { text: labels[variable] || variable, font: { size: 14 } },
    xaxis: { title: "Experiment", gridcolor: "#e2e8f0", autorange: true },
    yaxis: { title: labels[variable] || variable, gridcolor: "#e2e8f0" },
    showlegend: false,
  };
  Plotly.newPlot(divId, traces, layout, PLOTLY_CONFIG);
}

const FACTOR_REAL = {
  "Temperatura (°C)": { center: 30, half: 10 },
  "Tiempo (min)": { center: 90, half: 30 },
  "NaClO (mL)": { center: 8.0, half: 1.95 },
};

const FACTOR_CODED_KEY = {
  "Temperatura (°C)": "X1",
  "Tiempo (min)": "X2",
  "NaClO (mL)": "X3",
};

function _toReal(grid, label) {
  const f = FACTOR_REAL[label];
  if (!f) return grid;
  return grid.map((row) => row.map((v) => f.center + f.half * v));
}

function _codedToReal(codedVal, label) {
  const f = FACTOR_REAL[label];
  return f ? f.center + f.half * codedVal : codedVal;
}

function _fixedLabel(surfaceData) {
  const fijo = surfaceData.factor_fijo;
  const labels = { X1: "Temp", X2: "Time", X3: "NaClO" };
  const units = { X1: " °C", X2: " min", X3: " mL" };
  const coded = surfaceData.valor_fijo;
  const f = FACTOR_REAL[Object.keys(FACTOR_CODED_KEY).find((k) => FACTOR_CODED_KEY[k] === fijo)];
  const realVal = f ? (f.center + f.half * coded).toFixed(1) : coded;
  return `${labels[fijo] || fijo}=${realVal}${units[fijo] || ""}`;
}

function plotSurface(divId, surfaceData, optimo, mode) {
  const xReal = _toReal(surfaceData.x, surfaceData.x_label);
  const yReal = _toReal(surfaceData.y, surfaceData.y_label);

  const title = `${surfaceData.x_label} vs ${surfaceData.y_label} (${_fixedLabel(surfaceData)})`;

  if (mode === "2d") {
    const trace = {
      x: xReal[0],
      y: yReal.map((row) => row[0]),
      z: surfaceData.z,
      type: "contour",
      colorscale: "Viridis",
      contours: { coloring: "heatmap" },
      line: { smoothing: 0.85 },
    };
    const traces = [trace];

    if (optimo) {
      const xKey = FACTOR_CODED_KEY[surfaceData.x_label];
      const yKey = FACTOR_CODED_KEY[surfaceData.y_label];
      if (xKey && yKey && optimo[xKey] !== undefined) {
        traces.push({
          x: [_codedToReal(optimo[xKey], surfaceData.x_label)],
          y: [_codedToReal(optimo[yKey], surfaceData.y_label)],
          type: "scatter",
          mode: "markers",
          marker: { color: "#ef4444", size: 12, symbol: "x", line: { color: "white", width: 2 } },
          name: "Optimum",
          showlegend: false,
        });
      }
    }

    const layout = {
      font: { family: "Inter, system-ui, sans-serif", size: 11 },
      paper_bgcolor: "transparent",
      margin: { t: 40, r: 20, b: 60, l: 70 },
      title: { text: title, font: { size: 12 } },
      xaxis: { title: surfaceData.x_label, automargin: true },
      yaxis: { title: surfaceData.y_label, automargin: true },
    };
    const el = document.getElementById(divId);
    Plotly.newPlot(el, traces, layout, PLOTLY_CONFIG);
    requestAnimationFrame(() => Plotly.Plots.resize(el));
    return;
  }

  const surfaceTrace = {
    x: xReal,
    y: yReal,
    z: surfaceData.z,
    type: "surface",
    colorscale: "Viridis",
    contours: { z: { show: true, usecolormap: true, highlightcolor: "#fff" } },
  };
  const traces = [surfaceTrace];

  if (optimo) {
    const xKey = FACTOR_CODED_KEY[surfaceData.x_label];
    const yKey = FACTOR_CODED_KEY[surfaceData.y_label];
    if (xKey && yKey && optimo[xKey] !== undefined) {
      traces.push({
        x: [_codedToReal(optimo[xKey], surfaceData.x_label)],
        y: [_codedToReal(optimo[yKey], surfaceData.y_label)],
        z: [optimo.predicted_y || 0],
        type: "scatter3d",
        mode: "markers",
        marker: { color: "#ef4444", size: 6, symbol: "diamond",
                  line: { color: "white", width: 1 } },
        name: "Optimum",
        showlegend: false,
      });
    }
  }

  const layout = {
    font: { family: "Inter, system-ui, sans-serif", size: 11 },
    paper_bgcolor: "transparent",
    margin: { t: 50, r: 50, b: 50, l: 50 },
    title: { text: title, font: { size: 12 } },
    scene: {
      xaxis: { title: { text: surfaceData.x_label }, automargin: true },
      yaxis: { title: { text: surfaceData.y_label }, automargin: true },
      zaxis: { title: { text: surfaceData.z_label }, automargin: true },
    },
  };
  const el = document.getElementById(divId);
  Plotly.newPlot(el, traces, layout, PLOTLY_CONFIG);
  requestAnimationFrame(() => Plotly.Plots.resize(el));
}

function plotQQ(divId, residuals) {
  const sorted = [...residuals].sort((a, b) => a - b);
  const n = sorted.length;
  const theoretical = sorted.map((_, i) => {
    const p = (i + 0.5) / n;
    return _qnorm(p);
  });

  const trace = {
    x: theoretical, y: sorted,
    type: "scatter", mode: "markers",
    marker: { color: PLOT_COLORS.original, size: 4 },
  };
  const minV = Math.min(...theoretical);
  const maxV = Math.max(...theoretical);
  const refLine = {
    x: [minV, maxV], y: [minV * _std(residuals), maxV * _std(residuals)],
    type: "scatter", mode: "lines",
    line: { color: "#ef4444", dash: "dash", width: 1.5 },
  };

  const layout = {
    font: { family: "Inter, system-ui, sans-serif", size: 12 },
    paper_bgcolor: "transparent",
    plot_bgcolor: "#f8fafc",
    margin: { t: 36, r: 16, b: 44, l: 50 },
    title: { text: "Normal Q-Q Plot", font: { size: 12 } },
    xaxis: { title: "Theoretical Quantiles", gridcolor: "#e2e8f0", automargin: true },
    yaxis: { title: "Residuals", gridcolor: "#e2e8f0", automargin: true },
    showlegend: false,
    autosize: true,
  };
  const el = document.getElementById(divId);
  Plotly.newPlot(el, [trace, refLine], layout, PLOTLY_CONFIG);
  requestAnimationFrame(() => Plotly.Plots.resize(el));
}

function plotResidualsVsPredicted(divId, residuals, predicted) {
  const trace = {
    x: predicted, y: residuals,
    type: "scatter", mode: "markers",
    marker: { color: PLOT_COLORS.original, size: 4 },
  };
  const zeroLine = {
    x: [Math.min(...predicted), Math.max(...predicted)],
    y: [0, 0],
    type: "scatter", mode: "lines",
    line: { color: "#ef4444", dash: "dash", width: 1.5 },
  };

  const layout = {
    font: { family: "Inter, system-ui, sans-serif", size: 12 },
    paper_bgcolor: "transparent",
    plot_bgcolor: "#f8fafc",
    margin: { t: 36, r: 16, b: 44, l: 50 },
    title: { text: "Residuals vs Predicted", font: { size: 12 } },
    xaxis: { title: "Predicted Values", gridcolor: "#e2e8f0", automargin: true },
    yaxis: { title: "Residuals", gridcolor: "#e2e8f0", automargin: true },
    showlegend: false,
    autosize: true,
  };
  const el = document.getElementById(divId);
  Plotly.newPlot(el, [trace, zeroLine], layout, PLOTLY_CONFIG);
  requestAnimationFrame(() => Plotly.Plots.resize(el));
}

function _qnorm(p) {
  const a1 = -3.969683028665376e+01, a2 = 2.209460984245205e+02;
  const a3 = -2.759285104469687e+02, a4 = 1.383577518672690e+02;
  const a5 = -3.066479806614716e+01, a6 = 2.506628277459239e+00;
  const b1 = -5.447609879822406e+01, b2 = 1.615858368580409e+02;
  const b3 = -1.556989798598866e+02, b4 = 6.680131188771972e+01;
  const b5 = -1.328068155288572e+01;
  const c1 = -7.784894002430293e-03, c2 = -3.223964580411365e-01;
  const c3 = -2.400758277161838e+00, c4 = -2.549732539343734e+00;
  const c5 = 4.374664141464968e+00, c6 = 2.938163982698783e+00;
  const d1 = 7.784695709041462e-03, d2 = 3.224671290700398e-01;
  const d3 = 2.445134137142996e+00, d4 = 3.754408661907416e+00;
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q, r;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c1*q+c2)*q+c3)*q+c4)*q+c5)*q+c6) / ((((d1*q+d2)*q+d3)*q+d4)*q+1);
  } else if (p <= pHigh) {
    q = p - 0.5; r = q * q;
    return (((((a1*r+a2)*r+a3)*r+a4)*r+a5)*r+a6)*q / (((((b1*r+b2)*r+b3)*r+b4)*r+b5)*r+1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c1*q+c2)*q+c3)*q+c4)*q+c5)*q+c6) / ((((d1*q+d2)*q+d3)*q+d4)*q+1);
  }
}

function _std(arr) {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
}
