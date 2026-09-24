"""Stack the 49 country worksheets into one clean country-year panel.

Input : data/raw/datasets_complete.xlsx   (one sheet per country)
        data/raw/variable_metadata.xlsx  (variable definitions and sources)
        data/processed/indices.csv       (rebuilt INFRA and HCR, from build_indices.py)
The workbook's own INFRA and HCR columns are kept as INFRA_ORIG and HCR_ORIG for comparison.
Output: data/processed/panel.csv
        docs/data/panel.json, docs/data/metadata.json
"""
from pathlib import Path
import json

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
PROC = ROOT / "data" / "processed"
WEB = ROOT / "docs" / "data"

VARS = ["TFP", "THE", "AL", "TNRR", "INFRA", "HCR", "GDP per capita",
        "Population", "Urbanisation", "Energy Mix", "Trade Openness"]

# Worksheet "Country" labels -> (clean name, ISO3). Fixes spelling in the source file.
COUNTRIES = {
    "Angola": ("Angola", "AGO"), "Benin": ("Benin", "BEN"), "Botswana": ("Botswana", "BWA"),
    "Burkina Faso": ("Burkina Faso", "BFA"), "Burundi": ("Burundi", "BDI"),
    "Cabo Verbe": ("Cabo Verde", "CPV"), "Cameroon": ("Cameroon", "CMR"),
    "Central African Republic": ("Central African Republic", "CAF"), "Chad": ("Chad", "TCD"),
    "Comoros": ("Comoros", "COM"), "Congo (Republic of the Congo)": ("Congo, Rep.", "COG"),
    "Democratic Republich of the Congo": ("Congo, Dem. Rep.", "COD"), "Djibouti": ("Djibouti", "DJI"),
    "Equatorial Guinea": ("Equatorial Guinea", "GNQ"), "Eritea": ("Eritrea", "ERI"),
    "Eswatini": ("Eswatini", "SWZ"), "Ethiopia": ("Ethiopia", "ETH"), "Gabon": ("Gabon", "GAB"),
    "Gambia": ("Gambia", "GMB"), "Ghana": ("Ghana", "GHA"), "Guinea": ("Guinea", "GIN"),
    "Guinea-Bissau": ("Guinea-Bissau", "GNB"), "Ivory Coast": ("Côte d'Ivoire", "CIV"),
    "Kenya": ("Kenya", "KEN"), "Lesotho": ("Lesotho", "LSO"), "Liberia": ("Liberia", "LBR"),
    "Madagascar": ("Madagascar", "MDG"), "Malawi": ("Malawi", "MWI"), "Mali": ("Mali", "MLI"),
    "Mauritania": ("Mauritania", "MRT"), "Mauritius": ("Mauritius", "MUS"),
    "Mozambique": ("Mozambique", "MOZ"), "Namibia": ("Namibia", "NAM"), "Niger": ("Niger", "NER"),
    "Nigeria": ("Nigeria", "NGA"), "Rwanda": ("Rwanda", "RWA"),
    "Sao Tome and Principe": ("São Tomé and Príncipe", "STP"), "Senegal": ("Senegal", "SEN"),
    "Seychelles": ("Seychelles", "SYC"), "Sierra Leone": ("Sierra Leone", "SLE"),
    "Somalia": ("Somalia", "SOM"), "South Africa": ("South Africa", "ZAF"),
    "South Sudan": ("South Sudan", "SSD"), "Sudan": ("Sudan", "SDN"), "Tanzania": ("Tanzania", "TZA"),
    "Togo": ("Togo", "TGO"), "Uganda": ("Uganda", "UGA"), "Zambia": ("Zambia", "ZMB"),
    "Zimbabwe": ("Zimbabwe", "ZWE"),
}

# Rebuilt indices replace the workbook's descriptions and sources (see build_indices.py).
REBUILT = {
    "INFRA": {"description": "Infrastructure index: mean of within-year z-scores of electricity access, "
                             "mobile subscriptions, internet use and fixed telephone lines",
              "sources": ["World Bank WDI", "ITU ICT Indicators (via WDI)"],
              "links": ["https://data.worldbank.org", "https://www.itu.int/en/ITU-D/Statistics"]},
    "HCR": {"description": "Human capital index: mean of within-year z-scores of mean and expected years "
                           "of schooling, tertiary enrolment and secondary enrolment",
            "sources": ["UNDP Human Development Reports", "UNESCO UIS (via WDI)"],
            "links": ["https://hdr.undp.org/data-center", "https://uis.unesco.org"]},
}

# Units and transformations from the project's measurement protocol.
UNITS = {
    "TFP": ("Freshwater availability (source units)", "log", "Time-invariant within countries in this dataset"),
    "THE": ("Mt CO2e (net, incl. land use)", "inverse hyperbolic sine", ""),
    "AL": ("% of land area", "levels", ""),
    "TNRR": ("% of GDP", "log(1 + x)", ""),
    "INFRA": ("Index (mean of within-year z-scores)", "standardised", "Rebuilt from public sources; 1990–2024"),
    "HCR": ("Index (mean of within-year z-scores)", "standardised", "Rebuilt from public sources; 1990–2023"),
    "GDP per capita": ("Constant 2015 US$", "log, standardised", ""),
    "Population": ("Persons", "log, standardised", ""),
    "Urbanisation": ("% of population", "standardised", ""),
    "Energy Mix": ("Renewable share (%)", "standardised", ""),
    "Trade Openness": ("% of GDP", "standardised", ""),
}
SHORT = {"GDP per capita": "GDPPC", "Population": "POP", "Urbanisation": "URB",
         "Energy Mix": "ENERGY", "Trade Openness": "TRADE"}


