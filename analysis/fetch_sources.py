"""Download the public source series used to rebuild the INFRA and HCR indices.

World Bank WDI API (includes series WDI republishes from ITU and UNESCO UIS) and the
UNDP Human Development Report composite-indices time series. Files are cached in
data/raw/sources/ so the build is reproducible offline; delete a file to refresh it.

Output: data/raw/sources/wdi_<indicator>.csv, data/raw/sources/hdr_composite.csv
"""
from pathlib import Path
import json
import time
import urllib.request

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "raw" / "sources"

# indicator code -> (label, original compiler)
WDI = {
    # infrastructure
    "EG.ELC.ACCS.ZS": ("Access to electricity (% of population)", "World Bank WDI (SE4ALL)"),
    "IT.CEL.SETS.P2": ("Mobile cellular subscriptions (per 100 people)", "ITU via WDI"),
    "IT.NET.USER.ZS": ("Individuals using the Internet (% of population)", "ITU via WDI"),
    "IT.MLT.MAIN.P2": ("Fixed telephone subscriptions (per 100 people)", "ITU via WDI"),
    "IT.NET.BBND.P2": ("Fixed broadband subscriptions (per 100 people)", "ITU via WDI"),
    # human capital and research
    "SE.TER.ENRR": ("School enrollment, tertiary (% gross)", "UNESCO UIS via WDI"),
    "SE.SEC.ENRR": ("School enrollment, secondary (% gross)", "UNESCO UIS via WDI"),
    "GB.XPD.RSDV.GD.ZS": ("R&D expenditure (% of GDP)", "UNESCO UIS via WDI"),
    "SP.POP.SCIE.RD.P6": ("Researchers in R&D (per million people)", "UNESCO UIS via WDI"),
}
HDR_URL = "https://hdr.undp.org/sites/default/files/2025_HDR/HDR25_Composite_indices_complete_time_series.csv"


def get_json(url, tries=4):
    for k in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return json.load(r)
        except Exception:
            if k == tries - 1:
                raise
            time.sleep(2 * (k + 1))


def fetch_wdi(code, iso3):
    out = SRC / f"wdi_{code}.csv"
    if out.exists():
        return
    url = (f"https://api.worldbank.org/v2/country/{';'.join(iso3)}/indicator/{code}"
           f"?format=json&per_page=20000&date=1960:2025")
    meta, rows = get_json(url)
    assert meta["pages"] == 1, f"{code}: paging not handled"
    df = pd.DataFrame([{"iso3": r["countryiso3code"], "year": int(r["date"]), "value": r["value"]}
                       for r in rows if r["value"] is not None])
    df.to_csv(out, index=False)
    print(f"{code:20s} {len(df):5d} obs")


def fetch_hdr():
    out = SRC / "hdr_composite.csv"
    if not out.exists():
        req = urllib.request.Request(HDR_URL, headers={"User-Agent": "Mozilla/5.0"})  # server rejects bare clients
        with urllib.request.urlopen(req, timeout=120) as r:
            out.write_bytes(r.read())
        print(f"HDR composite file saved ({out.stat().st_size // 1024} KB)")


def main():
    from build_panel import COUNTRIES
    SRC.mkdir(parents=True, exist_ok=True)
    iso3 = sorted({v[1] for v in COUNTRIES.values()})
    for code in WDI:
        fetch_wdi(code, iso3)
    fetch_hdr()


if __name__ == "__main__":
    main()
