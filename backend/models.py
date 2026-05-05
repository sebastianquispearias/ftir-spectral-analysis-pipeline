from enum import Enum

from pydantic import BaseModel, Field


class FileInfo(BaseModel):
    id: str
    nombre: str
    tamano: int
    experimento: int | None = None
    replica: int | None = None


class FileUploadResponse(BaseModel):
    archivos: list[FileInfo]
    count: int


class SmoothingMethod(str, Enum):
    AAV = "AAV"
    SG = "SG"
    PF = "PF"
    FFT = "FFT"
    Binomial = "Binomial"


class BaselineConfig(BaseModel):
    """Two modes: auto (default) or manual (provide custom_anchor_points)."""
    metodo_suavizado: SmoothingMethod = SmoothingMethod.AAV
    ventana_suavizado: int = Field(default=5, ge=3, le=51)
    distance: int = Field(default=40, ge=5, le=200)
    prominence: float = Field(default=0.0003, gt=0, le=1.0)
    apply_spectrum_smoothing: bool = Field(
        default=False,
        description=(
            "If True, smoothing is applied to the spectrum before baseline "
            "subtraction. If False, smoothing is only used internally for "
            "anchor point detection."
        ),
    )
    custom_anchor_points: list[float] | None = Field(
        default=None,
        description=(
            "If provided, overrides automatic detection. "
            "Must contain at least 4 unique points within the spectrum range."
        ),
    )


class BaselinePreviewRequest(BaseModel):
    file_id: str
    config: BaselineConfig = Field(default_factory=BaselineConfig)


class BaselinePreviewResponse(BaseModel):
    x: list[float]
    y_original: list[float]
    y_smoothed: list[float] | None = None
    y_baseline: list[float]
    y_corregido: list[float]
    anchor_x: list[float]
    anchor_y: list[float]
    n_anchor_points: int
    smoothing_applied: bool


class ProcessRequest(BaseModel):
    config: BaselineConfig = Field(default_factory=BaselineConfig)
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
    n_anchor_points: int


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
    maximize: bool = True


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
    condicion_optima: dict[str, float | str]
    superficies: list[SurfaceData]
    residuals: list[float] = []
    predicted: list[float] = []
    lack_of_fit_significant: bool | None = None
