const PLOT_COLORS = {
  original: "#6366f1",
  baseline: "#f59e0b",
  corrected: "#10b981",
  anchor: "#ef4444",
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
    responsive: true,
    scrollZoom: true,
    modeBarButtonsToRemove: ["select2d", "lasso2d", "autoScale2d"],
    displaylogo: false,
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
  Plotly.newPlot(divId, traces, layout, { responsive: true });
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
  const realVals = { X1: "30 °C", X2: "90 min", X3: "8.0 mL" };
  return `${labels[fijo] || fijo}=${realVals[fijo] || surfaceData.valor_fijo}`;
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
      margin: { t: 40, r: 20, b: 50, l: 60 },
      title: { text: title, font: { size: 13 } },
      xaxis: { title: surfaceData.x_label },
      yaxis: { title: surfaceData.y_label },
    };
    Plotly.newPlot(divId, traces, layout, { responsive: true });
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
    margin: { t: 40, r: 10, b: 10, l: 10 },
    title: { text: title, font: { size: 13 } },
    scene: {
      xaxis: { title: surfaceData.x_label },
      yaxis: { title: surfaceData.y_label },
      zaxis: { title: surfaceData.z_label },
    },
  };
  Plotly.newPlot(divId, traces, layout, { responsive: true });
}
