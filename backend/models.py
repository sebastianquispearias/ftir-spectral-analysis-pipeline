from enum import Enum

from pydantic import BaseModel, Field

from backend.config import MIN_ANCHOR_POINTS, MAX_ANCHOR_POINTS


class FileInfo(BaseModel):
    id: str
    nombre: str
    tamano: int
    experimento: int | None = None
    replica: int | None = None


class FileUploadResponse(BaseModel):
    archivos: list[FileInfo]
    count: int


class AnchorPointsField(BaseModel):
    anchor_points: list[float] = Field(
        min_length=MIN_ANCHOR_POINTS,
        max_length=MAX_ANCHOR_POINTS,
        description="Anchor points in cm⁻¹ for baseline interpolation (min 4, max 20)",
    )


class BaselinePreviewRequest(AnchorPointsField):
    file_id: str


class BaselinePreviewResponse(BaseModel):
    x: list[float]
    y_original: list[float]
    y_baseline: list[float]
    y_corregido: list[float]


class ProcessRequest(AnchorPointsField):
    rango_carboxilato: tuple[float, float] | None = None
    rango_referencia: tuple[float, float] | None = None


class ProcessResult(BaseModel):
    archivo: str
    experimento: int | None = None
    replica: int | None = None
    altura_carb: float
    area_carb: float
    normalizada: float
    altura_ref: float
    x_pico_carb: float


class ProcessResponse(BaseModel):
    resultados: list[ProcessResult]
    total: int
    tiempo_segundos: float


class VariableRespuesta(str, Enum):
    area_carb = "area_carb"
    altura_carb = "altura_carb"
    normalizada = "normalizada"


class AnovaRequest(BaseModel):
    variable_respuesta: VariableRespuesta = VariableRespuesta.area_carb


class SurfaceData(BaseModel):
    x: list[list[float]]
    y: list[list[float]]
    z: list[list[float]]
    x_label: str
    y_label: str
    z_label: str
    factor_fijo: str
    valor_fijo: float


class AnovaResponse(BaseModel):
    tabla_anova: dict[str, list]
    coeficientes: dict[str, float]
    r_squared: float
    r_squared_adj: float
    p_values: dict[str, float]
    modelo_significativo: bool
    terminos_significativos: list[str]
    condicion_optima: dict[str, float]
    superficies: list[SurfaceData]
