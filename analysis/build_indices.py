"""Rebuild the INFRA and HCR composite indices from their public sources.

Construction follows the measurement protocol ("Measurement of Variables"):
  1. each component is converted to a z-score within year across the 49 countries;
  2. the index is the mean of the available component z-scores, requiring at least
     MIN_COMPONENTS of them in that country-year.
Internal gaps in a country's component series are filled by linear interpolation
(at most MAX_GAP years); series are never extrapolated beyond the first or last
reported year. Sensitivity version: first principal component of the same z-scores.

Input : data/raw/sources/  (from fetch_sources.py)
Output: data/processed/indices.csv, data/processed/index_components.csv (also docs/data/),
        data/processed/index_report.json
"""
from pathlib import Path
import json

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "raw" / "sources"
PROC = ROOT / "data" / "processed"
WEB = ROOT / "docs" / "data"

YEARS = range(1990, 2025)
MAX_GAP = 5
MIN_COMPONENTS = 2
# HDR schooling series end in 2023; later HCR values would rest on enrolment alone.
LAST_YEAR = {"INFRA": 2024, "HCR": 2023}

# component -> (source file key, label, source, log before z-scoring?)
INFRA = {
    "elec": ("EG.ELC.ACCS.ZS", "Access to electricity (% of population)", "World Bank WDI", False),
    "mobile": ("IT.CEL.SETS.P2", "Mobile cellular subscriptions per 100", "ITU (via WDI)", True),
    "internet": ("IT.NET.USER.ZS", "Internet users (% of population)", "ITU (via WDI)", True),
    "fixedtel": ("IT.MLT.MAIN.P2", "Fixed telephone subscriptions per 100", "ITU (via WDI)", True),
}
HCR = {
    "mys": ("hdr:mys", "Mean years of schooling (adults 25+)", "UNDP HDR", False),
    "eys": ("hdr:eys", "Expected years of schooling", "UNDP HDR", False),
    "tertiary": ("SE.TER.ENRR", "Tertiary enrolment (% gross)", "UNESCO UIS (via WDI)", True),
    "secondary": ("SE.SEC.ENRR", "Secondary enrolment (% gross)", "UNESCO UIS (via WDI)", False),
}
# Listed in the protocol but too sparse for SSA to enter the index (reported only).
EXCLUDED = {
    "rd": ("GB.XPD.RSDV.GD.ZS", "R&D expenditure (% of GDP)", "UNESCO UIS (via WDI)"),
    "researchers": ("SP.POP.SCIE.RD.P6", "Researchers per million", "UNESCO UIS (via WDI)"),
    "broadband": ("IT.NET.BBND.P2", "Fixed broadband subscriptions per 100", "ITU (via WDI)"),
}


def load_series(key, iso3):
    if key.startswith("hdr:"):
        v = key[4:]
        h = pd.read_csv(SRC / "hdr_composite.csv", encoding="latin1")
        cols = [c for c in h.columns if c.startswith(v + "_") and c[len(v) + 1:].isdigit()]
        d = h[["iso3"] + cols].melt("iso3", var_name="year", value_name="value").dropna()
        d["year"] = d["year"].str[len(v) + 1:].astype(int)
    else:
        d = pd.read_csv(SRC / f"wdi_{key}.csv")
    d = d[d["iso3"].isin(iso3)]
    return d.pivot(index="year", columns="iso3", values="value").reindex(index=YEARS, columns=iso3)


def interpolate_inside(w):
    """Linear interpolation of internal gaps up to MAX_GAP years; no extrapolation."""
    filled = w.interpolate(limit_area="inside")
    for c in w:  # undo fills inside gaps longer than MAX_GAP
        isna = w[c].isna()
        run = isna.groupby((~isna).cumsum()).transform("sum")
        filled.loc[isna & (run > MAX_GAP), c] = np.nan
    return filled


def zscore_by_year(w):
    mu, sd = w.mean(axis=1), w.std(axis=1)
    sd = sd.where(sd > 0)
    return w.sub(mu, axis=0).div(sd, axis=0)


def first_pc(z):
    """PC1 loadings from complete cases; score = loading-weighted mean of the available
    z-scores, so the PC index covers the same country-years as the equal-weight index."""
    C = np.corrcoef(z.dropna().values.T)
    vals, vecs = np.linalg.eigh(C)
    v = pd.Series(vecs[:, -1] * np.sign(vecs[:, -1].sum()), index=z.columns)
    score = z.mul(v).sum(axis=1, min_count=1) / z.notna().mul(v).sum(axis=1)
    return score, v.round(3).to_dict(), float(vals[-1] / vals.sum())


def build(spec, iso3, name):
    zs, raw_long = {}, []
    for comp, (key, *_ , logged) in spec.items():
        w = interpolate_inside(load_series(key, iso3))
        raw_long.append(w.stack(future_stack=True).rename(comp))
        zs[comp] = zscore_by_year(np.log1p(w) if logged else w).stack(future_stack=True)
    z = pd.DataFrame(zs)
    z.index.names = ["year", "iso3"]
    k = z.notna().sum(axis=1)
    in_range = z.index.get_level_values("year") <= LAST_YEAR[name]
    idx = z.mean(axis=1).where((k >= MIN_COMPONENTS) & in_range)
    pc, loadings, share = first_pc(z[in_range])
    out = pd.DataFrame({name: idx, f"{name}_PC": pc.reindex(z.index).where(idx.notna()), f"{name}_k": k})
    comps = pd.concat(raw_long, axis=1)
    comps.index.names = ["year", "iso3"]
    report = {"components": {c: {"label": v[1], "source": v[2], "code": v[0], "log": v[3],
                                 "obs": int(z[c].notna().sum())} for c, v in spec.items()},
              "pc_loadings": loadings, "pc_share": round(share, 3),
              "corr_equal_pc": round(float(out[[name, f"{name}_PC"]].corr().iloc[0, 1]), 3),
              "obs": int(idx.notna().sum()),
              "years": [int(idx.dropna().index.get_level_values("year").min()),
                        int(idx.dropna().index.get_level_values("year").max())]}
    return out, comps, report


def main():
    from build_panel import COUNTRIES
    iso3 = sorted({v[1] for v in COUNTRIES.values()})
    inf, inf_c, inf_r = build(INFRA, iso3, "INFRA")
    hcr, hcr_c, hcr_r = build(HCR, iso3, "HCR")
    idx = inf.join(hcr, how="outer").reset_index()
    idx.to_csv(PROC / "indices.csv", index=False)
    comps = inf_c.join(hcr_c, how="outer").reset_index().sort_values(["iso3", "year"])
    for folder in (PROC, WEB):  # the site offers the components as a download
        comps.to_csv(folder / "index_components.csv", index=False)
    excluded = {c: {"label": v[1], "source": v[2], "code": v[0],
                    "obs": int(load_series(v[0], iso3).notna().sum().sum())} for c, v in EXCLUDED.items()}
    report = {"INFRA": inf_r, "HCR": hcr_r, "excluded": excluded,
              "rules": {"max_gap": MAX_GAP, "min_components": MIN_COMPONENTS, "years": [YEARS[0], YEARS[-1]]}}
    (PROC / "index_report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    for n, r in (("INFRA", inf_r), ("HCR", hcr_r)):
        print(f"{n}: {r['obs']} country-years {r['years']}, PC1 share {r['pc_share']}, "
              f"corr(equal, PC) {r['corr_equal_pc']}")


if __name__ == "__main__":
    main()
