"""Estimate the models reported in the article and export them for the dashboard.

Specifications (Section 4 of the article):
  full      two-way FE, all controls, Driscoll–Kraay SE (2 lags)
  broad     two-way FE, drops energy mix and trade openness
  weighted  full-control FE with weights 1 / (obs per country)
  q25/q50/q75  pooled quantile regressions, broad-control sample
Robustness (preferred full-control FE model, same transformations, controls and SEs):
  leave-one-country-out   re-estimate dropping each country in turn
  lagged infrastructure   INFRA at t-1, t-2, t-3 (calendar-year lags) and the
                          t-1..t-3 moving average, on own and on a common sample
  index construction      principal-component indices; original workbook indices

Output: docs/data/results.json, docs/data/diagnostics.json, data/processed/results_long.csv
"""
from pathlib import Path
import json
import warnings

import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy import stats

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "docs" / "data"
PROC = ROOT / "data" / "processed"

OUTCOMES = {
    "THE": {"label": "Greenhouse gas emissions", "transform": "ihs", "unit": "Mt CO2e"},
    "AL": {"label": "Arable land", "transform": "level", "unit": "% of land area"},
    "TNRR": {"label": "Natural resource rents", "transform": "log1p", "unit": "% of GDP"},
}
# raw column -> (model term, label, log before standardising?)
PREDICTORS = {
    "INFRA": ("INFRA", "Infrastructure (INFRA)", False),
    "HCR": ("HCR", "Human capital (HCR)", False),
    "GDPPC": ("GDP", "GDP per capita (log)", True),
    "POP": ("POP", "Population (log)", True),
    "URB": ("URB", "Urbanisation", False),
    "ENERGY": ("ENERGY", "Energy mix (renewable share)", False),
    "TRADE": ("TRADE", "Trade openness", False),
}
FULL = ["INFRA", "HCR", "IX", "GDP", "POP", "URB", "ENERGY", "TRADE"]
BROAD = FULL[:6]
LABELS = {v[0]: v[1] for v in PREDICTORS.values()} | {"IX": "INFRA × HCR"}
DK_LAGS = 2
LAGS = [0, 1, 2, 3]
INFRA_TIMING = {"L0": "INFRA", "L1": "INFRA_L1", "L2": "INFRA_L2", "L3": "INFRA_L3", "MA3": "INFRA_MA3"}


def prepare(df):
    d = df.copy()
    d["y_THE"] = np.arcsinh(d["THE"])
    d["y_AL"] = d["AL"]
    d["y_TNRR"] = np.log1p(d["TNRR"])
    scaling = {}
    for raw, (term, _, logged) in PREDICTORS.items():
        x = np.log(d[raw]) if logged else d[raw]
        mu, sd = float(x.mean()), float(x.std())
        d[term] = (x - mu) / sd  # standardised over all available observations
        scaling[term] = {"raw": raw, "log": logged, "mean": mu, "sd": sd}
    d["IX"] = d["INFRA"] * d["HCR"]
    # Calendar-year lags of the standardised index: merge on year + k so that a missing
    # year gives a missing lag rather than the previous available row.
    base = d[["iso3", "year", "INFRA"]]
    for k in LAGS[1:]:
        lag = base.assign(year=base["year"] + k).rename(columns={"INFRA": f"INFRA_L{k}"})
        d = d.merge(lag, on=["iso3", "year"], how="left")
    d["INFRA_MA3"] = d[[f"INFRA_L{k}" for k in LAGS[1:]]].mean(axis=1, skipna=False)
    # Alternative index constructions, standardised the same way
    for alt in ("INFRA_PC", "HCR_PC", "INFRA_ORIG", "HCR_ORIG"):
        d[alt] = (d[alt] - d[alt].mean()) / d[alt].std()
    return d, scaling


