from __future__ import annotations

import shutil
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.anova_analysis import correr_anova_completo
from backend.config import (
    MAX_FILE_SIZE_MB,
    RANGO_CARBOXILATO,
    RANGO_REFERENCIA,
    SESSION_TIMEOUT_HOURS,
    UPLOAD_DIR,
)
from backend.excel_export import generar_excel
from backend.ftir_pipeline import (
    calcular_baseline,
    cargar_espectro,
    procesar_lote,
)
from backend.models import (
    AnovaRequest,
    AnovaResponse,
    BaselineConfig,
    BaselinePreviewRequest,
    BaselinePreviewResponse,
    FileInfo,
    FileUploadResponse,
    ProcessRequest,
    ProcessResponse,
    ProcessResult,
    SurfaceData,
)

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class FileEntry:
    id: str
    nombre: str
    path: Path
    tamano: int
    experimento: int | None = None
    replica: int | None = None


@dataclass
class SessionData:
    created_at: float = field(default_factory=time.time)
    files: dict[str, FileEntry] = field(default_factory=dict)
    resultados: pd.DataFrame | None = None
    anova_resultado: dict | None = None
    config_used: BaselineConfig | None = None


sessions: dict[str, SessionData] = {}


def _cleanup_expired_sessions() -> None:
    now = time.time()
    cutoff = SESSION_TIMEOUT_HOURS * 3600
    expired = [sid for sid, s in sessions.items() if now - s.created_at > cutoff]
    for sid in expired:
        session_dir = UPLOAD_DIR / sid
        if session_dir.exists():
            shutil.rmtree(session_dir, ignore_errors=True)
        del sessions[sid]


async def _periodic_cleanup(interval: float = 600) -> None:
    import asyncio
    while True:
        await asyncio.sleep(interval)
        _cleanup_expired_sessions()


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    task = asyncio.create_task(_periodic_cleanup())
    yield
    task.cancel()


