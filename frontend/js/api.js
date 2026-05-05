const API_BASE = window.location.origin + "/api";

let _slowLoadTimer = null;

function _showSlowLoadBanner() {
  if (document.getElementById("slow-load-banner")) return;
  const banner = document.createElement("div");
  banner.id = "slow-load-banner";
  banner.className = "fixed top-0 left-0 right-0 z-50 bg-amber-50 border-b border-amber-200 px-4 py-3 text-center text-sm text-amber-800 shadow-sm";
  banner.textContent = "Loading... (first load may take up to a minute if the server was idle)";
  document.body.appendChild(banner);
}

function _hideSlowLoadBanner() {
  const banner = document.getElementById("slow-load-banner");
  if (banner) banner.remove();
}

async function apiRequest(path, options = {}) {
  const url = `${API_BASE}${path}`;
  _slowLoadTimer = setTimeout(_showSlowLoadBanner, 5000);
  try {
    const res = await fetch(url, {
      credentials: "include",
      ...options,
    });
    clearTimeout(_slowLoadTimer);
    _hideSlowLoadBanner();
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      let msg = body.detail;
      if (Array.isArray(msg)) msg = msg.map((e) => e.msg || JSON.stringify(e)).join("; ");
      if (typeof msg === "object") msg = JSON.stringify(msg);
      throw new Error(msg || `HTTP ${res.status}`);
    }
    return res;
  } catch (err) {
    clearTimeout(_slowLoadTimer);
    _hideSlowLoadBanner();
    throw err;
  }
}

async function uploadFiles(fileList) {
  const formData = new FormData();
  for (const file of fileList) {
    formData.append("files", file);
  }
  const res = await apiRequest("/upload", { method: "POST", body: formData });
  return res.json();
}

async function listFiles() {
  const res = await apiRequest("/files");
  return res.json();
}

async function deleteFile(fileId) {
  const res = await apiRequest(`/files/${fileId}`, { method: "DELETE" });
  return res.json();
}

async function getSpectrum(fileId) {
  const res = await apiRequest(`/spectrum/${fileId}`);
  return res.json();
}

async function baselinePreview(fileId, config = {}) {
  const res = await apiRequest("/baseline/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId, config }),
  });
  return res.json();
}

async function processAll(config = {}, rangoCarboxilato, rangoReferencia) {
  const body = { config };
  if (rangoCarboxilato) body.rango_carboxilato = rangoCarboxilato;
  if (rangoReferencia) body.rango_referencia = rangoReferencia;
  const res = await apiRequest("/process", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function getResults() {
  const res = await apiRequest("/results");
  return res.json();
}

async function runAnova(variableRespuesta = "area_carb", maximize = true) {
  const res = await apiRequest("/anova", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ variable_respuesta: variableRespuesta, maximize }),
  });
  return res.json();
}

async function clearSession() {
  const res = await apiRequest("/clear", { method: "POST" });
  return res.json();
}

async function loadExamples() {
  const res = await apiRequest("/load-examples", { method: "POST" });
  return res.json();
}

async function updatePattern(pattern) {
  const res = await apiRequest("/update-pattern", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pattern }),
  });
  return res.json();
}

function getExcelUrl() {
  return `${API_BASE}/export/excel`;
}