def demean_two_way(M, g1, g2, w=None, tol=1e-11):
    """Remove country and year means by alternating projections (exact for unbalanced panels)."""
    M = M.copy()
    for _ in range(2000):
        old = M.copy()
        for g in (g1, g2):
            if w is None:
                M = M - M.groupby(g).transform("mean")
            else:
                M = M - M.mul(w, axis=0).groupby(g).transform("sum").div(w.groupby(g).transform("sum"), axis=0)
        if np.abs((M - old).values).max() < tol:
            break
    return M


def driscoll_kraay(X, e, t, lags, dof):
    h = pd.DataFrame(X * e[:, None]).groupby(t).sum().sort_index().values
    S = h.T @ h
    for j in range(1, lags + 1):
        G = h[j:].T @ h[:-j]
        S += (1 - j / (lags + 1)) * (G + G.T)
    B = np.linalg.inv(X.T @ X)
    return B @ S @ B * dof


def fixed_effects(d, y, terms, weighted=False):
    s = d.dropna(subset=["y_" + y] + terms).copy()
    w = 1.0 / s.groupby("iso3")["iso3"].transform("size") if weighted else None
    M = demean_two_way(s[["y_" + y] + terms], s["iso3"], s["year"], w)
    X, yy = M[terms].values, M["y_" + y].values
    if weighted:
        sw = np.sqrt(w.values)
        X, yy = X * sw[:, None], yy * sw
    b = np.linalg.lstsq(X, yy, rcond=None)[0]
    e = yy - X @ b
    n, nc, nt = len(s), s["iso3"].nunique(), s["year"].nunique()
    K = len(terms) + nc + nt - 1
    V = driscoll_kraay(X, e, s["year"].values, DK_LAGS, (n - 1) / (n - K))
    # R-squared of the LSDV model (fixed effects included), as reported in the article
    yraw = s["y_" + y].values
    if weighted:
        yraw = yraw * np.sqrt(w.values)
    r2 = 1 - (e @ e) / np.sum((yraw - yraw.mean()) ** 2)
    df_resid = nt - 1  # DK inference uses T - 1 degrees of freedom
    return pack(terms, b, V, df_resid, s, r2)


def quantile(d, y, terms, q):
    s = d.dropna(subset=["y_" + y] + terms)
    r = sm.QuantReg(s["y_" + y], sm.add_constant(s[terms])).fit(q=q, max_iter=5000)
    V = r.cov_params().loc[terms, terms].values
    return pack(terms, r.params[terms].values, V, None, s, None)


def pack(terms, b, V, df_resid, s, r2):
    se = np.sqrt(np.diag(V))
    tval = b / se
    p = 2 * (stats.t.sf(np.abs(tval), df_resid) if df_resid else stats.norm.sf(np.abs(tval)))
    crit = stats.t.ppf(0.975, df_resid) if df_resid else 1.959964
    rows = [{"term": t, "label": LABELS[t], "b": float(bi), "se": float(si), "p": float(pi),
             "lo": float(bi - crit * si), "hi": float(bi + crit * si)}
            for t, bi, si, pi in zip(terms, b, se, p)]
    return {"coefs": rows, "terms": terms, "vcov": V.round(10).tolist(), "crit": float(crit),
            "n": int(len(s)), "countries": int(s["iso3"].nunique()),
            "years": [int(s["year"].min()), int(s["year"].max())],
            "r2": None if r2 is None else float(r2),
            "support": {t: [float(s[t].min()), float(s[t].max())] for t in terms}}


def with_infra(d, infra=None, hcr=None):
    """Swap in an alternative INFRA (and/or HCR) measure and rebuild the interaction."""
    d = d.copy()
    if infra:
        d["INFRA"] = d[infra]
    if hcr:
        d["HCR"] = d[hcr]
    d["IX"] = d["INFRA"] * d["HCR"]
    return d


def lite(m):
    """Coefficients and sample size only (robustness output)."""
    return {"coefs": m["coefs"], "n": m["n"], "countries": m["countries"], "years": m["years"], "r2": m["r2"]}


