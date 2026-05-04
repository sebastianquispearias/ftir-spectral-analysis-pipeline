const PLOT_COLORS = {
  original: "#6366f1",
  baseline: "#f59e0b",
  corrected: "#10b981",
  anchor: "#ef4444",
  anchorHover: "#dc2626",
};

const PLOT_LAYOUT_BASE = {
  font: { family: "Inter, system-ui, sans-serif", size: 12 },
  paper_bgcolor: "transparent",
  plot_bgcolor: "#f8fafc",
  margin: { t: 40, r: 30, b: 50, l: 60 },
  xaxis: {
    title: "Wavenumber (cm⁻¹)",
    gridcolor: "#e2e8f0",
    autorange: "reversed",
  },
  yaxis: { title: "Absorbance", gridcolor: "#e2e8f0" },
  hovermode: "x unified",
};

function plotSpectrum(divId, x, y, title = "Spectrum") {
  const trace = {
    x,
    y,
    type: "scatter",
    mode: "lines",
    name: "Original",
    line: { color: PLOT_COLORS.original, width: 1.5 },
  };
  const layout = {
    ...PLOT_LAYOUT_BASE,
    title: { text: title, font: { size: 14 } },
  };
  Plotly.newPlot(divId, [trace], layout, { responsive: true });
}

function plotBaselinePreview(divId, data, anchorPoints, onClickCallback) {
  const traces = [
    {
      x: data.x,
      y: data.y_original,
      type: "scatter",
      mode: "lines",
      name: "Original",
      line: { color: PLOT_COLORS.original, width: 1.5 },
    },
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
  ];

  if (anchorPoints && anchorPoints.length > 0) {
    const apY = anchorPoints.map((ap) => {
      const idx = data.x.reduce(
        (best, val, i) =>
          Math.abs(val - ap) < Math.abs(data.x[best] - ap) ? i : best,
        0
      );
      return data.y_original[idx];
    });
    traces.push({
      x: anchorPoints,
      y: apY,
      type: "scatter",
      mode: "markers",
      name: "Anchor Points",
      marker: { color: PLOT_COLORS.anchor, size: 11, symbol: "diamond",
                line: { color: "white", width: 1.5 } },
      hovertemplate: "%{x:.1f} cm⁻¹<extra>Click to remove</extra>",
    });
  }

  const layout = {
    ...PLOT_LAYOUT_BASE,
    title: { text: "Click on spectrum to add anchor points • Click a diamond to remove",
             font: { size: 12, color: "#64748b" } },
    showlegend: true,
    legend: { x: 0.01, y: 0.99, bgcolor: "rgba(255,255,255,0.8)" },
    dragmode: "zoom",
  };

  Plotly.newPlot(divId, traces, layout, { responsive: true, scrollZoom: true });

  if (onClickCallback) {
    const plotEl = document.getElementById(divId);
    plotEl.removeAllListeners?.("plotly_click");
    plotEl.on("plotly_click", (eventData) => {
      if (!eventData.points || eventData.points.length === 0) return;
      const point = eventData.points[0];
      const isAnchorTrace = point.data.name === "Anchor Points";
      const xVal = point.x;
      onClickCallback(xVal, isAnchorTrace);
    });
  }
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

  const traces = experiments.map((exp) => {
    const vals = resultados
      .filter((r) => r.experimento === exp)
      .map((r) => r[variable]);
    return {
      y: vals,
      type: "box",
      name: `Exp ${exp}`,
      marker: { color: PLOT_COLORS.original },
    };
  });

  const layout = {
    ...PLOT_LAYOUT_BASE,
    title: { text: labels[variable] || variable, font: { size: 14 } },
    xaxis: { title: "Experiment", gridcolor: "#e2e8f0", autorange: true },
    yaxis: { title: labels[variable] || variable, gridcolor: "#e2e8f0" },
    showlegend: false,
  };
  Plotly.newPlot(divId, traces, layout, { responsive: true });
}

function plotSurface(divId, surfaceData) {
  const trace = {
    x: surfaceData.x,
    y: surfaceData.y,
    z: surfaceData.z,
    type: "surface",
    colorscale: "Viridis",
    contours: { z: { show: true, usecolormap: true, highlightcolor: "#fff" } },
  };
  const layout = {
    font: { family: "Inter, system-ui, sans-serif", size: 11 },
    paper_bgcolor: "transparent",
    margin: { t: 40, r: 10, b: 10, l: 10 },
    title: {
      text: `${surfaceData.x_label} vs ${surfaceData.y_label} (${surfaceData.factor_fijo}=${surfaceData.valor_fijo})`,
      font: { size: 13 },
    },
    scene: {
      xaxis: { title: surfaceData.x_label },
      yaxis: { title: surfaceData.y_label },
      zaxis: { title: surfaceData.z_label },
    },
  };
  Plotly.newPlot(divId, [trace], layout, { responsive: true });
}
