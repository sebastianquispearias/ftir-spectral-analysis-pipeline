# FTIR Spectral Analysis Pipeline

**Automated baseline correction and statistical analysis for FTIR spectra in Box-Behnken experimental designs.**

![Python](https://img.shields.io/badge/Python-3.12-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-0.104+-green)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

## The Problem

A chemistry researcher optimizing cellulose nanofiber functionalization via TEMPO oxidation runs a Box-Behnken experiment with **3 factors** (temperature, time, NaClO volume) across **15 conditions**, each measured **10 times** — producing **150 FTIR spectra**.

Processing each spectrum manually in OriginLab takes ~3 minutes: select anchor points, trace a baseline, subtract it, isolate the carboxylate peak, integrate the area. **150 files = 7+ hours** of repetitive work, with human variability contaminating the subsequent ANOVA.

## The Solution

A web application that reduces this to **minutes**:

1. **Upload** all `.dpt` spectrum files at once (drag & drop)
2. **Configure** baseline anchor points interactively on the spectrum — click to add, click to remove, or auto-detect flat regions
3. **Process** all 150 files with identical anchor points — consistent, reproducible results
4. **Analyze** with built-in ANOVA for Box-Behnken designs — identifies significant factors automatically
5. **Visualize** with 3D response surface plots — find the optimal experimental condition
6. **Export** everything to Excel — ready for the thesis

## Stack

| Component | Technology |
|---|---|
| Backend | FastAPI (Python) |
| Numerical processing | NumPy, SciPy |
| Statistics | statsmodels (OLS, ANOVA) |
| Frontend | Vanilla JS, Tailwind CSS, Plotly.js |
| Excel export | openpyxl |
| Testing | pytest (51 tests) |

## How It Works

### Baseline Correction

The app uses **cubic B-spline interpolation** (`scipy.interpolate.make_interp_spline`, k=3, not-a-knot boundary conditions) through user-defined anchor points to compute a baseline.

This is a **reproducible approximation** to Origin's baseline correction workflow. Empirical validation — comparing outputs from this tool and Origin on identical anchor points — is recommended before using results in publications.

### Quantification

For each spectrum, three metrics are computed in the carboxylate peak region (1600–1650 cm⁻¹):

- **Peak height**: maximum intensity after baseline correction
- **Integrated area**: trapezoidal integration of the corrected spectrum
- **Normalized intensity**: peak height divided by a reference peak (C–O at ~1024 cm⁻¹)

### ANOVA

A full quadratic response surface model is fitted to the 15 experiment means:

```
Y = b₀ + b₁X₁ + b₂X₂ + b₃X₃ + b₁₁X₁² + b₂₂X₂² + b₃₃X₃²
    + b₁₂X₁X₂ + b₁₃X₁X₃ + b₂₃X₂X₃
```

The optimal experimental condition is estimated from the model gradient.

## Run Locally

```bash
# Clone
git clone https://github.com/YOUR_USER/ftir-spectral-analysis-pipeline.git
cd ftir-spectral-analysis-pipeline

# Create virtual environment
python -m venv .venv

# Activate (Windows)
.\.venv\Scripts\Activate.ps1

# Activate (macOS/Linux)
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run
uvicorn backend.main:app --reload

# Open http://localhost:8000
```

## Run Tests

```bash
pytest tests/ -v
```

**51 tests** covering:
- Spectrum loading and validation (empty, corrupt, wrong columns)
- Baseline interpolation (anchor point validation, boundary cases)
- Peak metrics (synthetic Gaussian with known analytical solution)
- ANOVA (synthetic data with known significant terms)
- All API endpoints (upload, process, ANOVA, export)

## Project Structure

```
├── backend/
│   ├── main.py              # FastAPI app, 11 endpoints
│   ├── ftir_pipeline.py     # Spectrum processing core
│   ├── anova_analysis.py    # Box-Behnken ANOVA
│   ├── excel_export.py      # Excel report generation
│   ├── models.py            # Pydantic schemas
│   └── config.py            # Constants
├── frontend/
│   ├── index.html           # Single-page application
│   ├── css/styles.css
│   └── js/
│       ├── app.js           # Main application logic
│       ├── api.js           # Backend API client
│       ├── plot.js          # Plotly chart functions
│       └── upload.js        # Drag & drop handler
├── tests/                   # 51 tests (pytest)
├── data/examples/           # Sample .dpt files
├── docs/
│   ├── method.md            # Scientific method documentation
│   └── api.md               # API reference
├── Dockerfile
└── render.yaml
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/upload` | Upload .dpt files |
| GET | `/api/files` | List uploaded files |
| DELETE | `/api/files/{id}` | Delete a file |
| GET | `/api/spectrum/{id}` | Get spectrum data |
| GET | `/api/anchor-points/auto/{id}` | Auto-detect anchor points |
| POST | `/api/baseline/preview` | Preview baseline correction |
| POST | `/api/process` | Process all spectra |
| GET | `/api/results` | Get results |
| POST | `/api/anova` | Run ANOVA analysis |
| GET | `/api/export/excel` | Download Excel report |

## Validation

Pipeline validated against 10 spectra from experiment 1 with anchor points `[450, 800, 1500, 1750, 1850, 2400, 3950]`:

| Metric | Expected | Obtained |
|--------|----------|----------|
| Mean peak height | ~0.027 | 0.0271 |
| Mean integrated area | ~0.902 | 0.9023 |
| Mean normalized intensity | ~0.273 | 0.2736 |

## License

MIT
