import io

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.config import DEFAULT_ANCHOR_POINTS
from backend.main import app, sessions
from tests.conftest import generar_espectro_sintetico


@pytest.fixture(autouse=True)
def clear_sessions():
    sessions.clear()
    yield
    sessions.clear()


@pytest.fixture
def client():
    return TestClient(app)


def _make_dpt_bytes(
    nombre: str = "Amostra_TCNF_Paul_n_1_1.dpt",
    pico_carb_altura: float = 0.03,
) -> tuple[str, io.BytesIO]:
    x, y = generar_espectro_sintetico(pico_carb_altura=pico_carb_altura)
    buf = io.BytesIO()
    np.savetxt(buf, np.column_stack([x[::-1], y[::-1]]), delimiter="\t", fmt="%.6f")
    buf.seek(0)
    return nombre, buf


class TestHealth:
    def test_health(self, client):
        r = client.get("/api/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"


class TestUpload:
    def test_upload_valido(self, client):
        nombre, buf = _make_dpt_bytes()
        r = client.post("/api/upload", files=[("files", (nombre, buf, "application/octet-stream"))])
        assert r.status_code == 200
        data = r.json()
        assert data["count"] == 1
        assert data["archivos"][0]["nombre"] == nombre
        assert data["archivos"][0]["experimento"] == 1
        assert data["archivos"][0]["replica"] == 1

    def test_upload_extension_invalida(self, client):
        buf = io.BytesIO(b"hello")
        r = client.post("/api/upload", files=[("files", ("test.txt", buf, "application/octet-stream"))])
        assert r.status_code == 400

    def test_upload_contenido_invalido(self, client):
        buf = io.BytesIO(b"not\tnumeric\ndata\there\n")
        r = client.post("/api/upload", files=[("files", ("bad.dpt", buf, "application/octet-stream"))])
        assert r.status_code == 400

    def test_upload_multiples(self, client):
        files = []
        for i in range(3):
            nombre, buf = _make_dpt_bytes(f"Amostra_TCNF_Paul_n_1_{i+1}.dpt")
            files.append(("files", (nombre, buf, "application/octet-stream")))
        r = client.post("/api/upload", files=files)
        assert r.status_code == 200
        assert r.json()["count"] == 3


class TestFiles:
    def test_listar_archivos(self, client):
        nombre, buf = _make_dpt_bytes()
        upload_r = client.post("/api/upload", files=[("files", (nombre, buf, "application/octet-stream"))])
        session_cookie = upload_r.cookies.get("session_id")
        client.cookies.set("session_id", session_cookie)

        r = client.get("/api/files")
        assert r.status_code == 200
        assert r.json()["count"] == 1

    def test_eliminar_archivo(self, client):
        nombre, buf = _make_dpt_bytes()
        upload_r = client.post("/api/upload", files=[("files", (nombre, buf, "application/octet-stream"))])
        session_cookie = upload_r.cookies.get("session_id")
        client.cookies.set("session_id", session_cookie)
        file_id = upload_r.json()["archivos"][0]["id"]

        r = client.delete(f"/api/files/{file_id}")
        assert r.status_code == 200

        r2 = client.get("/api/files")
        assert r2.json()["count"] == 0

    def test_eliminar_inexistente(self, client):
        r = client.delete("/api/files/nonexistent")
        assert r.status_code == 404


class TestSpectrum:
    def test_obtener_espectro(self, client):
        nombre, buf = _make_dpt_bytes()
        upload_r = client.post("/api/upload", files=[("files", (nombre, buf, "application/octet-stream"))])
        client.cookies.set("session_id", upload_r.cookies.get("session_id"))
        file_id = upload_r.json()["archivos"][0]["id"]

        r = client.get(f"/api/spectrum/{file_id}")
        assert r.status_code == 200
        data = r.json()
        assert len(data["x"]) > 0
        assert len(data["x"]) == len(data["y"])


class TestBaselinePreview:
    def test_preview(self, client):
        nombre, buf = _make_dpt_bytes()
        upload_r = client.post("/api/upload", files=[("files", (nombre, buf, "application/octet-stream"))])
        client.cookies.set("session_id", upload_r.cookies.get("session_id"))
        file_id = upload_r.json()["archivos"][0]["id"]

        r = client.post("/api/baseline/preview", json={
            "file_id": file_id,
            "anchor_points": DEFAULT_ANCHOR_POINTS,
        })
        assert r.status_code == 200
        data = r.json()
        assert len(data["x"]) == len(data["y_original"])
        assert len(data["x"]) == len(data["y_baseline"])
        assert len(data["x"]) == len(data["y_corregido"])

    def test_preview_anchor_points_insuficientes(self, client):
        nombre, buf = _make_dpt_bytes()
        upload_r = client.post("/api/upload", files=[("files", (nombre, buf, "application/octet-stream"))])
        client.cookies.set("session_id", upload_r.cookies.get("session_id"))
        file_id = upload_r.json()["archivos"][0]["id"]

        r = client.post("/api/baseline/preview", json={
            "file_id": file_id,
            "anchor_points": [500, 1000],
        })
        assert r.status_code == 422


class TestProcess:
    def _upload_batch(self, client, n_exp=3, n_rep=2):
        files = []
        for exp in range(1, n_exp + 1):
            for rep in range(1, n_rep + 1):
                nombre, buf = _make_dpt_bytes(f"Amostra_TCNF_Paul_n_{exp}_{rep}.dpt")
                files.append(("files", (nombre, buf, "application/octet-stream")))
        upload_r = client.post("/api/upload", files=files)
        client.cookies.set("session_id", upload_r.cookies.get("session_id"))
        return upload_r

    def test_proceso_completo(self, client):
        self._upload_batch(client)
        r = client.post("/api/process", json={"anchor_points": DEFAULT_ANCHOR_POINTS})
        assert r.status_code == 200
        data = r.json()
        assert data["total"] == 6
        assert data["tiempo_segundos"] >= 0

    def test_proceso_sin_archivos(self, client):
        r = client.post("/api/process", json={"anchor_points": DEFAULT_ANCHOR_POINTS})
        assert r.status_code == 400

    def test_resultados(self, client):
        self._upload_batch(client)
        client.post("/api/process", json={"anchor_points": DEFAULT_ANCHOR_POINTS})
        r = client.get("/api/results")
        assert r.status_code == 200
        assert r.json()["total"] == 6

    def test_resultados_sin_procesar(self, client):
        r = client.get("/api/results")
        assert r.status_code == 400


class TestAnova:
    def _prepare_full_dataset(self, client):
        files = []
        for exp in range(1, 16):
            for rep in range(1, 4):
                altura = 0.02 + 0.003 * exp + 0.001 * rep
                nombre, buf = _make_dpt_bytes(
                    f"Amostra_TCNF_Paul_n_{exp}_{rep}.dpt",
                    pico_carb_altura=altura,
                )
                files.append(("files", (nombre, buf, "application/octet-stream")))
        upload_r = client.post("/api/upload", files=files)
        client.cookies.set("session_id", upload_r.cookies.get("session_id"))
        client.post("/api/process", json={"anchor_points": DEFAULT_ANCHOR_POINTS})

    def test_anova_sin_resultados(self, client):
        r = client.post("/api/anova", json={"variable_respuesta": "area_carb"})
        assert r.status_code == 400

    def test_anova_completo(self, client):
        self._prepare_full_dataset(client)
        r = client.post("/api/anova", json={"variable_respuesta": "area_carb"})
        assert r.status_code == 200, f"ANOVA failed: {r.json()}"
        data = r.json()
        assert "tabla_anova" in data
        assert "coeficientes" in data
        assert "r_squared" in data
        assert len(data["superficies"]) == 3


class TestExportExcel:
    def test_export(self, client):
        files = []
        for exp in range(1, 4):
            for rep in range(1, 3):
                nombre, buf = _make_dpt_bytes(f"Amostra_TCNF_Paul_n_{exp}_{rep}.dpt")
                files.append(("files", (nombre, buf, "application/octet-stream")))
        upload_r = client.post("/api/upload", files=files)
        client.cookies.set("session_id", upload_r.cookies.get("session_id"))
        client.post("/api/process", json={"anchor_points": DEFAULT_ANCHOR_POINTS})

        r = client.get("/api/export/excel")
        assert r.status_code == 200
        assert "spreadsheetml" in r.headers["content-type"]
        assert len(r.content) > 0

    def test_export_sin_resultados(self, client):
        r = client.get("/api/export/excel")
        assert r.status_code == 400
