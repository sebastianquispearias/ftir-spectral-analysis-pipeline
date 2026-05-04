# Scientific Method

## Baseline Correction

This application uses cubic B-spline interpolation (`scipy.interpolate.make_interp_spline`, k=3) with not-a-knot boundary conditions to compute a baseline through user-defined anchor points.

This is a **reproducible approximation** to the baseline correction workflow in OriginLab. It is **not** a verified exact replication of Origin's internal algorithm. Empirical validation — comparing outputs from this tool and Origin on identical anchor points and a reference spectrum — is recommended before using these results in publications.

### How it works

1. The user selects anchor points (wavenumber positions in cm⁻¹) on flat regions of the spectrum (between peaks).
2. For each anchor point, the algorithm finds the nearest measured data point and takes its intensity.
3. A cubic B-spline is constructed that interpolates exactly through these points.
4. The baseline is subtracted from the original spectrum to produce the corrected spectrum.

### Quantification Metrics

For a given wavenumber range (e.g., 1600–1650 cm⁻¹ for the carboxylate peak):

- **Peak height**: Maximum intensity in the range after baseline correction.
- **Integrated area**: Trapezoidal integration of the corrected spectrum (negative values clamped to zero).
- **Normalized intensity**: Peak height divided by a reference peak height (e.g., C–O at ~1024 cm⁻¹).

## ANOVA (Box-Behnken Design)

A full quadratic response surface model is fitted to the experiment means:

Y = b₀ + b₁X₁ + b₂X₂ + b₃X₃ + b₁₁X₁² + b₂₂X₂² + b₃₃X₃² + b₁₂X₁X₂ + b₁₃X₁X₃ + b₂₃X₂X₃

The model is fitted on the 15 per-experiment means (not the 150 individual replicas). This is a standard approach for response surface methodology.
