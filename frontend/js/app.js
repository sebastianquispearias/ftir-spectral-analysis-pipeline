const DEFAULT_ANCHORS = [450, 800, 1500, 1750, 1850, 2400, 3950];

const state = {
  files: [],
  anchorPoints: [...DEFAULT_ANCHORS],
  previewFileId: null,
  lastPreviewData: null,
  resultados: null,
  anovaData: null,
};

let _previewDebounceTimer = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function revealSection(id) {
  $(id).classList.remove("hidden");
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
  const countEl = $("#file-count");
  countEl.textContent = `${state.files.length} file(s)`;

  if (state.files.length === 0) {
    listEl.innerHTML =
      '<p class="text-slate-400 text-sm">No files uploaded yet.</p>';
    return;
  }

  listEl.innerHTML = state.files
    .map(
      (f) => `
    <div class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-50 text-sm group">
      <div class="flex items-center gap-2 min-w-0">
        <span class="text-slate-400 shrink-0">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
        </span>
        <span class="truncate" title="${f.nombre}">${f.nombre}</span>
        ${f.experimento != null ? `<span class="text-xs text-slate-400">Exp ${f.experimento}, Rep ${f.replica}</span>` : ""}
      </div>
      <button onclick="handleDeleteFile('${f.id}')" class="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2" title="Remove">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    </div>
  `
    )
    .join("");
}

async function handleDeleteFile(fileId) {
  try {
    await deleteFile(fileId);
    state.files = state.files.filter((f) => f.id !== fileId);
    renderFileList();
    updatePreviewSelector();
  } catch (err) {
    alert(`Delete failed: ${err.message}`);
  }
}

// --- Preview file selector ---
function updatePreviewSelector() {
  const select = $("#preview-file-select");
  select.innerHTML = state.files
    .map((f) => `<option value="${f.id}">${f.nombre}</option>`)
    .join("");
  if (state.previewFileId) {
    select.value = state.previewFileId;
  }
}

function handlePreviewFileChange(fileId) {
  state.previewFileId = fileId;
  loadBaselinePreview();
}

// --- Anchor points ---
function renderAnchorPointsList() {
  const listEl = $("#anchor-list");
  const sorted = [...state.anchorPoints].sort((a, b) => a - b);
  listEl.innerHTML = sorted
    .map(
      (ap, i) => `
    <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 rounded text-xs font-mono">
      ${Math.round(ap)}
      <button onclick="removeAnchorPointByValue(${ap})" class="text-slate-400 hover:text-red-500">&times;</button>
    </span>
  `
    )
    .join("");
  $("#anchor-count").textContent = `${state.anchorPoints.length} points`;
}

function removeAnchorPointByValue(value) {
  const TOLERANCE = 15;
  state.anchorPoints = state.anchorPoints.filter(
    (ap) => Math.abs(ap - value) > TOLERANCE
  );
  renderAnchorPointsList();
  debouncedPreview();
}

function addAnchorPointValue(value) {
  const rounded = Math.round(value * 10) / 10;
  const TOLERANCE = 15;
  const tooClose = state.anchorPoints.some(
    (ap) => Math.abs(ap - rounded) < TOLERANCE
  );
  if (tooClose || state.anchorPoints.length >= 20) return false;
  state.anchorPoints.push(rounded);
  renderAnchorPointsList();
  return true;
}

function handlePlotClick(xVal, isAnchorPoint) {
  if (isAnchorPoint) {
    removeAnchorPointByValue(xVal);
  } else {
    if (addAnchorPointValue(xVal)) {
      debouncedPreview();
    }
  }
}

function debouncedPreview() {
  clearTimeout(_previewDebounceTimer);
  _previewDebounceTimer = setTimeout(() => loadBaselinePreview(), 300);
}

async function loadBaselinePreview() {
  if (!state.previewFileId || state.anchorPoints.length < 4) {
    if (state.anchorPoints.length < 4) {
      const plotDiv = document.getElementById("baseline-plot");
      if (plotDiv)
        plotDiv.innerHTML =
          '<p class="text-center text-slate-400 text-sm py-20">Need at least 4 anchor points for baseline preview.</p>';
    }
    return;
  }

  try {
    const data = await baselinePreview(state.previewFileId, state.anchorPoints);
    state.lastPreviewData = data;
    plotBaselinePreview("baseline-plot", data, state.anchorPoints, handlePlotClick);
  } catch (err) {
    console.error("Baseline preview failed:", err);
  }
}

function handleAddAnchorPoint() {
  const input = $("#anchor-input");
  const val = parseFloat(input.value);
  if (isNaN(val) || val < 400 || val > 4000) {
    alert("Enter a value between 400 and 4000 cm⁻¹");
    return;
  }
  if (addAnchorPointValue(val)) {
    debouncedPreview();
  }
  input.value = "";
}

function handleResetAnchors() {
  state.anchorPoints = [...DEFAULT_ANCHORS];
  renderAnchorPointsList();
  loadBaselinePreview();
}

