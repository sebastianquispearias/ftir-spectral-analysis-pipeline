# FTIR Spectral Analysis Pipeline -- Project Context (Technical)

> **Purpose:** Complete technical context for continuing development in a new Claude session. Contains decisions, bugs, reference numbers, and current state.

---

## Table of Contents

1. [Quick Summary](#1-quick-summary)
2. [Project Overview](#2-project-overview)
3. [Scientific Method](#3-scientific-method)
4. [Validation Against OriginLab](#4-validation-against-originlab)
5. [Architecture](#5-architecture)
6. [Key Files Reference](#6-key-files-reference)
7. [Critical Decisions Made](#7-critical-decisions-made)
8. [Bugs Found and Fixed](#8-bugs-found-and-fixed)
9. [Pipeline Internals](#9-pipeline-internals)
10. [Known Limitations](#10-known-limitations)
11. [Test Coverage](#11-test-coverage)
12. [Current Status](#12-current-status)
13. [Reference Data](#13-reference-data)
14. [How to Run Locally](#14-how-to-run-locally)
15. [Contact & Authorship](#15-contact)
16. [Document Maintenance](#16-document-maintenance)

---

## 1. Quick Summary

**What:** Web app that automates FTIR spectrum processing + Box-Behnken statistical analysis (DOE).

**Scientific client:** Mario, PhD in Chemical Engineering at PUC-Rio.

**Use case:** Process 150 FTIR spectra (15 experiments x 10 replicates) for Box-Behnken study on TEMPO-mediated oxidation of nanocellulose (TCNF). Manual workflow in OriginLab took 5+ hours. The app does it in ~60 seconds.

**Status:** Complete and deployed.

**URLs:**
- App: https://ftir-spectral-analysis-pipeline.onrender.com
- GitHub: https://github.com/sebastianquispearias/ftir-spectral-analysis-pipeline

**Key validation:**
- Without smoothing: **99.66%** equivalence with OriginLab Pro 2024 (0.34% area diff).
- With AAV-5 smoothing: **97.50%** equivalence (2.50% area diff).

**Owner:** Sebastian Quispe Arias (sarias@inf.puc-rio.br).

**Stack:** Python 3.11.9, FastAPI, scipy, statsmodels, Plotly.js, Tailwind CSS. 55 tests. GitHub Actions CI. Deployed on Render free tier.

---

## 2. Project Overview

### Scientific context

**Mario** is a PhD student in chemistry at PUC-Rio. His thesis investigates **TEMPO-mediated oxidation of cellulose nanofibrils (TCNF)** to produce carboxylate groups on the fiber surface.

**How it's measured:** FTIR spectroscopy shows a peak at **1600-1650 cm-1** corresponding to the C=O vibration of carboxylate. **More peak area = more oxidation.**

### Mario's experiment

Box-Behnken design with 3 factors and 3 levels:

| Factor | Min | Center | Max |
|---|---|---|---|
| Temperature | 20 C | 30 C | 40 C |
| Time | 60 min | 90 min | 120 min |
| NaClO (oxidant) | 6.1 mL | 8.0 mL | 10.0 mL |

**15 unique experiments x 10 replicates = 150 `.dpt` files.**

### The manual workflow

Mario processed each file manually in OriginLab Pro 2024: import, Peak Analyzer, BSpline baseline, click ~15 anchor points, integrate area. **5+ hours per dataset**, with human variability contaminating the ANOVA.

### The project goal

Replicate Mario's method in Python, validate mathematically vs OriginLab, automate 150 files in seconds, generate ANOVA and publishable plots.

---

## 3. Scientific Method

### 3.1 The .dpt format

ASCII with 2 tab-separated columns: wavenumber (cm-1, descending from 4000 to 400) and intensity/absorbance. ~1757 points per file, ~36 KB.

### 3.2 Baseline correction with cubic B-spline

**Function:** `backend/ftir_pipeline.py::calcular_baseline()`

```python
spline = make_interp_spline(anchor_x, anchor_y, k=3, bc_type="not-a-knot")
baseline = spline(x)
```

`bc_type="not-a-knot"` is the default boundary condition in commercial spectroscopy software including OriginLab.

### 3.3 Anchor points: auto-detection + manual override

**Auto-detection (mode "auto"):**
```python
peaks, _ = find_peaks(-y, distance=40, prominence=0.0003)
```
Generates ~19 anchor points for a typical spectrum.

**Manual mode:**
- **Move** an anchor by dragging
- **Add** an anchor (click in empty area, tool "Add")
- **Remove** an anchor (click on it, tool "Remove")
- **Import** a JSON with custom anchor points
- **Lock** auto-detected anchors as manual (Lock button)

`state.mode = "auto" | "manual"`. In manual mode, anchor X values are NOT re-detected when toggling smoothing. Only Y values are recalculated.

### 3.4 Smoothing (5 methods)

**Default:** `apply_spectrum_smoothing = False`. Validated empirically as best match with Mario's Origin output.

| Method | Implementation |
|---|---|
| **AAV** (Adjacent Averaging) | `scipy.ndimage.uniform_filter1d(size=window, mode='reflect')` |
| **SG** (Savitzky-Golay) | `scipy.signal.savgol_filter` |
| **PF** (Percentile / Median) | `scipy.ndimage.percentile_filter` |
| **FFT** | `scipy.fft` with cutoff |
| **Binomial** | Convolution with `[1,2,1]/4` kernel iterated |

LOWESS and LOESS are NOT implemented (Mario's tutorial explicitly says "avoid lowess & loess" for FTIR).

### 3.5 Peak metrics

**Function:** `backend/ftir_pipeline.py::calcular_metricas_pico()`

For a corrected spectrum in a range (e.g., 1600-1650):
- **altura**: max intensity
- **area**: trapezoidal integration (`np.trapezoid`) with negative values clipped to 0
- **x_pico**: wavenumber at peak maximum

**Carboxylate range:** 1600-1650 cm-1.
**Reference C-O range:** 950-1100 cm-1 (for normalization).

### 3.6 Box-Behnken ANOVA

**Function:** `backend/anova_analysis.py::correr_anova_completo()`

Full quadratic model:
```
Y = b0 + b1*X1 + b2*X2 + b3*X3 + b11*X1^2 + b22*X2^2 + b33*X3^2
    + b12*X1*X2 + b13*X1*X3 + b23*X2*X3
```

10 coefficients. Uses **N=150 individual replicates** (not N=15 experiment means), giving df_residual=140. Following Montgomery, *Design of Experiments*, 8th ed.

Coded-to-real conversion:
```
temp_real = 30 + 10 * X1
time_real = 90 + 30 * X2
naclo_real = 8.0 + 1.95 * X3
```

### 3.7 Response Surface Methodology + Optimum

**Function:** `backend/anova_analysis.py::_calcular_optimo()`

Uses `scipy.optimize.minimize` with L-BFGS-B method, 9 starting points, bounds=[-1,1]^3. User can toggle **Maximize / Minimize** in the UI.

3 response surfaces generated (one per factor pair), with the third factor fixed at **0 (center level)**:
1. Temperature x Time (NaClO = 8.0 mL)
2. Temperature x NaClO (Time = 90 min)
3. Time x NaClO (Temperature = 30 C)

Each surface rendered in Plotly with:
- 3D view by default, toggle "Switch to 2D" for contour map
- Red diamond marker at the optimal point
- Axes with real values (not coded)

---

## 4. Validation Against OriginLab

### 4.1 Methodology

Mario processed `Amostra_TCNF_Paul_n_1_1.dpt` in OriginLab Pro 2024 with identical 19 anchor points, BSpline with not-a-knot, Snap-to-Spectrum disabled.

Two experiments:
- A: Without spectrum smoothing
- B: With AAV-5 smoothing applied to spectrum

### 4.2 Results

| Configuration | Metric | Pipeline | Origin | Diff |
|---|---|---|---|---|
| Without smoothing | Height | 0.02335 | 0.02326 | **0.41%** |
| Without smoothing | Area | 0.75335 | 0.75076 | **0.34%** |
| With AAV-5 | Height | 0.02368 | 0.02313 | **2.39%** |
| With AAV-5 | Area | 0.77014 | 0.75136 | **2.50%** |

### 4.3 Analysis of 2.5% smoothing difference

scipy `uniform_filter1d(mode='reflect')` and Origin AAV are mathematically identical in the spectrum interior. They differ only at the boundaries (first/last 2-3 points) by ~0.00066. Since anchor points include 399.55 and 3997.50 (spectrum extremes), the spline propagates that small boundary difference across the entire baseline.

Decision: kept `mode='reflect'` (scipy default). The deviation is systematic and doesn't affect ANOVA conclusions.

### 4.4 Validation files

Location: `data/examples/origin_validation/`
- `n_1_1_origin_SIN_smooth.dat`, `n_1_1_origin_CON_smooth.dat`, `n_1_1_origin_COMPLETO_smooth.dat`
- `validation_report.md`, `comparison.png`, `comparison_zoom.png`

Script: `scripts/validate_against_origin.py` (uses real pipeline functions, not reimplementation).

---

## 5. Architecture

### 5.1 Stack

```
Backend:  Python 3.11.9, FastAPI, Uvicorn, scipy, statsmodels, pandas, numpy, openpyxl
Frontend: HTML, Vanilla JavaScript, Plotly.js, Tailwind CSS
Deploy:   Render (free tier), GitHub Actions CI
Tests:    pytest (55 tests)
```

### 5.2 Directory structure

```
ftir-spectral-analysis-pipeline/
  backend/
    __init__.py
    ftir_pipeline.py        # Core scientific (validated, DO NOT MODIFY)
    anova_analysis.py       # ANOVA + RSM (validated)
    synthetic.py            # Synthetic data generator (seed=42)
    main.py                 # FastAPI endpoints
    models.py               # Pydantic schemas
    excel_export.py         # Multi-sheet Excel generation
    config.py               # Constants (ranges, patterns, limits)
  frontend/
    index.html
    css/styles.css
    js/
      app.js                # State management + rendering (~750 lines)
      plot.js               # Plotly visualizations (baseline, surfaces)
      api.js                # Backend API wrapper
      upload.js             # Drag & drop + folder upload + recursive scan
  tests/
    test_pipeline.py        # Spectrum loading, baseline, metrics, batch
    test_anova.py           # ANOVA, optimize, surfaces, synthetic data
    test_api.py             # All API endpoints end-to-end
  scripts/
    validate_against_origin.py
  data/examples/
    raw/                    # Real .dpt files organized by experiment
    procesado/              # Origin-processed files
    origin_validation/      # Validation reports, plots, Origin .dat files
    anchor_points/          # Exported anchor point JSON files
  docs/
    ARCHITECTURE.md
    SPEC.md
  .github/workflows/
    tests.yml               # CI: pytest on push/PR
  README.md
  PROJECT_CONTEXT.md        # This file
  LICENSE                   # MIT
  requirements.txt
  render.yaml
  runtime.txt
```

### 5.3 API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check + commit hash |
| POST | `/api/upload` | Upload .dpt files (multipart/form-data) |
| GET | `/api/files` | List uploaded files in session |
| DELETE | `/api/files/{id}` | Delete a file |
| GET | `/api/spectrum/{id}` | Get raw spectrum data (x, y arrays) |
| POST | `/api/baseline/preview` | Preview baseline for one file |
| POST | `/api/process` | Process all session files with current config |
| GET | `/api/results` | Get processing results |
| POST | `/api/anova` | Run ANOVA (accepts `maximize: bool`) |
| GET | `/api/export/excel` | Download Excel report (5 sheets) |
| POST | `/api/load-examples` | Generate and load 150 synthetic spectra |

### 5.4 Frontend state management

```javascript
const state = {
  files: [],              // Uploaded files (FileInfo objects)
  previewFileId: null,    // File shown in baseline preview
  mode: "auto",           // "auto" | "manual" (anchor detection mode)
  tool: "move",           // "add" | "move" | "remove" (anchor edit tool)
  customAnchors: null,    // null in auto, sorted float array in manual
  undoStack: [],          // Anchor point undo history (max 30)
  dragging: null,         // Active drag state {idx}
  spectrumData: null,     // Last baseline preview response
  resultados: null,       // After Process All
  anovaData: null,        // After Run ANOVA
  surfaceMode: "3d",      // "3d" | "2d" (surface plot toggle)
  designConfig: null,     // {totalExperiments, expectedReplicas, source: "auto"|"manual"}
  designEditOpen: false,  // Upload summary config panel open
};
```

Smoothing config is read directly from DOM elements (`#cfg-method`, `#cfg-window`, `#cfg-apply-smoothing`), not stored in state.

### 5.5 Data flow

```
1. Upload (files or folder, recursive scan)
   POST /api/upload -> state.files (dedup by filename)
   Upload Summary panel auto-detects design (experiments x replicas)

2. Preview baseline (auto-detect or custom anchors)
   POST /api/baseline/preview -> render plot with anchors
   Lock button: fix auto-detected anchors as manual

3. Edit anchors (manual mode)
   Click/drag on plot -> state.mode = "manual", state.customAnchors updated
   POST /api/baseline/preview with custom_anchor_points

4. Process All (confirmation dialog first)
   POST /api/process with current config -> 150 results
   Same config applied uniformly to ALL files

5. Run ANOVA (with maximize/minimize toggle)
   POST /api/anova with variable + maximize -> table + surfaces + optimum

6. Export
   GET /api/export/excel -> 5-sheet Excel with full traceability
```

### 5.6 Notable frontend features

- **Upload Summary panel**: After upload, shows grid of experiments with replica counts. Auto-detects design dimensions. Editable with "Edit configuration" inline form. Persisted in sessionStorage.
- **Folder upload**: Drag & drop folders with `webkitGetAsEntry()` recursive traversal. Also `webkitdirectory` input for file picker. Non-.dpt files silently ignored with count in status message.
- **Deduplication**: Both frontend and backend replace files with same name on re-upload (prevents duplicate processing).
- **Lock button**: Fixes auto-detected anchors as manual, preventing re-detection on smoothing toggle.
- **Process confirmation**: Dialog shows file count, anchor point mode, and smoothing config before batch processing.
- **ANOVA Description column**: Maps coded terms (X1, I(X2**2), X1:X3) to readable names (Temperature, Time^2, Temp x NaClO).
- **p-value formatting**: Shows "<0.001" instead of raw decimals like "0.000010".
- **Surface toggle**: "Switch to 2D" button for contour map view.
- **Build info**: Footer shows git commit hash fetched from `/api/health` at page load.
- **Slow-load banner**: Yellow banner appears after 5s of waiting (for Render cold starts).

---

## 6. Key Files Reference

### `backend/ftir_pipeline.py` (DO NOT MODIFY -- scientifically validated)

| Function | What it does |
|---|---|
| `cargar_espectro(ruta)` | Reads .dpt, returns (x, y) sorted ascending |
| `suavizar_espectro(y, metodo, ventana)` | Applies smoothing (5 methods) |
| `calcular_baseline(x, y, ..., custom_anchor_points)` | B-spline cubic with not-a-knot. Returns (baseline, anchor_x, anchor_y) |
| `calcular_metricas_pico(x, y_corr, rango)` | Returns {altura, area, x_pico} |
| `extraer_experimento_replica(nombre)` | Parses filename with FILENAME_PATTERN regex |
| `procesar_archivo(ruta, ...)` | Full pipeline for 1 file |
| `procesar_lote(rutas, ...)` | Parallel batch processing (ThreadPoolExecutor) |

### `backend/anova_analysis.py` (validated)

| Function | What it does |
|---|---|
| `construir_matriz_diseno_box_behnken()` | Returns 15-row DataFrame with coded + real levels |
| `preparar_datos_anova(df)` | Merges 150 results with design matrix (no averaging) |
| `correr_anova_completo(df, var, maximize)` | Full quadratic OLS + ANOVA table + optimum + surfaces |
| `_calcular_optimo(modelo, maximize)` | scipy.optimize.minimize with 9 starting points, bounds [-1,1]^3 |
| `superficie_respuesta(modelo, fijo, fx, fy)` | Generates 50x50 prediction grid for one factor pair |

### `backend/synthetic.py`

Generates 150 synthetic FTIR spectra with seed=42 (reproducible). Model:
```python
area = (0.70 - 0.13*X1 + 0.07*X2 + 0.12*X2**2 - 0.13*X3**2
        + 0.13*X1*X2 - 0.16*X2*X3)
```
Each spectrum: polynomial baseline + Gaussian carboxylate peak at 1620 cm-1 + C-O peak at 1050 cm-1 + Gaussian noise. Generated on-the-fly, NOT committed to repo.

### `backend/config.py`

```python
RANGO_CARBOXILATO = (1600, 1650)
RANGO_REFERENCIA = (950, 1100)
MIN_ANCHOR_POINTS = 4
MAX_ANCHOR_POINTS = 50
FILENAME_PATTERN = re.compile(
    r"(?:Amostra[_ ]TCNF[_ ]Paul[_ ]|Synthetic[_ ]TCNF[_ ])n[._](\d+)[._](\d+)\.dpt"
)
DEFAULT_SMOOTHING_METHOD = "AAV"
DEFAULT_SMOOTHING_WINDOW = 5
```

### `frontend/js/app.js` (~750 lines)

Key functions: `handleFilesSelected()`, `handleLoadExamples()`, `loadBaselinePreview()`, `handleProcess()` (with confirmation), `handleAnova()`, `renderAnovaResults()`, `renderUploadSummary()`, `detectDesign()`, `handleLockAnchors()`, `handleExportPoints()`, `handleImportPoints()`, `toggleSurfaceMode()`.

### `frontend/js/plot.js`

Key functions: `plotBaselinePreview()`, `plotSurface(divId, surfaceData, optimo, mode)`, `plotResultsBoxplot()`. Handles coded-to-real conversion for surface axes. Includes `requestAnimationFrame` resize and `automargin` for proper rendering.

### `frontend/js/api.js`

Wrapper functions: `uploadFiles()`, `baselinePreview()`, `processAll()`, `runAnova(variable, maximize)`, `loadExamples()`, `getExcelUrl()`. Includes slow-load banner (5s timeout).

### `frontend/js/upload.js`

Handles drag & drop (files and folders), `webkitGetAsEntry()` recursive directory traversal, `webkitdirectory` folder input. Filters .dpt only, reports ignored count.

### `backend/excel_export.py`

Generates Excel with 5 sheets:
1. **Datos Crudos**: one row per processed file
2. **Resumen por Experimento**: 15 rows with mean/std per experiment
3. **ANOVA**: Source, SS, df, F, p-value
4. **Coeficientes**: model terms with coefficients and p-values
5. **Processing Configuration**: pipeline version, date, file count, smoothing, anchors, ranges

---

## 7. Critical Decisions Made

| # | Decision | Reason |
|---|---|---|
| 1 | Default smoothing OFF | Best match with Mario's Origin output (2.6% vs 4-5% with any smoothing) |
| 2 | Hybrid auto + manual override | Mario configures ONCE, applies to 150. Auto-detect saves time, manual allows tweaking |
| 3 | `mode='reflect'` in scipy AAV | Default scipy, standard in literature. Changing to `nearest` only reduces 2.5%->1.8%, not to 0% |
| 4 | Individual replicates in ANOVA (df=140) | With 15 means, df=5, zero significant factors. With 150 reps, df=140, proper statistical power |
| 5 | scipy.optimize.minimize (not analytic) | Analytic stationary point + clip gives wrong result when optimum is on boundary (common for Box-Behnken) |
| 6 | Snap-to-Spectrum OFF in validation | For fair comparison, Origin must use exact Y values from our anchors |
| 7 | Generalizable design detection | Auto-detect from filenames, not hardcoded 15x10 |
| 8 | Synthetic data generated on-the-fly | Seed=42 for reproducibility, doesn't inflate repo with 150 files |
| 9 | No LOWESS/LOESS | Mario's tutorial says "avoid" for FTIR |
| 10 | Professional branding in footer | Portfolio project, subtle but present |

---

## 8. Bugs Found and Fixed

### Bug 1: File duplication on upload (CRITICAL)
**Symptom:** 150 files produced 458 Excel rows (each file processed 3x).
**Cause:** No deduplication in frontend or backend on re-upload.
**Fix:** Backend replaces existing file with same name. Frontend merges by filename instead of appending.

### Bug 2: Optimum reported arbitrary point (CRITICAL)
**Symptom:** "Optimum" = 40 C, 60min, 7.98mL, Y=0.54. True maximum was 20 C, 60min, 9.72mL, Y=1.17.
**Cause:** Analytic stationary point clipped to [-1,1] without checking if it was max/min/saddle.
**Fix:** scipy.optimize.minimize with 9 starting points and bounds.

### Bug 3: Smoothing toggle re-detected anchors in manual mode
**Symptom:** 19 anchors changed to 18 when toggling smoothing.
**Cause:** Auto-detection ran even in manual mode.
**Fix:** `state.mode === "manual"` sends custom_anchor_points, preventing re-detection. Only Y values recalculated.

### Bug 4: JSON export only had X values (no Y)
**Fix:** Version 1.1 JSON includes `anchor_points` array with {x, y} pairs. Keeps `anchor_points_cm` for backward compatibility.

### Bug 5: Surface plots clipped on initial render
**Cause:** Plotly initialized before container had final size.
**Fix:** `requestAnimationFrame` resize + generous margins + `automargin: true` + window resize listener.

### Bug 6: ANOVA showed no significant factors (with duplicated data)
**Cause:** Duplicated files inflated residual variance.
**Fix:** Indirect, fixed by Bug 1 dedup.

---

## 9. Pipeline Internals

### 9.1 Single file processing

```
1. Read .dpt -> (x, y_raw)
2. If smoothing ON: y = suavizar(y_raw, method, window)
   If smoothing OFF: y = y_raw
3. Anchor points X (from auto-detect or custom)
   anchor_y = y[indices]  -- Y from current spectrum (smoothed or not)
4. spline = make_interp_spline(anchor_x, anchor_y, k=3, bc_type="not-a-knot")
   baseline = spline(x)
5. y_corrected = y - baseline
6. Metrics in 1600-1650 (carboxylate) and 950-1100 (reference)
7. normalized = height_carb / height_ref
8. Extract (experiment, replica) from filename
9. Return dict with all values
```

### 9.2 Batch processing

```
1. Frontend sends POST /api/process with config (NOT file_ids)
   Config includes: custom_anchor_points (if manual), smoothing params
2. Backend iterates ALL session files in parallel (ThreadPoolExecutor)
   Each file processed with the SAME config
3. Returns DataFrame with N rows (one per file)
```

**Important:** All 150 files receive exactly the same configuration. No per-file re-detection.

### 9.3 ANOVA execution

```
1. Frontend sends POST /api/anova with variable_respuesta and maximize
2. Backend:
   a. preparar_datos_anova(): merge 150 results with Box-Behnken design -> 150 rows with X1,X2,X3,Y
   b. ols("Y ~ X1+X2+X3+I(X1**2)+I(X2**2)+I(X3**2)+X1:X2+X1:X3+X2:X3").fit()
   c. anova_lm(modelo, typ=2)
   d. _calcular_optimo(modelo, maximize) -> multi-start scipy.optimize
   e. _generar_superficies(modelo) -> 3 grids with third factor fixed at 0
3. Returns AnovaResponse with table, coefficients, optimum (coded + real), surfaces
```

### 9.4 Excel generation

5 sheets: Datos Crudos (150 rows), Resumen por Experimento (15 rows with mean/std), ANOVA table, Coefficients, Processing Configuration (full traceability).

---

## 10. Known Limitations

### 10.1 2.5% deviation with smoothing
Caused by scipy vs Origin boundary handling. Systematic, doesn't affect ANOVA. No fix planned.

### 10.2 Render free tier cold start
First load takes 30-60s after 15 min of inactivity. Slow-load banner appears after 5s. Could be mitigated with UptimeRobot (not configured).

### 10.3 Only Box-Behnken with 3 factors
Does not support CCD, Doehlert, Full Factorial 2^4+, etc.

### 10.4 No LOWESS/LOESS
Deliberate decision per Mario's tutorial.

### 10.5 Session persistence
Cookies maintain session_id across page refreshes -- uploaded files persist in backend memory. However, Render free tier restarts periodically, which clears all sessions. Not suitable for long-term storage.

### 10.6 Filename pattern
Only matches `Amostra_TCNF_Paul_n.X.Y.dpt` and `Synthetic_TCNF_n.X.Y.dpt`. Other naming conventions require regex update in `config.py`.

---

## 11. Test Coverage

**Total: 55 tests, all passing.**

### Test files

| File | Tests | Coverage |
|---|---|---|
| `tests/test_pipeline.py` | ~22 | Spectrum loading, smoothing, baseline, metrics, filename parsing, batch |
| `tests/test_anova.py` | ~15 | Data preparation, ANOVA structure, significant terms, R-squared, optimize max/min, surfaces |
| `tests/test_api.py` | ~18 | All endpoints: health, upload, files, delete, spectrum, baseline preview, process, results, ANOVA, export |

### CI

`.github/workflows/tests.yml` runs `pytest tests/ -v` on every push and PR.

---

## 12. Current Status

### Completed

- App deployed on Render
- Public repo on GitHub
- Rigorous validation against OriginLab Pro 2024 (99.66% / 97.50%)
- Scientific pipeline fully functional
- Box-Behnken ANOVA with 150 individual replicates (df=140)
- Response Surfaces with 3D/2D toggle and real-value axes
- Optimum finder with scipy.optimize multi-start + max/min toggle
- 55 tests passing + GitHub Actions CI
- "Load example data" button with 150 synthetic spectra
- Folder upload with recursive scan
- File deduplication on re-upload
- Upload summary panel with design auto-detection
- Process confirmation dialog
- JSON export/import of anchor points (v1.1 with X+Y)
- Lock button for anchor points
- Excel export with 5 sheets (full traceability)
- Professional README + ARCHITECTURE.md + SPEC.md + LICENSE
- Professional footer with GitHub/LinkedIn/Contact links
- Build info (commit hash) in footer

### Optional next steps

- Configure UptimeRobot for Render keep-alive
- Configurable filename regex from the UI
- Screenshot/GIF in README for portfolio impact
- Residual plots (Q-Q, residuals vs predicted) for ANOVA validation
- Lack-of-fit test (separating pure error)
- Dark mode

---

## 13. Reference Data

### 13.1 The 19 anchor points X (auto-detected for Amostra_TCNF_Paul_n_1_1.dpt)

```
399.54543, 469.20977, 651.56640, 825.72723, 909.73422,
1092.09085, 1186.34260, 1389.18874, 1510.07684, 1686.28662,
1870.69221, 2005.92297, 2149.34954, 2257.94394, 2378.83204,
2979.17467, 3712.69911, 3852.02777, 3997.50329
```

### 13.2 Corresponding Y values (original spectrum, no smoothing)

```
0.09032, 0.09104, 0.06716, 0.03536, 0.04817,
0.06040, 0.01720, 0.02673, 0.01322, 0.01153,
0.00942, 0.00785, 0.00928, 0.01167, 0.01222,
0.01900, 0.00793, 0.00872, 0.01075
```

### 13.3 Corresponding Y values (smoothed with AAV-5)

```
0.09098, 0.09106, 0.06733, 0.03540, 0.04838,
0.06052, 0.01758, 0.02684, 0.01245, 0.01155,
0.00958, 0.00812, 0.00957, 0.01180, 0.01236,
0.01903, 0.00867, 0.00970, 0.01075
```

### 13.4 Box-Behnken design matrix (15 experiments)

| Exp | X1 | X2 | X3 | Temp | Time | NaClO |
|---|---|---|---|---|---|---|
| 1 | -1 | -1 | 0 | 20 | 60 | 8.0 |
| 2 | +1 | -1 | 0 | 40 | 60 | 8.0 |
| 3 | -1 | +1 | 0 | 20 | 120 | 8.0 |
| 4 | +1 | +1 | 0 | 40 | 120 | 8.0 |
| 5 | -1 | 0 | -1 | 20 | 90 | 6.1 |
| 6 | +1 | 0 | -1 | 40 | 90 | 6.1 |
| 7 | -1 | 0 | +1 | 20 | 90 | 10.0 |
| 8 | +1 | 0 | +1 | 40 | 90 | 10.0 |
| 9 | 0 | -1 | -1 | 30 | 60 | 6.1 |
| 10 | 0 | +1 | -1 | 30 | 120 | 6.1 |
| 11 | 0 | -1 | +1 | 30 | 60 | 10.0 |
| 12 | 0 | +1 | +1 | 30 | 120 | 10.0 |
| 13-15 | 0 | 0 | 0 | 30 | 90 | 8.0 |

Experiments 13-15 are center point replicates (standard Box-Behnken).

### 13.5 Synthetic model results

ANOVA with synthetic data: R^2 = 0.95, df_residual = 140, 6 significant terms.
Optimum (maximize): ~20 C, ~60 min, ~9.23 mL, predicted ~1.13.

---

## 14. How to Run Locally

```bash
git clone https://github.com/sebastianquispearias/ftir-spectral-analysis-pipeline
cd ftir-spectral-analysis-pipeline
pip install -r requirements.txt
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
# Open http://localhost:8000
```

### Run tests

```bash
pytest tests/ -v
# Expected: 55 passing
```

### Run validation against Origin

```bash
python scripts/validate_against_origin.py
# Requires Origin .dat files in data/examples/origin_validation/
```

### Environment variables

None required for local use. Render uses `PYTHON_VERSION=3.11.9` via runtime.txt and render.yaml.

---

## 15. Contact

### Developer

- **Name:** Sebastian Quispe Arias
- **Email:** sarias@inf.puc-rio.br
- **GitHub:** https://github.com/sebastianquispearias
- **LinkedIn:** https://www.linkedin.com/in/sebastian-quispe-arias-27b52214a

### Scientific client

- **Name:** Mario
- **Institution:** PUC-Rio (Departamento de Engenharia Quimica)
- **Thesis topic:** TEMPO-mediated oxidation of TCNF

---

## 16. Document Maintenance

This document should be updated when:
- Endpoints, public functions, or files are added/renamed.
- Frontend state management changes.
- Significant tests are added.
- Total test count changes.

To keep it synchronized: ask Claude Code to review this file against the actual code periodically.

---

**Document version:** 1.1
**Last updated:** 2026-05-05
**Next update:** when Mario provides feedback from real data usage.
