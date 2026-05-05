const state = {
  files: [],
  previewFileId: null,
  mode: "auto",
  tool: "move",
  customAnchors: null,
  undoStack: [],
  dragging: null,
  spectrumData: null,
  resultados: null,
  anovaData: null,
};

let _debounceTimer = null;
const $ = (sel) => document.querySelector(sel);
function revealSection(id) { $(id).classList.remove("hidden"); }

// --- Tool selection ---
function setTool(name) {
  state.tool = name;
  ["add", "move", "remove"].forEach((t) => {
    $(`#tool-${t}`).classList.toggle("tool-active", t === name);
  });
  updateCursor();
}

function updateCursor() {
  const plot = document.getElementById("baseline-plot");
  if (!plot) return;
  plot.classList.remove("cursor-add", "cursor-move", "cursor-remove");
  plot.classList.add(`cursor-${state.tool}`);
}

// --- Config ---
function getBaselineConfig() {
  const smoothing = $("#cfg-apply-smoothing").checked;
  if (state.mode === "manual" && state.customAnchors) {
    return {
      custom_anchor_points: state.customAnchors,
      apply_spectrum_smoothing: smoothing,
      metodo_suavizado: $("#cfg-method").value,
      ventana_suavizado: parseInt($("#cfg-window").value),
    };
  }
  return {
    metodo_suavizado: $("#cfg-method").value,
    ventana_suavizado: parseInt($("#cfg-window").value),
    distance: parseInt($("#cfg-distance").value),
    prominence: parseFloat(Math.pow(10, parseFloat($("#cfg-prominence").value)).toFixed(5)),
    apply_spectrum_smoothing: smoothing,
  };
}

function setMode(mode) {
  state.mode = mode;
  const badge = $("#mode-badge");
  if (mode === "auto") {
    badge.textContent = "Auto";
    badge.className = "text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium";
  } else {
    badge.textContent = "Manual";
    badge.className = "text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium";
  }
}

function pushUndo() {
  if (state.customAnchors) {
    state.undoStack.push([...state.customAnchors]);
    if (state.undoStack.length > 30) state.undoStack.shift();
  }
}

function handleUndo() {
  if (state.undoStack.length === 0) return;
  state.customAnchors = state.undoStack.pop();
  if (state.customAnchors.length < 4) { handleResetToAuto(); return; }
  setMode("manual");
  loadBaselinePreview();
}

function handleResetToAuto() {
  state.customAnchors = null;
  state.undoStack = [];
  setMode("auto");
  loadBaselinePreview();
}

// --- Upload ---
async function handleFilesSelected(files) {
  const statusEl = $("#upload-status");
  statusEl.textContent = `Uploading ${files.length} file(s)...`;
  statusEl.className = "mt-3 text-sm text-slate-500";
  try {
    const result = await uploadFiles(files);
    state.files.push(...result.archivos);
    renderFileList();
    updatePreviewSelector();
    statusEl.textContent = `${result.count} file(s) uploaded successfully.`;
    statusEl.className = "mt-3 text-sm text-emerald-600";
    revealSection("#section-baseline");
    if (state.files.length > 0 && !state.previewFileId) {
      state.previewFileId = state.files[0].id;
      $("#preview-file-select").value = state.previewFileId;
      await loadBaselinePreview();
    }
  } catch (err) {
    statusEl.textContent = `Upload failed: ${err.message}`;
    statusEl.className = "mt-3 text-sm text-red-600";
  }
}

function renderFileList() {
  const listEl = $("#file-list");
  $("#file-count").textContent = `${state.files.length} file(s)`;
  if (state.files.length === 0) {
    listEl.innerHTML = '<p class="text-slate-400 text-sm">No files uploaded yet.</p>';
    return;
  }
  listEl.innerHTML = state.files.map((f) => `
    <div class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-50 text-sm group">
      <div class="flex items-center gap-2 min-w-0">
        <span class="truncate" title="${f.nombre}">${f.nombre}</span>
        ${f.experimento != null ? `<span class="text-xs text-slate-400">Exp ${f.experimento}, Rep ${f.replica}</span>` : ""}
      </div>
      <button onclick="handleDeleteFile('${f.id}')" class="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">✕</button>
    </div>
  `).join("");
}

async function handleDeleteFile(fileId) {
  try {
    await deleteFile(fileId);
    state.files = state.files.filter((f) => f.id !== fileId);
    renderFileList();
    updatePreviewSelector();
  } catch (err) { alert(`Delete failed: ${err.message}`); }
}

function updatePreviewSelector() {
  const select = $("#preview-file-select");
  select.innerHTML = state.files.map((f) => `<option value="${f.id}">${f.nombre}</option>`).join("");
  if (state.previewFileId) select.value = state.previewFileId;
}