def leave_one_out(d, y, terms, names):
    full = fixed_effects(d, y, terms)
    sample = d.dropna(subset=["y_" + y] + terms)
    ref = {c["term"]: c for c in full["coefs"]}
    rows = []
    for iso in sorted(sample["iso3"].unique()):
        m = fixed_effects(d[d["iso3"] != iso], y, terms)
        c = {r["term"]: r for r in m["coefs"]}
        rows.append({"iso3": iso, "country": names[iso], "n": m["n"],
                     **{t: {k: round(c[t][k], 6) for k in ("b", "se", "p", "lo", "hi")}
                        | {"delta": round(c[t]["b"] - ref[t]["b"], 6)} for t in ("INFRA", "HCR", "IX")}})
    summary = {}
    for t in ("INFRA", "HCR", "IX"):
        bs = np.array([r[t]["b"] for r in rows])
        sig_full = ref[t]["p"] < 0.05
        summary[t] = {"full": ref[t], "min": float(bs.min()), "max": float(bs.max()),
                      "sign_flips": int(np.sum(np.sign(bs) != np.sign(ref[t]["b"]))),
                      "inference_changes": int(sum((r[t]["p"] < 0.05) != sig_full for r in rows)),
                      "most_influential": max(rows, key=lambda r: abs(r[t]["delta"]))["iso3"]}
    return {"n": full["n"], "countries": full["countries"], "rows": rows, "summary": summary}


def lag_models(d, y, terms):
    own, common = {}, {}
    need = ["y_" + y] + [t for t in terms if t not in ("INFRA", "IX")] + list(INFRA_TIMING.values())
    cs = d.dropna(subset=need)
    for key, col in INFRA_TIMING.items():
        own[key] = lite(fixed_effects(with_infra(d, col), y, terms))
        common[key] = lite(fixed_effects(with_infra(cs, col), y, terms))
    return {"own": own, "common": common}


def diagnostics(df, d):
    keys = ["TFP", "THE", "AL", "TNRR", "INFRA", "HCR", "GDPPC", "POP", "URB", "ENERGY", "TRADE",
            "INFRA_ORIG", "HCR_ORIG"]
    lgdp = np.log(d["GDPPC"])
    out = []
    for k in keys:
        g = df.groupby("iso3")[k]
        lag = g.shift(1)
        ac = pd.concat([df[k], lag], axis=1).dropna()
        within_ac = df.assign(l=lag).groupby("iso3").apply(lambda x: x[k].corr(x["l"])).mean()
        out.append({
            "key": k, "n": int(df[k].notna().sum()), "share": float(df[k].notna().mean()),
            "countries": int(g.count().gt(0).sum()),
            "first_year": int(df.loc[df[k].notna(), "year"].min()),
            "within_sd": float(g.std().mean()),
            "autocorr": None if pd.isna(within_ac) else float(within_ac),
            "corr_lgdp": float(pd.concat([df[k], lgdp], axis=1).dropna().corr().iloc[0, 1]),
        })
    h = df["HCR_ORIG"].dropna()  # the workbook series that failed the checks
    counts = np.histogram(h, bins=np.arange(h.min(), h.max() + 2) - 0.5)[0]
    chi = stats.chisquare(counts)
    coverage = (df.assign(**{k: df[k].notna() for k in keys})
                  .groupby("iso3")[keys].mean().round(3))
    report = json.loads((PROC / "index_report.json").read_text(encoding="utf-8"))
    pairs = {}
    for k in ("INFRA", "HCR"):
        both = df[[k, k + "_ORIG"]].dropna()
        pairs[k] = {"corr": float(both.corr().iloc[0, 1]), "n": int(len(both))}
    return {"variables": out, "indices": report, "rebuilt_vs_orig": pairs,
            "hcr_uniformity": {"min": float(h.min()), "max": float(h.max()), "distinct": int(h.nunique()),
                                "chi2": float(chi.statistic), "p": float(chi.pvalue)},
            "coverage": {"keys": keys, "iso3": coverage.index.tolist(), "share": coverage.values.tolist()},
            "by_year": {"years": sorted(df["year"].unique().tolist()),
                        "counts": {k: df.groupby("year")[k].count().tolist() for k in keys}}}


