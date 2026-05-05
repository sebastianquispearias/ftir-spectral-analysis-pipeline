# Architecture Decisions

## Why FastAPI?
- Built-in OpenAPI docs (`/docs` endpoint).
- Async support for batch processing of 150+ files.
- Pydantic validation reduces input errors at API boundary.
- Lightweight, easy to deploy on Render free tier.

## Why scipy over NumPy alone?
- Pre-built B-spline (`make_interp_spline`) with proper boundary conditions.
- Battle-tested numerical stability.
- Integration via `scipy.integrate.trapezoid` is mathematically equivalent to Origin's integration.

## Why statsmodels for ANOVA?
- Implements full quadratic model with interaction terms.
- Returns standard ANOVA table compatible with academic papers.
- Consistent with Minitab, JMP, and OriginLab Stats outputs.

## Why scipy.optimize.minimize over analytical solution?
- Analytical solution `x = -0.5 * B^-1 * b` finds the stationary point, which may be a max, min, or saddle.
- For Box-Behnken designs, the true optimum is often on the boundary of the experimental region.
- Multi-start L-BFGS-B with `bounds=[(-1,1)]*3` handles boundary optima correctly.

## Why Render over GitHub Pages?
- Backend requires Python execution; GitHub Pages only serves static files.
- Free tier is sufficient for academic use.
- Cold start (~30s) is acceptable.

## Trade-offs

### scipy.uniform_filter1d `mode='reflect'` vs Origin's AAV
- Difference of ~0.0007 in spectrum boundary points.
- Propagates to ~2.5% difference in peak area when anchor points include spectrum extremes.
- Kept `mode='reflect'` (scipy default) because different modes give different deviations and none reaches 0%. The deviation is systematic and doesn't affect ANOVA conclusions.

### Coded vs real factor levels in ANOVA
- ANOVA uses coded levels (-1, 0, +1) for direct comparability of effect magnitudes.
- Frontend converts to real levels for visualization.
- Standard approach in DOE literature.

### Replicates vs experiment means in ANOVA
- Initial implementation used 15 experiment means (df_residual = 5).
- Changed to 150 individual replicates (df_residual = 140).
- Following Montgomery's recommendation: use individual observations to separate pure error from lack of fit.