function handlePreviewFileChange(fileId) {
  state.previewFileId = fileId;
  loadBaselinePreview();
}

function handleConfigChange() {
  clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => loadBaselinePreview(), 400);
}

// --- Baseline preview ---
async function loadBaselinePreview() {
  if (!state.previewFileId) return;
  const config = getBaselineConfig();
  try {
    const data = await baselinePreview(state.previewFileId, config);
    state.spectrumData = data;

    if (state.mode === "auto" && data.anchor_x) {
      state.customAnchors = [...data.anchor_x];
    }

    const toolLabel = { add: "Add (A)", move: "Move (M)", remove: "Remove (D)" }[state.tool];
    const smoothLabel = data.smoothing_applied ? " · Smoothed" : "";
    const title = state.mode === "manual"
      ? `Manual · ${data.n_anchor_points} pts · ${toolLabel}${smoothLabel} · Ctrl+Z undo`
      : `Auto · ${data.n_anchor_points} pts${smoothLabel} · click to edit`;

    plotBaselinePreview("baseline-plot", data, title);
    attachPlotListeners();
    updateCursor();
    const smoothTxt = data.smoothing_applied ? " · Smoothing ON" : "";
    $("#anchor-count").textContent = `${data.n_anchor_points} anchor points${smoothTxt}`;
  } catch (err) {
    console.error("Baseline preview failed:", err);
    $("#anchor-count").textContent = `Error: ${err.message}`;
  }
}

// --- Mouse interaction on plot ---
function attachPlotListeners() {
  const plotEl = document.getElementById("baseline-plot");
  const drag = plotEl.querySelector(".draglayer");
  if (!drag) return;

  drag.onmousedown = (e) => {
    if (e.button !== 0) return;
    const xVal = pixelToDataX(plotEl, e.clientX);
    if (xVal === null) return;

    if (state.tool === "add") {
      handleAddAtX(xVal);
    } else if (state.tool === "remove") {
      handleRemoveAtPixel(plotEl, e.clientX, e.clientY);
    } else if (state.tool === "move") {
      const idx = findNearestAnchorInPixels(
        plotEl, e.clientX, e.clientY,
        state.customAnchors,
        getAnchorYValues()
      );
      if (idx >= 0) {
        startDrag(plotEl, idx, e);
      }
    }
  };
}

function getAnchorYValues() {
  if (!state.customAnchors || !state.spectrumData) return [];
  const sx = state.spectrumData.x;
  const sy = state.spectrumData.y_original;
  return state.customAnchors.map((ax) => {
    let best = 0, minD = Infinity;
    for (let i = 0; i < sx.length; i++) {
      const d = Math.abs(sx[i] - ax);
      if (d < minD) { minD = d; best = i; }
    }
    return sy[best];
  });
}

function handleAddAtX(xVal) {
  if (state.mode === "auto") setMode("manual");
  if (!state.customAnchors) state.customAnchors = [];
  const rounded = Math.round(xVal * 10) / 10;
  if (state.customAnchors.some((a) => Math.abs(a - rounded) < 5)) return;
  pushUndo();
  state.customAnchors.push(rounded);
  state.customAnchors.sort((a, b) => a - b);
  loadBaselinePreview().then(() => setTool("move"));
}

function handleRemoveAtPixel(plotEl, clientX, clientY) {
  if (!state.customAnchors) return;
  const idx = findNearestAnchorInPixels(
    plotEl, clientX, clientY,
    state.customAnchors,
    getAnchorYValues()
  );
  if (idx < 0) return;
  if (state.mode === "auto") setMode("manual");
  pushUndo();
  state.customAnchors.splice(idx, 1);
  if (state.customAnchors.length < 4) { handleResetToAuto(); return; }
  loadBaselinePreview();
}

// --- Drag ---
function startDrag(plotEl, anchorIdx, startEvent) {
  if (state.mode === "auto") setMode("manual");
  pushUndo();
  state.dragging = { idx: anchorIdx };
  plotEl.classList.add("cursor-grabbing");

  const onMove = (e) => {
    const xVal = pixelToDataX(plotEl, e.clientX);
    if (xVal === null) return;
    state.customAnchors[anchorIdx] = Math.round(xVal * 10) / 10;
    const yVals = getAnchorYValues();
    updateAnchorMarker(plotEl, [...state.customAnchors], yVals);
  };

  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    plotEl.classList.remove("cursor-grabbing");
    state.dragging = null;
    state.customAnchors.sort((a, b) => a - b);
    loadBaselinePreview();
  };

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