def main():
    df = pd.read_csv(PROC / "panel.csv")
    d, scaling = prepare(df)
    names = dict(df[["iso3", "country"]].drop_duplicates().values)
    models, loo, lags, sens = {}, {}, {}, {}
    long = []
    for y in OUTCOMES:
        models[y] = {
            "full": fixed_effects(d, y, FULL),
            "broad": fixed_effects(d, y, BROAD),
            "weighted": fixed_effects(d, y, FULL, weighted=True),
            **{f"q{int(q * 100)}": quantile(d, y, BROAD, q) for q in (0.25, 0.50, 0.75)},
        }
        loo[y] = leave_one_out(d, y, FULL, names)
        lags[y] = lag_models(d, y, FULL)
        sens[y] = {"pc": lite(fixed_effects(with_infra(d, "INFRA_PC", "HCR_PC"), y, FULL)),
                   "orig": lite(fixed_effects(with_infra(d, "INFRA_ORIG", "HCR_ORIG"), y, FULL))}
        for spec, m in models[y].items():
            for c in m["coefs"]:
                long.append({"outcome": y, "spec": spec, **{k: c[k] for k in ("term", "b", "se", "p")}, "n": m["n"]})
    specs = {
        "full": {"label": "Fixed effects, full controls", "short": "FE full", "fe": True},
        "broad": {"label": "Fixed effects, broad controls", "short": "FE broad", "fe": True},
        "weighted": {"label": "Fixed effects, equal-country weights", "short": "FE weighted", "fe": True},
        "q25": {"label": "Quantile regression, 25th percentile", "short": "QR 25th", "fe": False},
        "q50": {"label": "Quantile regression, median", "short": "QR 50th", "fe": False},
        "q75": {"label": "Quantile regression, 75th percentile", "short": "QR 75th", "fe": False},
    }
    robustness = {"loo": loo, "lags": lags, "index": sens,
                  "timing_labels": {"L0": "INFRA t", "L1": "INFRA t−1", "L2": "INFRA t−2",
                                    "L3": "INFRA t−3", "MA3": "Mean of t−1 to t−3"}}
    out = {"outcomes": OUTCOMES, "specs": specs, "scaling": scaling, "models": models, "robustness": robustness,
           "notes": {"dk_lags": DK_LAGS, "se": "Driscoll–Kraay with (N−1)/(N−K) adjustment for FE models; asymptotic for quantile models"}}
    (WEB / "results.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    (WEB / "diagnostics.json").write_text(json.dumps(diagnostics(df, d), separators=(",", ":")), encoding="utf-8")
    for folder in (PROC, WEB):
        pd.DataFrame(long).to_csv(folder / "results_long.csv", index=False)
    for y in OUTCOMES:
        c = {r["term"]: r for r in models[y]["full"]["coefs"]}["INFRA"]
        print(f"{y:5s} full INFRA b={c['b']:.3f} se={c['se']:.3f} p={c['p']:.3f} N={models[y]['full']['n']} R2={models[y]['full']['r2']:.3f}")
        sm_ = loo[y]["summary"]["INFRA"]
        print(f"      LOO range [{sm_['min']:.3f}, {sm_['max']:.3f}] flips={sm_['sign_flips']} "
              f"inference changes={sm_['inference_changes']} most influential={sm_['most_influential']}")
        for smp in ("own", "common"):
            print(f"      {smp:6s} " + "  ".join(
                f"{k}: {({r['term']: r for r in m['coefs']}['INFRA']['b']):.3f}"
                f"{'*' if {r['term']: r for r in m['coefs']}['INFRA']['p'] < .05 else ' '} (N={m['n']})"
                for k, m in lags[y][smp].items()))


if __name__ == "__main__":
    main()