app = FastAPI(
    title="FTIR Spectral Analysis Pipeline",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _get_session(request: Request) -> tuple[str, SessionData]:
    session_id = request.cookies.get("session_id") or request.headers.get("X-Session-ID")
    if not session_id or session_id not in sessions:
        session_id = str(uuid.uuid4())
        sessions[session_id] = SessionData()
        session_dir = UPLOAD_DIR / session_id
        session_dir.mkdir(parents=True, exist_ok=True)
    return session_id, sessions[session_id]


def _parse_filename(nombre: str) -> tuple[int | None, int | None]:
    from backend.ftir_pipeline import extraer_experimento_replica
    return extraer_experimento_replica(nombre)


def _extract_baseline_kwargs(config: BaselineConfig) -> dict:
    """Extract kwargs for calcular_baseline (excludes apply_spectrum_smoothing)."""
    return {
        "metodo_suavizado": config.metodo_suavizado.value,
        "ventana_suavizado": config.ventana_suavizado,
        "distance": config.distance,
        "prominence": config.prominence,
        "custom_anchor_points": config.custom_anchor_points,
    }

def _extract_process_kwargs(config: BaselineConfig) -> dict:
    """Extract kwargs for procesar_lote (includes apply_spectrum_smoothing)."""
    return {
        "metodo_suavizado": config.metodo_suavizado.value,
        "ventana_suavizado": config.ventana_suavizado,
        "distance": config.distance,
        "prominence": config.prominence,
        "custom_anchor_points": config.custom_anchor_points,
        "apply_spectrum_smoothing": config.apply_spectrum_smoothing,
    }


# --- Endpoints ---

@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/upload", response_model=FileUploadResponse)
async def upload(request: Request, files: list[UploadFile]):
    session_id, session = _get_session(request)
    uploaded: list[FileInfo] = []

    for f in files:
        if not f.filename or not f.filename.endswith(".dpt"):
            raise HTTPException(400, f"Only .dpt files accepted, got: {f.filename}")

        content = await f.read()
        size_mb = len(content) / (1024 * 1024)
        if size_mb > MAX_FILE_SIZE_MB:
            raise HTTPException(400, f"File too large ({size_mb:.1f} MB > {MAX_FILE_SIZE_MB} MB): {f.filename}")

        file_id = str(uuid.uuid4())
        file_path = UPLOAD_DIR / session_id / f"{file_id}.dpt"
        file_path.write_bytes(content)

        try:
            cargar_espectro(file_path)
        except ValueError as e:
            file_path.unlink(missing_ok=True)
            raise HTTPException(400, f"Invalid .dpt file '{f.filename}': {e}")

        existing_id = next(
            (fid for fid, fe in session.files.items() if fe.nombre == f.filename),
            None,
        )
        if existing_id:
            old_entry = session.files.pop(existing_id)
            old_entry.path.unlink(missing_ok=True)

        exp, rep = _parse_filename(f.filename)
        entry = FileEntry(
            id=file_id,
            nombre=f.filename,
            path=file_path,
            tamano=len(content),
            experimento=exp,
            replica=rep,
        )
        session.files[file_id] = entry
        uploaded.append(FileInfo(
            id=file_id,
            nombre=f.filename,
            tamano=len(content),
            experimento=exp,
            replica=rep,
        ))

    from starlette.responses import JSONResponse
    response = JSONResponse(
        content=FileUploadResponse(archivos=uploaded, count=len(uploaded)).model_dump()
    )
    response.set_cookie("session_id", session_id, httponly=True, samesite="lax")
    return response


@app.get("/api/files")
async def list_files(request: Request):
    session_id, session = _get_session(request)
    return {
        "archivos": [
            FileInfo(
                id=fe.id, nombre=fe.nombre, tamano=fe.tamano,
                experimento=fe.experimento, replica=fe.replica,
            ).model_dump()
            for fe in session.files.values()
        ],
        "count": len(session.files),
    }


@app.delete("/api/files/{file_id}")
async def delete_file(file_id: str, request: Request):
    _, session = _get_session(request)
    if file_id not in session.files:
        raise HTTPException(404, "File not found")
    entry = session.files.pop(file_id)
    entry.path.unlink(missing_ok=True)
    return {"deleted": file_id}


@app.get("/api/spectrum/{file_id}")
async def get_spectrum(file_id: str, request: Request):
    _, session = _get_session(request)
    if file_id not in session.files:
        raise HTTPException(404, "File not found")
    entry = session.files[file_id]
    x, y = cargar_espectro(entry.path)
    return {"x": x.tolist(), "y": y.tolist(), "nombre": entry.nombre}


@app.post("/api/baseline/preview", response_model=BaselinePreviewResponse)
async def baseline_preview(body: BaselinePreviewRequest, request: Request):
    _, session = _get_session(request)
    if body.file_id not in session.files:
        raise HTTPException(404, "File not found")
    entry = session.files[body.file_id]

    from backend.ftir_pipeline import suavizar_espectro

    x, y_raw = cargar_espectro(entry.path)
    cfg = body.config
    if cfg.apply_spectrum_smoothing:
        y = suavizar_espectro(y_raw, metodo=cfg.metodo_suavizado.value, ventana=cfg.ventana_suavizado)
    else:
        y = y_raw

    kwargs = _extract_baseline_kwargs(cfg)
    try:
        baseline, anchor_x, anchor_y = calcular_baseline(x, y, **kwargs)
    except ValueError as e:
        raise HTTPException(400, str(e))

    y_corregido = y - baseline
    return BaselinePreviewResponse(
        x=x.tolist(),
        y_original=y_raw.tolist(),
        y_smoothed=y.tolist() if cfg.apply_spectrum_smoothing else None,
        y_baseline=baseline.tolist(),
        y_corregido=y_corregido.tolist(),
        anchor_x=anchor_x.tolist(),
        anchor_y=anchor_y.tolist(),
        n_anchor_points=len(anchor_x),
        smoothing_applied=cfg.apply_spectrum_smoothing,
    )


@app.post("/api/process", response_model=ProcessResponse)
async def process(body: ProcessRequest, request: Request):
    _, session = _get_session(request)
    if not session.files:
        raise HTTPException(400, "No files uploaded")

    kwargs = _extract_process_kwargs(body.config)
    rutas = [fe.path for fe in session.files.values()]
    nombres = {str(fe.path): fe.nombre for fe in session.files.values()}
    start = time.time()
    try:
        df = procesar_lote(rutas, **kwargs, nombres_originales=nombres)
    except ValueError as e:
        raise HTTPException(400, str(e))
    elapsed = time.time() - start

    session.resultados = df
    session.config_used = body.config

    resultados = [
        ProcessResult(**row.to_dict())
        for _, row in df.iterrows()
    ]
    return ProcessResponse(
        resultados=resultados,
        total=len(resultados),
        tiempo_segundos=round(elapsed, 3),
    )


@app.get("/api/results")
async def get_results(request: Request):
    _, session = _get_session(request)
    if session.resultados is None:
        raise HTTPException(400, "No results yet. Run /api/process first.")
    return {
        "resultados": session.resultados.to_dict(orient="records"),
        "total": len(session.resultados),
    }


@app.post("/api/anova", response_model=AnovaResponse)
async def run_anova(body: AnovaRequest, request: Request):
    _, session = _get_session(request)
    if session.resultados is None:
        raise HTTPException(400, "No results yet. Run /api/process first.")

    try:
        resultado = correr_anova_completo(session.resultados, body.variable_respuesta.value)
    except Exception as e:
        raise HTTPException(400, f"ANOVA failed: {e}")

    session.anova_resultado = resultado

    superficies = [SurfaceData(**s) for s in resultado["superficies"]]
    return AnovaResponse(
        tabla_anova=resultado["tabla_anova"],
        coeficientes=resultado["coeficientes"],
        r_squared=resultado["r_squared"],
        r_squared_adj=resultado["r_squared_adj"],
        p_values=resultado["p_values"],
        modelo_significativo=resultado["modelo_significativo"],
        terminos_significativos=resultado["terminos_significativos"],
        condicion_optima=resultado["condicion_optima"],
        superficies=superficies,
    )


@app.get("/api/export/excel")
async def export_excel(request: Request):
    _, session = _get_session(request)
    if session.resultados is None:
        raise HTTPException(400, "No results yet. Run /api/process first.")

    output_path = UPLOAD_DIR / f"results_{uuid.uuid4().hex[:8]}.xlsx"
    rangos = {
        "carboxilato": RANGO_CARBOXILATO,
        "referencia": RANGO_REFERENCIA,
    }
    config_info = None
    if session.config_used:
        config_info = session.config_used.model_dump()
    generar_excel(
        session.resultados,
        session.anova_resultado,
        output_path,
        anchor_points=config_info,
        rangos=rangos,
    )
    return FileResponse(
        path=str(output_path),
        filename="ftir_results.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


frontend_dir = Path(__file__).resolve().parent.parent / "frontend"
if frontend_dir.exists():
    app.mount("/css", StaticFiles(directory=str(frontend_dir / "css")), name="css")
    app.mount("/js", StaticFiles(directory=str(frontend_dir / "js")), name="js")

    @app.get("/")
    async def serve_frontend():
        return FileResponse(str(frontend_dir / "index.html"))