// --- Process ---
async function handleProcess() {
  const btn = $("#btn-process");
  const statusEl = $("#process-status");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Processing...';
  statusEl.textContent = "Processing all files...";
  statusEl.className = "text-sm text-slate-500";
  try {
    const config = getBaselineConfig();
    const result = await processAll(config);
    state.resultados = result.resultados;
    statusEl.textContent = `Done! ${result.total} spectra processed in ${result.tiempo_segundos}s.`;
    statusEl.className = "text-sm text-emerald-600";
    renderResultsTable();
    revealSection("#section-results");
    plotResultsBoxplot("results-plot", state.resultados, "area_carb");
  } catch (err) {
    statusEl.textContent = `Processing failed: ${err.message}`;
    statusEl.className = "text-sm text-red-600";
  } finally {
    btn.disabled = false;
    btn.textContent = "Process All Spectra";
  }
}

// --- Results ---
function renderResultsTable() {
  const tbody = $("#results-tbody");
  if (!state.resultados || state.resultados.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-slate-400">No results yet.</td></tr>';
    return;
  }
  tbody.innerHTML = state.resultados.map((r) => `
    <tr class="hover:bg-slate-50">
      <td class="px-3 py-2 text-sm">${r.archivo}</td>
      <td class="px-3 py-2 text-sm text-center">${r.experimento ?? "-"}</td>
      <td class="px-3 py-2 text-sm text-center">${r.replica ?? "-"}</td>
      <td class="px-3 py-2 text-sm text-right font-mono">${r.altura_carb.toFixed(4)}</td>
      <td class="px-3 py-2 text-sm text-right font-mono">${r.area_carb.toFixed(4)}</td>
      <td class="px-3 py-2 text-sm text-right font-mono">${r.normalizada.toFixed(4)}</td>
    </tr>
  `).join("");
}

function handleVariableChange(v) {
  if (state.resultados) plotResultsBoxplot("results-plot", state.resultados, v);
}

// --- ANOVA ---
async function handleAnova() {
  const btn = $("#btn-anova");
  const variable = $("#anova-variable").value;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Running ANOVA...';
  try {
    const result = await runAnova(variable);
    state.anovaData = result;
    renderAnovaResults(result);
    revealSection("#section-anova");
  } catch (err) { alert(`ANOVA failed: ${err.message}`); }
  finally { btn.disabled = false; btn.textContent = "Run ANOVA"; }
}

function renderAnovaResults(data) {
  $("#anova-r2").textContent = data.r_squared.toFixed(4);
  $("#anova-r2-adj").textContent = data.r_squared_adj.toFixed(4);
  $("#anova-significant").textContent = data.modelo_significativo ? "Yes" : "No";
  $("#anova-significant").className = data.modelo_significativo
    ? "text-2xl font-bold text-emerald-600" : "text-2xl font-bold text-red-600";

  $("#anova-tbody").innerHTML = data.tabla_anova.fuente.map((f, i) => {
    const p = data.tabla_anova["PR(>F)"][i]; const sig = p !== null && p < 0.05;
    return `<tr class="${sig ? "bg-emerald-50" : "hover:bg-slate-50"}">
      <td class="px-3 py-1.5 text-sm">${f}</td>
      <td class="px-3 py-1.5 text-sm text-right font-mono">${data.tabla_anova.sum_sq[i]?.toFixed(6) ?? "-"}</td>
      <td class="px-3 py-1.5 text-sm text-center">${data.tabla_anova.df[i]?.toFixed(0) ?? "-"}</td>
      <td class="px-3 py-1.5 text-sm text-right font-mono">${data.tabla_anova.F[i]?.toFixed(4) ?? "-"}</td>
      <td class="px-3 py-1.5 text-sm text-right font-mono ${sig ? "text-emerald-700 font-semibold" : ""}">${p?.toFixed(6) ?? "-"}</td></tr>`;
  }).join("");

  $("#coef-tbody").innerHTML = Object.entries(data.coeficientes).map(([n, v]) => {
    const p = data.p_values[n]; const sig = p < 0.05;
    return `<tr class="${sig ? "bg-emerald-50" : "hover:bg-slate-50"}">
      <td class="px-3 py-1.5 text-sm">${n}</td>
      <td class="px-3 py-1.5 text-sm text-right font-mono">${v.toFixed(6)}</td>
      <td class="px-3 py-1.5 text-sm text-right font-mono ${sig ? "text-emerald-700 font-semibold" : ""}">${p.toFixed(6)}</td></tr>`;
  }).join("");

  const o = data.condicion_optima;
  $("#optimal-condition").innerHTML = `
    <div class="grid grid-cols-3 gap-4 text-center">
      <div class="p-3 bg-slate-50 rounded-lg"><div class="text-xs text-slate-500 uppercase">Temperature</div><div class="text-lg font-semibold">${o.temperatura.toFixed(1)} °C</div></div>
      <div class="p-3 bg-slate-50 rounded-lg"><div class="text-xs text-slate-500 uppercase">Time</div><div class="text-lg font-semibold">${o.tiempo.toFixed(1)} min</div></div>
      <div class="p-3 bg-slate-50 rounded-lg"><div class="text-xs text-slate-500 uppercase">NaClO</div><div class="text-lg font-semibold">${o.naclo.toFixed(2)} mL</div></div>
    </div>`;

  if (data.superficies && data.superficies.length > 0) {
    const c = $("#surface-plots");
    c.innerHTML = data.superficies.map((_, i) => `<div id="surface-${i}" class="h-96"></div>`).join("");
    data.superficies.forEach((s, i) => plotSurface(`surface-${i}`, s));
  }
}