async function handleAutoDetect() {
  if (!state.previewFileId) return;
  const btn = $("#btn-auto-detect");
  btn.disabled = true;
  btn.textContent = "Detecting...";
  try {
    const result = await autoDetectAnchors(state.previewFileId);
    state.anchorPoints = result.anchor_points;
    renderAnchorPointsList();
    loadBaselinePreview();
  } catch (err) {
    alert(`Auto-detection failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "Auto-detect";
  }
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
    const result = await processAll(state.anchorPoints);
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

// --- Results table ---
function renderResultsTable() {
  const tbody = $("#results-tbody");
  if (!state.resultados || state.resultados.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="text-center py-4 text-slate-400">No results yet.</td></tr>';
    return;
  }

  tbody.innerHTML = state.resultados
    .map(
      (r) => `
    <tr class="hover:bg-slate-50">
      <td class="px-3 py-2 text-sm">${r.archivo}</td>
      <td class="px-3 py-2 text-sm text-center">${r.experimento ?? "-"}</td>
      <td class="px-3 py-2 text-sm text-center">${r.replica ?? "-"}</td>
      <td class="px-3 py-2 text-sm text-right font-mono">${r.altura_carb.toFixed(4)}</td>
      <td class="px-3 py-2 text-sm text-right font-mono">${r.area_carb.toFixed(4)}</td>
      <td class="px-3 py-2 text-sm text-right font-mono">${r.normalizada.toFixed(4)}</td>
    </tr>
  `
    )
    .join("");
}

function handleVariableChange(variable) {
  if (state.resultados) {
    plotResultsBoxplot("results-plot", state.resultados, variable);
  }
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
  } catch (err) {
    alert(`ANOVA failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "Run ANOVA";
  }
}

function renderAnovaResults(data) {
  $("#anova-r2").textContent = data.r_squared.toFixed(4);
  $("#anova-r2-adj").textContent = data.r_squared_adj.toFixed(4);
  $("#anova-significant").textContent = data.modelo_significativo ? "Yes" : "No";
  $("#anova-significant").className = data.modelo_significativo
    ? "text-2xl font-bold text-emerald-600"
    : "text-2xl font-bold text-red-600";

  const tbody = $("#anova-tbody");
  const fuentes = data.tabla_anova.fuente;
  tbody.innerHTML = fuentes
    .map((fuente, i) => {
      const p = data.tabla_anova["PR(>F)"][i];
      const sig = p !== null && p < 0.05;
      return `
      <tr class="${sig ? "bg-emerald-50" : "hover:bg-slate-50"}">
        <td class="px-3 py-1.5 text-sm">${fuente}</td>
        <td class="px-3 py-1.5 text-sm text-right font-mono">${data.tabla_anova.sum_sq[i]?.toFixed(6) ?? "-"}</td>
        <td class="px-3 py-1.5 text-sm text-center">${data.tabla_anova.df[i]?.toFixed(0) ?? "-"}</td>
        <td class="px-3 py-1.5 text-sm text-right font-mono">${data.tabla_anova.F[i]?.toFixed(4) ?? "-"}</td>
        <td class="px-3 py-1.5 text-sm text-right font-mono ${sig ? "text-emerald-700 font-semibold" : ""}">${p?.toFixed(6) ?? "-"}</td>
      </tr>
    `;
    })
    .join("");

  const coefBody = $("#coef-tbody");
  coefBody.innerHTML = Object.entries(data.coeficientes)
    .map(([name, val]) => {
      const p = data.p_values[name];
      const sig = p < 0.05;
      return `
      <tr class="${sig ? "bg-emerald-50" : "hover:bg-slate-50"}">
        <td class="px-3 py-1.5 text-sm">${name}</td>
        <td class="px-3 py-1.5 text-sm text-right font-mono">${val.toFixed(6)}</td>
        <td class="px-3 py-1.5 text-sm text-right font-mono ${sig ? "text-emerald-700 font-semibold" : ""}">${p.toFixed(6)}</td>
      </tr>
    `;
    })
    .join("");

  const opt = data.condicion_optima;
  $("#optimal-condition").innerHTML = `
    <div class="grid grid-cols-3 gap-4 text-center">
      <div class="p-3 bg-slate-50 rounded-lg">
        <div class="text-xs text-slate-500 uppercase">Temperature</div>
        <div class="text-lg font-semibold">${opt.temperatura.toFixed(1)} °C</div>
      </div>
      <div class="p-3 bg-slate-50 rounded-lg">
        <div class="text-xs text-slate-500 uppercase">Time</div>
        <div class="text-lg font-semibold">${opt.tiempo.toFixed(1)} min</div>
      </div>
      <div class="p-3 bg-slate-50 rounded-lg">
        <div class="text-xs text-slate-500 uppercase">NaClO</div>
        <div class="text-lg font-semibold">${opt.naclo.toFixed(2)} mL</div>
      </div>
    </div>
  `;

  if (data.superficies && data.superficies.length > 0) {
    const container = $("#surface-plots");
    container.innerHTML = data.superficies
      .map((_, i) => `<div id="surface-${i}" class="h-96"></div>`)
      .join("");
    data.superficies.forEach((surf, i) => plotSurface(`surface-${i}`, surf));
  }
}

// --- Excel export ---
function handleExportExcel() {
  window.open(getExcelUrl(), "_blank");
}

// --- Init ---
document.addEventListener("DOMContentLoaded", () => {
  const dropZone = $("#drop-zone");
  const fileInput = $("#file-input");
  initUploadZone(dropZone, fileInput, handleFilesSelected);
  renderFileList();
  renderAnchorPointsList();
});
