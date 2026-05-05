# Scientific Method

## Baseline Correction

### Evolution of the approach

The original backend plan used manually configurable anchor points. A subsequent
attempt at automatic detection using Savitzky-Golay smoothing with second
derivative zero-crossing produced 50-80% error against a manually processed
reference from OriginLab. The validated method uses Adjacent Averaging (AAV)
smoothing with window 5 + valley detection + mandatory spectrum endpoints +
cubic B-spline interpolation, achieving <3% error.

### Algorithm

1. **Smoothing**: Adjacent Averaging (AAV) with a 5-point moving window.
   Alternative methods (Savitzky-Golay, Percentile Filter, FFT, Binomial) are
   available as parameters but produced larger deviations in validation tests.

2. **Anchor point detection**: local minima (valleys) of the smoothed spectrum
   are identified using `scipy.signal.find_peaks` on the inverted signal.
   Spectrum endpoints (lowest and highest cm⁻¹) are always included.
   Default parameters: `distance=40` indices, `prominence=0.0003`.

3. **Interpolation**: cubic B-spline (`scipy.interpolate.make_interp_spline`,
   k=3) with explicit not-a-knot boundary condition, which is the most common
   convention in commercial spectroscopy software including OriginLab.

4. **Subtraction**: the spline-evaluated baseline is subtracted from the
   original (unsmoothed) spectrum.

### Hybrid mode

The pipeline supports two modes:
- **Automatic** (default, validated): anchor points detected as described above.
- **Manual**: the user supplies a custom list of anchor points (e.g., to exactly
  reproduce a manually-tuned Origin output). Manual mode bypasses
  smoothing-based detection but still uses cubic B-spline interpolation.

### Empirical Validation

This method approximates the OriginLab Peak Analyzer workflow followed by the
researcher. It was empirically validated against one manually processed reference
spectrum (`Amostra TCNF Paul n.1.1.dpt`):

| Metric | Origin (manual) | Our pipeline | Deviation |
|--------|----------------|--------------|-----------|
| Peak height | 0.02323 | 0.02335 | 0.5% |
| Peak area | 0.77313 | 0.75335 | 2.6% |

These deviations are well within the typical replicate variability in FTIR
measurements (CV ~22% across 10 replicates). Other materials or instruments may
require parameter retuning.

## Quantification Metrics

For a given wavenumber range (e.g., 1600-1650 cm⁻¹ for carboxylate):

- **Peak height**: maximum intensity after baseline correction.
- **Integrated area**: trapezoidal integration (negative values clamped to zero).
- **Normalized intensity**: peak height / reference peak height (C-O at ~1024 cm⁻¹).

## ANOVA (Box-Behnken Design)

A full quadratic response surface model is fitted to the 15 experiment means:

Y = b₀ + b₁X₁ + b₂X₂ + b₃X₃ + b₁₁X₁² + b₂₂X₂² + b₃₃X₃²
    + b₁₂X₁X₂ + b₁₃X₁X₃ + b₂₃X₂X₃

The optimal experimental condition is estimated from the model gradient.
