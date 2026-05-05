# FTIR Spectral Analysis Pipeline

Automated baseline correction and Box-Behnken ANOVA for FTIR spectroscopy data.

**[Live Demo](https://ftir-spectral-analysis-pipeline.onrender.com)** (first load may take 30-60s on free tier)

![Python](https://img.shields.io/badge/Python-3.11-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-0.104+-green)
![Tests](https://img.shields.io/badge/Tests-55_passing-brightgreen)
![License](https://img.shields.io/badge/License-MIT-yellow)

## The Problem

A chemistry PhD student at PUC-Rio needed to process 150 FTIR spectra (15 experiments x 10 replicates) for a Box-Behnken DOE study on TEMPO-mediated oxidation of nanocellulose. The manual workflow in OriginLab Pro took 5+ hours per dataset, and small variations in anchor point selection between samples introduced reproducibility issues.

## The Solution

A web application that automates the complete pipeline:

- **B-spline cubic baseline correction** validated against OriginLab Pro 2024
- **Auto-detection of anchor points** with manual override (drag, add, remove)
- **5 smoothing methods**: Adjacent Averaging, Savitzky-Golay, Percentile, FFT, Binomial
- **Box-Behnken ANOVA** with full quadratic model on individual replicates (N=150)
- **Response Surface Methodology** with 3D visualization and 2D contour toggle
- **Optimum finder** using scipy.optimize with multi-start (handles boundary optima)
- **Excel export** with full traceability: configuration, raw data, summary, ANOVA, coefficients
- **JSON export/import** of anchor points and smoothing config for reproducibility

## Validation

Rigorously validated against OriginLab Pro 2024 with identical parameters (19 anchor points, BSpline interpolation with not-a-knot boundary conditions):

| Configuration | Peak Height | Peak Area | Agreement |
|---|---|---|---|
| Without spectrum smoothing | 0.41% | 0.34% | **99.66%** |
| With AAV-5 smoothing | 2.39% | 2.50% | **97.50%** |

The residual deviation under smoothing is attributable to differences in boundary handling between scipy's `uniform_filter1d` and OriginLab's internal AAV implementation. Both deviations are systematic and do not affect ANOVA conclusions.

See `data/examples/origin_validation/validation_report.md` for the complete validation report.

## Results

- **5-hour manual workflow reduced to 60-second automated processing**
- Mathematical equivalence to OriginLab Pro 2024 demonstrated empirically
- Standard ANOVA with 150 individual replicates (Montgomery, *Design of Experiments*, 8th ed.)

## Try It

1. **[Open the live demo](https://ftir-spectral-analysis-pipeline.onrender.com)**
2. Click **"Load example data"** to load 150 synthetic spectra (Box-Behnken 15x10)
3. Click **"Process All Spectra"** then **"Run ANOVA"**
4. Explore the response surfaces and download the Excel report

Or run locally:

```bash
git clone https://github.com/sebastianquispearias/ftir-spectral-analysis-pipeline.git
cd ftir-spectral-analysis-pipeline
pip install -r requirements.txt
uvicorn backend.main:app --reload
# Open http://localhost:8000
```

## Tech Stack

| Component | Technology |
|---|---|
| Backend | Python, FastAPI |
| Numerical processing | NumPy, SciPy |
| Statistics | statsmodels (OLS, ANOVA) |
| Optimization | scipy.optimize (L-BFGS-B) |
| Frontend | Vanilla JS, Tailwind CSS, Plotly.js |
| Excel export | openpyxl |
| Deployment | Render (free tier) |
| Testing | pytest (55 tests) |

## Project Structure

```
backend/
  ftir_pipeline.py        # Core scientific pipeline (validated)
  anova_analysis.py       # Box-Behnken ANOVA + RSM
  synthetic.py            # Synthetic example data generator
  main.py                 # FastAPI endpoints
  models.py               # Pydantic schemas
frontend/
  index.html
  js/
    app.js                # State management
    plot.js               # Plotly visualizations
    api.js                # Backend communication
    upload.js             # Drag & drop + folder upload
tests/                    # 55 tests
scripts/
  validate_against_origin.py
data/examples/
  origin_validation/      # Validation reports and Origin reference files
docs/
  ARCHITECTURE.md         # Technical decisions
  SPEC.md                 # Functional and non-functional requirements
```

## Run Tests

```bash
pytest tests/ -v
```

## License

MIT License -- see [LICENSE](LICENSE).

## About

Built by **Sebastian Quispe Arias** -- PUC-Rio

[LinkedIn](https://www.linkedin.com/in/sebastian-quispe-arias-27b52214a) | [Email](mailto:sarias@inf.puc-rio.br) | [GitHub](https://github.com/sebastianquispearias)