function handleExportExcel() { window.open(getExcelUrl(), "_blank"); }

// --- Toast ---
function showToast(message, type = "info") {
  const toast = $("#toast");
  const content = $("#toast-content");
  content.textContent = message;
  const colors = {
    info: "bg-slate-800 text-white",
    success: "bg-emerald-600 text-white",
    warning: "bg-amber-500 text-white",
    error: "bg-red-600 text-white",
  };
  content.className = `px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium ${colors[type] || colors.info}`;
  toast.classList.remove("hidden");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add("hidden"), 4000);
}

// --- Export / Import anchor points ---
function handleExportPoints() {
  if (!state.customAnchors || state.customAnchors.length === 0) {
    showToast("No anchor points to export", "warning");
    return;
  }

  const previewFile = state.files.find((f) => f.id === state.previewFileId);
  const filename = previewFile ? previewFile.nombre : "unknown";

  const data = {
    version: "1.0",
    exported_at: new Date().toISOString(),
    spectrum_filename: filename,
    anchor_points_cm: [...state.customAnchors].sort((a, b) => a - b),
    smoothing_config: {
      method: $("#cfg-method").value,
      window: parseInt($("#cfg-window").value),
      apply_spectrum_smoothing: $("#cfg-apply-smoothing").checked,
    },
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safeName = filename.replace(/\.dpt$/i, "").replace(/\s+/g, "_");
  a.href = url;
  a.download = `anchor_points_${safeName}_${ts}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Exported ${data.anchor_points_cm.length} anchor points`, "success");
}

function handleImportPoints(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = "";

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);

      if (!data.anchor_points_cm || !Array.isArray(data.anchor_points_cm)) {
        showToast("Invalid file: missing anchor_points_cm array", "error");
        return;
      }

      if (data.anchor_points_cm.length < 4) {
        showToast("Need at least 4 anchor points", "error");
        return;
      }

      const points = data.anchor_points_cm.map(Number).filter((n) => !isNaN(n));

      if (state.spectrumData) {
        const xMin = Math.min(...state.spectrumData.x);
        const xMax = Math.max(...state.spectrumData.x);
        const outOfRange = points.filter((p) => p < xMin || p > xMax);
        if (outOfRange.length > 0) {
          showToast(
            `Warning: ${outOfRange.length} point(s) outside spectrum range [${xMin.toFixed(0)}-${xMax.toFixed(0)}]`,
            "warning"
          );
        }
      }

      pushUndo();
      state.customAnchors = points.sort((a, b) => a - b);
      setMode("manual");

      if (data.smoothing_config) {
        const sc = data.smoothing_config;
        if (sc.method) $("#cfg-method").value = sc.method;
        if (sc.window) {
          $("#cfg-window").value = sc.window;
          $("#cfg-window-val").textContent = sc.window;
        }
        if (sc.apply_spectrum_smoothing !== undefined) {
          $("#cfg-apply-smoothing").checked = sc.apply_spectrum_smoothing;
        }
      }

      loadBaselinePreview();
      showToast(`Imported ${points.length} anchor points from ${file.name}`, "success");
    } catch (err) {
      showToast(`Import failed: ${err.message}`, "error");
    }
  };
  reader.readAsText(file);
}

// --- Keyboard shortcuts ---
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.key === "a") setTool("add");
  if (e.key === "m") setTool("move");
  if (e.key === "d" || e.key === "r") setTool("remove");
  if (e.ctrlKey && e.key === "z") { e.preventDefault(); handleUndo(); }
});

// --- Init ---
document.addEventListener("DOMContentLoaded", () => {
  initUploadZone($("#drop-zone"), $("#file-input"), handleFilesSelected);
  renderFileList();
});