def load_panel() -> pd.DataFrame:
    sheets = pd.read_excel(RAW / "datasets_complete.xlsx", sheet_name=None)
    frames = []
    for d in sheets.values():
        d = d.dropna(how="all")
        d = d[pd.to_numeric(d["Date"], errors="coerce").notna()].copy()
        frames.append(d)
    df = pd.concat(frames, ignore_index=True)
    df["Country"] = df["Country"].astype(str).str.strip()
    unknown = set(df["Country"]) - set(COUNTRIES)
    if unknown:
        raise ValueError(f"Unmapped country labels: {unknown}")
    df["iso3"] = df["Country"].map(lambda c: COUNTRIES[c][1])
    df["country"] = df["Country"].map(lambda c: COUNTRIES[c][0])
    df["year"] = pd.to_numeric(df["Date"]).astype(int)
    for v in VARS:  # placeholders such as ".." or " " become missing
        df[v] = pd.to_numeric(df[v], errors="coerce")
    df = df.rename(columns=SHORT)
    cols = ["iso3", "country", "year"] + [SHORT.get(v, v) for v in VARS]
    df = df[cols].rename(columns={"INFRA": "INFRA_ORIG", "HCR": "HCR_ORIG"})
    idx = pd.read_csv(PROC / "indices.csv")[["iso3", "year", "INFRA", "HCR", "INFRA_PC", "HCR_PC"]]
    df = df.merge(idx, on=["iso3", "year"], how="left")
    order = ["iso3", "country", "year"] + [SHORT.get(v, v) for v in VARS] + ["INFRA_PC", "HCR_PC", "INFRA_ORIG", "HCR_ORIG"]
    return df[order].sort_values(["country", "year"]).reset_index(drop=True)


def load_metadata() -> list:
    m = pd.read_excel(RAW / "variable_metadata.xlsx")
    m.columns = ["name", "category", "description", "sources", "links"]
    m["category"] = m["category"].ffill()
    out = []
    for r in m.itertuples():
        unit, transform, caveat = UNITS[r.name]
        out.append({
            "key": SHORT.get(r.name, r.name), "name": r.name, "role": r.category,
            "description": r.description, "sources": [s.strip() for s in str(r.sources).split(";")],
            "links": [s.strip() for s in str(r.links).split(";")],
            "unit": unit, "transformation": transform, "caveat": caveat,
            **REBUILT.get(r.name, {}),
        })
    orig = {"INFRA_ORIG": ("Infrastructure index as supplied in the original workbook (superseded)", "Index (source units)"),
            "HCR_ORIG": ("Human capital index as supplied in the original workbook (superseded)", "Index (21–79)")}
    for key, (desc, unit) in orig.items():
        out.append({"key": key, "name": key, "role": "Superseded", "description": desc,
                    "sources": ["Datasets complete.xlsx (construction undocumented)"], "links": [],
                    "unit": unit, "transformation": "comparison only",
                    "caveat": "Fails plausibility checks and is not used in the models. See Data quality."})
    out.append({"key": "INST", "name": "INST", "role": "Moderator",
                "description": "Institutional quality: mean of standardised WGI regulatory quality, government effectiveness, rule of law and control of corruption",
                "sources": ["World Bank Worldwide Governance Indicators"],
                "links": ["https://www.worldbank.org/en/publication/worldwide-governance-indicators"],
                "unit": "Index", "transformation": "standardised", "caveat": "Not yet merged into the panel", "pending": True})
    return out


def main():
    PROC.mkdir(parents=True, exist_ok=True)
    WEB.mkdir(parents=True, exist_ok=True)
    df = load_panel()
    df.to_csv(PROC / "panel.csv", index=False)
    df.to_csv(WEB / "panel.csv", index=False)  # downloadable from the site

    keys = [SHORT.get(v, v) for v in VARS] + ["INFRA_ORIG", "HCR_ORIG"]
    years = sorted(df["year"].unique().tolist())
    countries = df[["iso3", "country"]].drop_duplicates().sort_values("country")
    wide = {}
    for k in keys:
        p = df.pivot(index="iso3", columns="year", values=k).reindex(countries["iso3"])
        wide[k] = [[None if pd.isna(x) else round(float(x), 4) for x in row] for row in p.values]
    panel = {"years": years,
             "countries": [{"iso3": i, "name": n} for i, n in countries.values],
             "values": wide}
    (WEB / "panel.json").write_text(json.dumps(panel, separators=(",", ":")), encoding="utf-8")
    (WEB / "metadata.json").write_text(json.dumps(load_metadata(), indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"panel: {len(df)} rows, {df.iso3.nunique()} countries, {years[0]}–{years[-1]}")


if __name__ == "__main__":
    main()
