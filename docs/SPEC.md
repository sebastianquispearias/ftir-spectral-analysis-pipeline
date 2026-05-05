# FTIR Spectral Analysis Pipeline -- Specification

## Functional Requirements

### FR1 -- Spectrum Loading
Load .dpt files in standard FTIR ASCII format (X wavenumber, Y intensity).
Support batch upload (individual files or folder, recursive scan).

### FR2 -- Baseline Correction
Apply B-spline cubic interpolation with not-a-knot boundary conditions.

### FR3 -- Anchor Point Detection
Detect spectrum valleys automatically using scipy.signal.find_peaks on -y.
Allow manual override: drag, add, remove anchor points interactively.

### FR4 -- Smoothing
5 methods with configurable window: Adjacent Averaging, Savitzky-Golay, Percentile Filter, FFT Low-pass, Binomial.

### FR5 -- Box-Behnken ANOVA
Full quadratic model with 9 terms + intercept on individual replicates.
Report Sum of Squares, F-statistic, p-value for each term.
Report R-squared, R-squared adjusted, overall model significance.

### FR6 -- Response Surface Optimization
Find max or min using scipy.optimize.minimize with multi-start L-BFGS-B.
Bounds: coded levels [-1, 1] for each factor.
User toggle between maximization and minimization.

### FR7 -- Reproducibility
Export configuration (anchor points + smoothing) as JSON.
Excel output includes Processing Configuration sheet.

## Non-Functional Requirements

### NFR1 -- Validation
Maintain <=1% deviation from OriginLab Pro (without spectrum smoothing).
Maintain <=5% deviation with smoothing.

### NFR2 -- Performance
Process 150 spectra in <=60 seconds.

### NFR3 -- Generalizability
Auto-detect experimental design from filenames.
Not hardcoded to any specific design dimensions.

### NFR4 -- Deployment
Deployable on free hosting tiers.
Self-contained: no external services required.

## Acceptance Criteria

- [x] AC1: 55 unit and integration tests passing.
- [x] AC2: Validation against OriginLab documented (99.66% / 97.50%).
- [x] AC3: Excel export with 5 sheets.
- [x] AC4: Web deployment on Render functional.
- [x] AC5: JSON export/import of configuration.
- [x] AC6: Optimum finder handles boundary optima (max and min).
- [x] AC7: Response surfaces in 3D and 2D contour modes.
- [x] AC8: Synthetic example data for public testing.
