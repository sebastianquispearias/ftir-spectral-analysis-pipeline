const API_BASE = window.location.origin + "/api";

async function apiRequest(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    credentials: "include",
    ...options,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `HTTP ${res.status}`);
  }
  return res;
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

async function baselinePreview(fileId, anchorPoints) {
  const res = await apiRequest("/baseline/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId, anchor_points: anchorPoints }),
  });
  return res.json();
}

async function processAll(anchorPoints, rangoCarboxilato, rangoReferencia) {
  const body = { anchor_points: anchorPoints };
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

async function runAnova(variableRespuesta = "area_carb") {
  const res = await apiRequest("/anova", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ variable_respuesta: variableRespuesta }),
  });
  return res.json();
}

async function autoDetectAnchors(fileId, nPoints = 10) {
  const res = await apiRequest(`/anchor-points/auto/${fileId}?n_points=${nPoints}`);
  return res.json();
}

function getExcelUrl() {
  return `${API_BASE}/export/excel`;
}
