import re
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"

# Validated empirically: AAV with window=5 produces <3% deviation
# from Origin's manual processing on TCNF FTIR spectra.
DEFAULT_SMOOTHING_METHOD = "AAV"
DEFAULT_SMOOTHING_WINDOW = 5

PEAK_FIND_DISTANCE = 40
PEAK_FIND_PROMINENCE = 0.0003

MIN_ANCHOR_POINTS = 4
MAX_ANCHOR_POINTS = 50

RANGO_CARBOXILATO: tuple[float, float] = (1600, 1650)
RANGO_REFERENCIA: tuple[float, float] = (950, 1100)

MAX_FILE_SIZE_MB = 5
MAX_SESSION_SIZE_MB = 200
SESSION_TIMEOUT_HOURS = 1

FILENAME_PATTERN = re.compile(r"Amostra[_ ]TCNF[_ ]Paul[_ ]n[._](\d+)[._](\d+)\.dpt")
