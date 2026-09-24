# SSA Sustainability Observatory

Data, code and an interactive dashboard for the study **"Paving an Extractive Path? Infrastructure, Human Capital and Environmental Pressure in Sub-Saharan Africa"** (Moore, Adams, Maisuh & Tackie).

- **Live dashboard:** https://ssa-ea.vercel.app
- **Repository:** https://github.com/moorekwesi/SSA-Environmental-Accounting

The dashboard covers 49 Sub-Saharan African countries (1960–2024 panel; models from 1990, when the infrastructure and human-capital indices begin) and has eight sections:

| Section | What it shows |
|---|---|
| Overview | Headline findings, hypothesis status |
| Explore data | Choropleth map by year, country time series, variable definitions and sources |
| Coverage | Country × variable coverage heatmap; countries reporting per year |
| Model results | Coefficient plots and tables for every outcome and specification; robustness of any term across specifications |
| Robustness | Leave-one-country-out coefficient plots; infrastructure coefficients at lags 0–3 and the 3-year moving average, on own and common samples |
| Scenario simulator | Change infrastructure, human capital and controls for one country; get the implied change in emissions, arable land or resource rents with a 95% interval |
| Data quality | Index construction; coverage, persistence and plausibility checks for every variable; rebuilt vs original indices |
| Methods & downloads | Model description, CSV/JSON downloads, citation |

## Repository layout

```
data/raw/            source workbook (one sheet per country) and variable metadata
data/raw/sources/    cached WDI/ITU/UNESCO and UNDP HDR downloads (from fetch_sources.py)
data/processed/      panel, indices, index components, results (generated)
analysis/            fetch_sources.py -> download the index component series
                     build_indices.py -> INFRA and HCR indices
                     build_panel.py   -> clean panel + dashboard data
                     estimate.py      -> models, robustness, diagnostics + dashboard results
docs/                the static website (Vercel serves this folder; see vercel.json)
  data/              JSON/CSV read by the site (generated)
  assets/            app.js, style.css
```

## Reproduce

```bash
python -m pip install -r requirements.txt
python analysis/fetch_sources.py   # skips files already in data/raw/sources/
python analysis/build_indices.py
python analysis/build_panel.py
python analysis/estimate.py
python -m http.server 8000 --directory docs   # open http://localhost:8000
```

`estimate.py` reproduces Tables 5–7 of the article: two-way fixed effects with Driscoll–Kraay standard errors (two lags), broad-control and equal-country-weighted sensitivity models, and pooled quantile regressions at the 25th, 50th and 75th percentiles. It also runs the leave-one-country-out and lagged-infrastructure models (Tables 8–9) and the index-construction comparison (Table 10). The article figures are drawn from these outputs by `../figures/make_figures.py`.

Requires Python 3.10+ (see `requirements.txt`).

## Updating the data

1. Replace `data/raw/datasets_complete.xlsx` (same sheet layout: `Country, Date, Code, TFP, THE, AL, TNRR, INFRA, HCR, GDP per capita, Population, Urbanisation, Energy Mix, Trade Openness`).
2. Re-run the two scripts. The site picks up the new files automatically.
3. To add institutional quality (INST), add a column to each sheet, add it to `VARS` in `build_panel.py`, and add the `INST` terms to `PREDICTORS`/`FULL` in `estimate.py`.

## Hosting

The site is static (no build step) and is served by Vercel from `docs/`, as set in `vercel.json`. Once the repository is connected to the Vercel project `ssa-ea`, every push to `main` redeploys https://ssa-ea.vercel.app automatically.

To connect it (one time): on vercel.com choose **Add New → Project**, import `moorekwesi/SSA-Environmental-Accounting`, name the project `ssa-ea`, leave *Framework Preset* as **Other** and deploy. The settings in `vercel.json` are picked up automatically.

GitHub Pages works as an alternative: in **Settings → Pages**, deploy from branch `main`, folder `/docs`.

## Known data issues (see the Data quality tab)

- **INFRA and HCR were rebuilt** from public sources (September 2026). The workbook's own series failed plausibility checks: HCR was indistinguishable from uniform random integers 21–79 (lag-1 autocorrelation −0.03), and INFRA scaled with country size. They are kept in the panel as `INFRA_ORIG` and `HCR_ORIG` for comparison only.
- **GII, AfDB, R&D and researcher series are not in the indices**: GII starts in 2007 and is not comparable across editions, and R&D and researcher data cover fewer than 200 SSA country-years.
- **TFP** is constant within every country and cannot enter a fixed-effects model.
- **INST** (WGI) is not yet merged.

## Citation

Moore, S. E., Adams, J., Maisuh, A., & Tackie, G. (2026). *Paving an extractive path? Infrastructure, human capital and environmental pressure in Sub-Saharan Africa.* University of Cape Coast.

Supported by a Group-led Research Support Grant from the Directorate of Research, Innovation and Consultancy (DRIC), University of Cape Coast.

## Licence

Code is released under the MIT License (see `LICENSE`).
