import re
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"

DEFAULT_ANCHOR_POINTS: list[float] = [450, 800, 1500, 1750, 1850, 2400, 3950]

MIN_ANCHOR_POINTS = 4
MAX_ANCHOR_POINTS = 20

RANGO_CARBOXILATO: tuple[float, float] = (1600, 1650)
RANGO_REFERENCIA: tuple[float, float] = (950, 1100)

MAX_FILE_SIZE_MB = 5
MAX_SESSION_SIZE_MB = 200
SESSION_TIMEOUT_HOURS = 1

FILENAME_PATTERN = re.compile(r"Amostra[_ ]TCNF[_ ]Paul[_ ]n[._](\d+)[._](\d+)\.dpt")
