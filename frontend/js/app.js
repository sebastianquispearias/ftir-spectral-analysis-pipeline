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
  designConfig: null,
  designEditOpen: false,
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
  const lockBtn = $("#btn-lock");
  if (mode === "auto") {
    badge.textContent = "Auto";
    badge.className = "text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium";
    if (lockBtn) lockBtn.classList.remove("hidden");
  } else {
    badge.textContent = "Manual";
    badge.className = "text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium";
    if (lockBtn) lockBtn.classList.add("hidden");
  }
}

function handleLockAnchors() {
  if (!state.customAnchors || state.customAnchors.length < 4) return;
  pushUndo();
  setMode("manual");
  showToast(`Locked ${state.customAnchors.length} anchor points — smoothing changes won't re-detect`, "success");
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
async function handleFilesSelected(files, meta = {}) {
  const statusEl = $("#upload-status");
  statusEl.textContent = `Uploading ${files.length} file(s)...`;
  statusEl.className = "mt-3 text-sm text-slate-500";
  try {
    const result = await uploadFiles(files);
    state.files.push(...result.archivos);
    renderFileList();
    renderUploadSummary();
    updatePreviewSelector();
    const source = meta.source ? ` from "${meta.source}"` : "";
    const ignoredNote = meta.ignored > 0 ? ` (${meta.ignored} non-.dpt file(s) ignored)` : "";
    statusEl.textContent = `${result.count} .dpt file(s) uploaded${source}.${ignoredNote}`;
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
    renderUploadSummary();
    updatePreviewSelector();
  } catch (err) { alert(`Delete failed: ${err.message}`); }
}

// --- Upload Summary ---
function detectDesign(files) {
  const experiments = [];
  const replicasByExp = {};
  let unrecognized = 0;

  for (const f of files) {
    if (f.experimento == null) { unrecognized++; continue; }
    experiments.push(f.experimento);
    if (!replicasByExp[f.experimento]) replicasByExp[f.experimento] = new Set();
    replicasByExp[f.experimento].add(f.replica);
  }

  const maxExp = experiments.length > 0 ? Math.max(...experiments) : 0;
  const maxRep = experiments.length > 0
    ? Math.max(...Object.values(replicasByExp).map((s) => s.size))
    : 0;

  const detected = { totalExperiments: maxExp, expectedReplicas: maxRep };

  if (!state.designConfig || state.designConfig.source === "auto") {
    state.designConfig = { ...detected, source: "auto" };
    _saveDesignConfig();
  }

  return { replicasByExp, unrecognized, detected };
}

function _saveDesignConfig() {
  if (state.designConfig) {
    sessionStorage.setItem("ftir_designConfig", JSON.stringify(state.designConfig));
  }
}

function _loadDesignConfig() {
  const raw = sessionStorage.getItem("ftir_designConfig");
  if (raw) {
    try { state.designConfig = JSON.parse(raw); } catch (_) {}
  }
}

function handleDesignSave() {
  const expInput = document.getElementById("design-exp-input");
  const repInput = document.getElementById("design-rep-input");
  if (!expInput || !repInput) return;
  const exp = parseInt(expInput.value);
  const rep = parseInt(repInput.value);
  if (exp < 1 || rep < 1 || isNaN(exp) || isNaN(rep)) return;
  state.designConfig = { totalExperiments: exp, expectedReplicas: rep, source: "manual" };
  state.designEditOpen = false;
  _saveDesignConfig();
  renderUploadSummary();
}

function handleDesignReset() {
  state.designConfig = null;
  state.designEditOpen = false;
  sessionStorage.removeItem("ftir_designConfig");
  renderUploadSummary();
}

function toggleDesignEdit() {
  state.designEditOpen = !state.designEditOpen;
  renderUploadSummary();
}

function renderUploadSummary() {
  const el = $("#upload-summary");
  if (state.files.length === 0) { el.innerHTML = ""; return; }

  const { replicasByExp, unrecognized, detected } = detectDesign(state.files);
  const cfg = state.designConfig;
  const totalExp = cfg.totalExperiments;
  const expectedRep = cfg.expectedReplicas;

  const expMap = {};
  for (const f of state.files) {
    if (f.experimento != null) {
      expMap[f.experimento] = (expMap[f.experimento] || 0) + 1;
    }
  }

  let cells = "";
  let missing = 0;
  let incomplete = 0;
  for (let i = 1; i <= totalExp; i++) {
    const n = expMap[i] || 0;
    let cls;
    if (n === 0) {
      cls = "bg-slate-100 text-slate-400 border-slate-200";
      missing++;
    } else if (n >= expectedRep) {
      cls = "bg-emerald-50 text-emerald-700 border-emerald-200";
    } else {
      cls = "bg-amber-50 text-amber-700 border-amber-200";
      incomplete++;
    }
    cells += `<div class="border rounded-lg p-2 text-center ${cls}">
      <div class="text-[11px] font-medium leading-tight">Exp ${i}</div>
      <div class="text-base font-bold">${n}/${expectedRep}</div>
    </div>`;
  }

  const warnHtml = unrecognized > 0 ? `
    <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
      <svg class="w-4 h-4 shrink-0 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/>
      </svg>
      <span><strong>${unrecognized}</strong> file(s) not recognized — filename doesn't match expected pattern</span>
    </div>` : "";

  const configMismatch = cfg.source === "manual"
    && (detected.totalExperiments !== cfg.totalExperiments || detected.expectedReplicas !== cfg.expectedReplicas);
  const mismatchHtml = configMismatch ? `
    <div class="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-xs">
      <span>Auto-detected ${detected.totalExperiments} exp × ${detected.expectedReplicas} rep (differs from your config)</span>
      <div class="flex gap-1 shrink-0">
        <button onclick="handleDesignReset()" class="px-2 py-0.5 rounded bg-blue-100 hover:bg-blue-200 text-blue-700 font-medium">Apply detected</button>
      </div>
    </div>` : "";

  let statusCls, statusMsg;
  const present = totalExp - missing;
  if (missing > 0) {
    statusCls = "bg-red-50 border-red-200 text-red-700";
    statusMsg = `${missing} of ${totalExp} experiment(s) missing — upload remaining files`;
  } else if (incomplete > 0) {
    statusCls = "bg-amber-50 border-amber-200 text-amber-700";
    statusMsg = `All ${totalExp} experiments present — ${incomplete} with fewer replicas than expected`;
  } else {
    statusCls = "bg-emerald-50 border-emerald-200 text-emerald-700";
    statusMsg = `All ${totalExp} experiments present — ready for processing`;
  }

  const editIcon = `<button onclick="toggleDesignEdit()" class="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600" title="Edit design configuration">
    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
    </svg>
  </button>`;

  const sourceLabel = cfg.source === "manual" ? "Manual" : "Auto-detected";
  const editPanel = state.designEditOpen ? `
    <div class="mt-2 p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
      <div class="grid grid-cols-2 gap-3 text-sm">
        <label class="flex items-center gap-2">
          <span class="text-slate-600">Experiments:</span>
          <input id="design-exp-input" type="number" value="${totalExp}" min="1" max="999"
                 class="w-20 px-2 py-1 border border-slate-300 rounded text-center">
        </label>
        <label class="flex items-center gap-2">
          <span class="text-slate-600">Replicas/exp:</span>
          <input id="design-rep-input" type="number" value="${expectedRep}" min="1" max="999"
                 class="w-20 px-2 py-1 border border-slate-300 rounded text-center">
        </label>
      </div>
      <div class="flex gap-2">
        <button onclick="handleDesignSave()" class="px-3 py-1 text-xs font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700">Save</button>
        <button onclick="handleDesignReset()" class="px-3 py-1 text-xs font-medium rounded bg-slate-200 text-slate-600 hover:bg-slate-300">Reset to auto-detected</button>
      </div>
    </div>` : "";

  el.innerHTML = `
    <div class="border border-slate-200 rounded-lg p-4 space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-slate-700">Upload Summary</h3>
        <div class="flex items-center gap-2">
          <span class="text-xs text-slate-400">${sourceLabel}: ${totalExp} exp × ${expectedRep} rep</span>
          ${editIcon}
        </div>
      </div>
      ${editPanel}
      <div class="grid gap-2" style="grid-template-columns: repeat(auto-fill, minmax(80px, 1fr))">
        ${cells}
      </div>
      ${warnHtml}
      ${mismatchHtml}
      <div class="px-3 py-2 rounded-lg border text-xs font-medium ${statusCls}">${statusMsg}</div>
    </div>`;
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
  const config = getBaselineConfig();
  const nFiles = state.files.length;
  const mode = config.custom_anchor_points ? "Manual" : "Auto";
  const nAnchors = config.custom_anchor_points
    ? `${config.custom_anchor_points.length} custom anchor points`
    : "auto-detected anchor points";
  const smoothDesc = config.apply_spectrum_smoothing
    ? `${config.metodo_suavizado.toUpperCase()}, window ${config.ventana_suavizado}`
    : "Off";
  const msg = `Processing ${nFiles} files with ${nAnchors} (${mode} mode).\nSmoothing: ${smoothDesc}.\n\nContinue?`;
  if (!confirm(msg)) return;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Processing...';
  statusEl.textContent = "Processing all files...";
  statusEl.className = "text-sm text-slate-500";
  try {
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

  const sortedX = [...state.customAnchors].sort((a, b) => a - b);
  const yVals = getAnchorYValues();
  const sortedIndices = state.customAnchors
    .map((x, i) => ({ x, y: yVals[i], i }))
    .sort((a, b) => a.x - b.x);

  const data = {
    version: "1.1",
    exported_at: new Date().toISOString(),
    spectrum_filename: filename,
    anchor_points_cm: sortedX,
    anchor_points: sortedIndices.map((p) => ({ x: p.x, y: p.y })),
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

      let points;
      if (data.anchor_points && Array.isArray(data.anchor_points)) {
        points = data.anchor_points.map((p) => Number(p.x)).filter((n) => !isNaN(n));
      } else if (data.anchor_points_cm && Array.isArray(data.anchor_points_cm)) {
        points = data.anchor_points_cm.map(Number).filter((n) => !isNaN(n));
      } else {
        showToast("Invalid file: missing anchor_points or anchor_points_cm", "error");
        return;
      }

      if (points.length < 4) {
        showToast("Need at least 4 anchor points", "error");
        return;
      }

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
  _loadDesignConfig();
  initUploadZone($("#drop-zone"), $("#file-input"), $("#folder-input"), handleFilesSelected);
  renderFileList();
});
