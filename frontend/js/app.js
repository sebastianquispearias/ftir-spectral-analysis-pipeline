const state = {
  files: [],
  previewFileId: null,
  resultados: null,
  anovaData: null,
};

const $ = (sel) => document.querySelector(sel);

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
    listEl.innerHTML = '<p class="text-slate-400 text-sm">No files uploaded yet.</p>';
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

function updatePreviewSelector() {
  const select = $("#preview-file-select");
  select.innerHTML = state.files
    .map((f) => `<option value="${f.id}">${f.nombre}</option>`)
    .join("");
  if (state.previewFileId) select.value = state.previewFileId;
}

function handlePreviewFileChange(fileId) {
  state.previewFileId = fileId;
  loadBaselinePreview();
}

// --- Baseline preview ---
async function loadBaselinePreview() {
  if (!state.previewFileId) return;

  try {
    const data = await baselinePreview(state.previewFileId);
    plotBaselinePreview("baseline-plot", data);
    $("#anchor-count").textContent = `${data.n_anchor_points} anchor points detected`;
  } catch (err) {
    console.error("Baseline preview failed:", err);
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
    const result = await processAll();
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
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-slate-400">No results yet.</td></tr>';
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
  tbody.innerHTML = data.tabla_anova.fuente
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
      </tr>`;
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
      </tr>`;
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
    </div>`;

  if (data.superficies && data.superficies.length > 0) {
    const container = $("#surface-plots");
    container.innerHTML = data.superficies
      .map((_, i) => `<div id="surface-${i}" class="h-96"></div>`)
      .join("");
    data.superficies.forEach((surf, i) => plotSurface(`surface-${i}`, surf));
  }
}

function handleExportExcel() {
  window.open(getExcelUrl(), "_blank");
}

// --- Init ---
document.addEventListener("DOMContentLoaded", () => {
  initUploadZone($("#drop-zone"), $("#file-input"), handleFilesSelected);
  renderFileList();
});
