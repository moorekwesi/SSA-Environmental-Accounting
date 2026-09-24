/* SSA Sustainability Observatory — front end.
   Reads the JSON files written by analysis/build_panel.py and analysis/estimate.py. */
'use strict';

const REPO_URL = 'https://github.com/moorekwesi/SSA-Environmental-Accounting';

const S = { panel: null, meta: null, res: null, diag: null, rendered: new Set(), current: 'overview' };
const $ = (id) => document.getElementById(id);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const SLOTS = ['--s1', '--s2', '--s3', '--s4', '--s5'];
const OUTCOME_KEYS = ['THE', 'AL', 'TNRR'];
const FE_SPECS = ['full', 'broad', 'weighted'];

// ---------------------------------------------------------------- helpers
function fmt(v, digits = 3) {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e4) return Math.round(v).toLocaleString('en');
  if (a >= 100) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  if (a === 0) return '0';
  return v.toPrecision(digits);
}
const stars = (p) => (p < 0.01 ? '***' : p < 0.05 ? '**' : p < 0.1 ? '*' : '');
const metaOf = (key) => S.meta.find((m) => m.key === key) || { name: key, description: key };
const labelOf = (key) => {
  const m = metaOf(key);
  return m.name === key ? `${key}` : m.name;
};
const longLabel = (key) => {
  const m = metaOf(key);
  return ['TFP', 'THE', 'AL', 'TNRR', 'INFRA', 'HCR', 'INFRA_ORIG', 'HCR_ORIG'].includes(key) ? `${key} · ${m.description}` : m.name;
};
const isoIndex = (iso) => S.panel.countries.findIndex((c) => c.iso3 === iso);
const nameOf = (iso) => S.panel.countries[isoIndex(iso)].name;
const series = (key, iso) => S.panel.values[key][isoIndex(iso)];
const yearIdx = (y) => S.panel.years.indexOf(y);

function seqScale() {
  const steps = css('--seq').split(',').map((s) => s.trim());
  return steps.map((c, i) => [i / (steps.length - 1), c]);
}
function baseLayout(extra = {}) {
  const ink2 = css('--ink-2'), grid = css('--grid'), axis = css('--axis');
  const ax = { gridcolor: grid, zerolinecolor: axis, linecolor: axis, tickfont: { color: ink2, size: 12 },
    title: { font: { color: ink2, size: 12 } }, automargin: true };
  return Object.assign({
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: css('--font'), color: css('--ink'), size: 13 },
    margin: { l: 10, r: 16, t: 10, b: 40 },
    xaxis: { ...ax }, yaxis: { ...ax },
    hoverlabel: { bgcolor: css('--surface'), bordercolor: css('--axis'), font: { color: css('--ink'), family: css('--font') } },
    legend: { orientation: 'h', y: -0.18, font: { color: ink2 } },
  }, extra);
}
const axTitle = (text) => ({ text, font: { color: css('--ink-2'), size: 12 } });
const CONFIG = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d'] };
const plot = (id, data, layout) => Plotly.react(id, data, layout, CONFIG);
function option(sel, value, text, selected) {
  const o = document.createElement('option');
  o.value = value; o.textContent = text; if (selected) o.selected = true;
  sel.appendChild(o);
}

// ---------------------------------------------------------------- tabs & theme
function showTab(name) {
  if (!document.getElementById('tab-' + name)) name = 'overview';
  if (S.current !== name) window.scrollTo(0, 0);
  S.current = name;
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.id !== 'tab-' + name; });
  if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
  render(name);
}
function render(name, force = false) {
  if (S.rendered.has(name) && !force) return;
  ({ overview: renderOverview, explore: renderExplore, coverage: renderCoverage, results: renderResults,
    robust: renderRobust, simulate: renderSim, quality: renderQuality, methods: () => {} })[name]();
  S.rendered.add(name);
}
function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('theme'); } catch (e) { /* storage unavailable */ }
  if (saved) document.documentElement.dataset.theme = saved;
  $('themeToggle').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark' ||
      (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch (e) { /* ignore */ }
    S.rendered.clear();
    render(S.current, true);
  });
}

// ---------------------------------------------------------------- overview
function renderOverview() {
  const n = S.panel.countries.length, yrs = S.panel.years;
  const obs = n * yrs.length;
  const rb = S.res.robustness;
  const models = OUTCOME_KEYS.reduce((n, y) => n + Object.keys(S.res.specs).length + rb.loo[y].rows.length
    + 2 * Object.keys(rb.lags[y].own).length + Object.keys(rb.index[y]).length, 0);
  $('tiles').innerHTML = [
    [n, 'countries'], [`${yrs[0]}–${yrs[yrs.length - 1]}`, 'years covered'],
    [obs.toLocaleString('en'), 'potential country-years'], [models, 'models estimated'],
  ].map(([v, k]) => `<div class="tile"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
  $('kf1').textContent = `+${coef('AL', 'full', 'INFRA').b.toFixed(1)}`;
  const pct = FE_SPECS.map((s) => Math.exp(coef('TNRR', s, 'INFRA').b) - 1);
  $('kf2').textContent = `${Math.round(Math.min(...pct) * 100)}–${Math.round(Math.max(...pct) * 100)}%`;
}
const coef = (y, spec, term) => S.res.models[y][spec].coefs.find((c) => c.term === term);

// ---------------------------------------------------------------- explore
const EX = { selected: [], slot: {} };
function renderExplore() {
  const sel = $('exVar');
  if (!sel.options.length) {
    Object.keys(S.panel.values).forEach((k) => option(sel, k, longLabel(k), k === 'TNRR'));
    const yr = $('exYear'); yr.value = 2020;
    const cs = $('exCountries'); cs.removeAttribute('multiple');
    option(cs, '', 'Add a country…');
    S.panel.countries.forEach((c) => option(cs, c.iso3, c.name));
    ['GHA', 'NGA', 'KEN'].forEach(addCountry);
    sel.addEventListener('change', drawExplore);
    yr.addEventListener('input', drawMap);
    $('exLog').addEventListener('change', drawMap);
    cs.addEventListener('change', () => { if (cs.value) addCountry(cs.value); cs.value = ''; drawSeries(); });
  }
  drawExplore();
}
function addCountry(iso) {
  if (EX.selected.includes(iso) || EX.selected.length >= 5) return;
  const used = new Set(Object.values(EX.slot));
  EX.slot[iso] = SLOTS.find((s) => !used.has(s)); // colour follows the country, never its rank
  EX.selected.push(iso);
}
function removeCountry(iso) {
  EX.selected = EX.selected.filter((c) => c !== iso);
  delete EX.slot[iso];
  drawSeries();
}
function drawExplore() { drawMap(); drawMeta(); drawSeries(); }
function drawMap() {
  const key = $('exVar').value, year = +$('exYear').value;
  $('exYearOut').textContent = year;
  const all = S.panel.values[key].flat().filter((v) => v !== null);
  const logOk = all.every((v) => v > 0);
  const logBox = $('exLog');
  logBox.disabled = !logOk; if (!logOk) logBox.checked = false;
  const useLog = logBox.checked;
  const tr = (v) => (v === null ? null : useLog ? Math.log10(v) : v);
  const zs = S.panel.countries.map((c, i) => tr(S.panel.values[key][i][yearIdx(year)]));
  // stable scale across years; cap at the 98th percentile so a few extremes do not wash out the map
  const sorted = all.map(tr).sort((a, b) => a - b);
  const lo = sorted[0], hi = sorted[Math.floor(0.98 * (sorted.length - 1))];
  const raw = S.panel.countries.map((c, i) => S.panel.values[key][i][yearIdx(year)]);
  const unit = metaOf(key).unit || '';
  $('mapTitle').textContent = `${labelOf(key)}, ${year}`;
  const trace = {
    type: 'choropleth', locationmode: 'ISO-3', locations: S.panel.countries.map((c) => c.iso3), z: zs,
    text: S.panel.countries.map((c, i) => `${c.name}<br>${raw[i] === null ? 'No data' : fmt(raw[i]) + ' ' + unit}`),
    hovertemplate: '%{text}<extra></extra>', colorscale: seqScale(), zmin: lo, zmax: hi,
    marker: { line: { color: css('--surface'), width: 0.8 } },
    colorbar: { thickness: 10, len: 0.7, tickfont: { color: css('--ink-2') }, outlinewidth: 0,
      title: axTitle(useLog ? 'log₁₀' : '') },
  };
  const layout = baseLayout({
    margin: { l: 0, r: 0, t: 0, b: 0 },
    geo: { scope: 'africa', showframe: false, showcoastlines: false, bgcolor: 'rgba(0,0,0,0)',
      landcolor: css('--surface-2'), showland: true, countrycolor: css('--surface'), showcountries: true,
      projection: { type: 'mercator' }, lataxis: { range: [-36, 24] }, lonaxis: { range: [-20, 55] } },
  });
  plot('map', [trace], layout).then(() => {
    const el = $('map');
    el.removeAllListeners && el.removeAllListeners('plotly_click');
    el.on('plotly_click', (e) => { addCountry(e.points[0].location); drawSeries(); });
  });
}
function drawMeta() {
  const key = $('exVar').value, m = metaOf(key), d = S.diag.variables.find((v) => v.key === key);
  const links = m.links.map((l) => `<a href="${l}" target="_blank" rel="noopener">${l.replace(/^https?:\/\//, '')}</a>`).join('<br>');
  $('metaCard').innerHTML = `<dl>
    <dt>Variable</dt><dd><strong>${key}</strong>: ${m.description}</dd>
    <dt>Role</dt><dd>${m.role}</dd>
    <dt>Unit</dt><dd>${m.unit}</dd>
    <dt>In models</dt><dd>${m.transformation}</dd>
    <dt>Sources</dt><dd>${m.sources.join('; ')}</dd>
    <dt>Links</dt><dd>${links}</dd>
    <dt>Coverage</dt><dd>${(d.share * 100).toFixed(1)}% of country-years · ${d.countries} countries · from ${d.first_year}</dd>
  </dl>${m.caveat ? `<div class="alert caveat">${m.caveat}</div>` : ''}`;
}
function drawSeries() {
  const key = $('exVar').value, unit = metaOf(key).unit || '';
  $('tsTitle').textContent = `${labelOf(key)} over time`;
  $('countryChips').innerHTML = EX.selected.map((iso) =>
    `<span class="chip"><i style="background:${css(EX.slot[iso])}"></i>${nameOf(iso)}<button type="button" aria-label="Remove ${nameOf(iso)}" data-rm="${iso}">×</button></span>`).join('');
  $('countryChips').querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => removeCountry(b.dataset.rm)));
  const data = EX.selected.map((iso) => ({
    type: 'scatter', mode: 'lines', name: nameOf(iso), x: S.panel.years, y: series(key, iso),
    line: { color: css(EX.slot[iso]), width: 2 }, connectgaps: false,
    hovertemplate: `${nameOf(iso)}: %{y:,.4~g} ${unit}<extra></extra>`,
  }));
  plot('ts', data, baseLayout({ hovermode: 'x unified', yaxis: { ...baseLayout().yaxis, title: axTitle(unit) }, showlegend: data.length > 1 }));
}

// ---------------------------------------------------------------- coverage
function renderCoverage() {
  const cv = S.diag.coverage;
  const order = cv.iso3.map((iso, i) => [nameOf(iso), cv.share[i]]).sort((a, b) => b[0].localeCompare(a[0]));
  plot('heat', [{
    type: 'heatmap', x: cv.keys, y: order.map((r) => r[0]), z: order.map((r) => r[1]), zmin: 0, zmax: 1,
    colorscale: seqScale(), xgap: 2, ygap: 2,
    hovertemplate: '%{y} · %{x}: %{z:.0%} of years<extra></extra>',
    colorbar: { thickness: 10, len: 0.4, tickformat: '.0%', tickfont: { color: css('--ink-2') }, outlinewidth: 0 },
  }], baseLayout({ margin: { l: 10, r: 10, t: 10, b: 10 }, xaxis: { ...baseLayout().xaxis, side: 'top' },
    yaxis: { ...baseLayout().yaxis, tickfont: { size: 11, color: css('--ink-2') } } }));
  const sel = $('covVar');
  if (!sel.options.length) {
    cv.keys.forEach((k) => option(sel, k, longLabel(k), k === 'THE'));
    sel.addEventListener('change', drawCovYear);
  }
  drawCovYear();
}
function drawCovYear() {
  const k = $('covVar').value;
  plot('covYear', [{
    type: 'bar', x: S.diag.by_year.years, y: S.diag.by_year.counts[k], marker: { color: css('--s1') },
    hovertemplate: '%{x}: %{y} countries<extra></extra>',
  }], baseLayout({ bargap: 0.15, yaxis: { ...baseLayout().yaxis, range: [0, 50], title: axTitle('countries reporting') } }));
}

// ---------------------------------------------------------------- results
function renderResults() {
  if (!$('rsOutcome').options.length) {
    OUTCOME_KEYS.forEach((y) => option($('rsOutcome'), y, `${y} · ${S.res.outcomes[y].label}`, y === 'TNRR'));
    Object.entries(S.res.specs).forEach(([k, s]) => option($('rsSpec'), k, s.label, k === 'full'));
    ['rsOutcome', 'rsSpec', 'rsTerm'].forEach((id) => $(id).addEventListener('change', drawResults));
  }
  drawResults();
}
function drawResults() {
  const y = $('rsOutcome').value, spec = $('rsSpec').value, m = S.res.models[y][spec];
  const termSel = $('rsTerm');
  const prevTerm = termSel.value || 'INFRA';
  termSel.innerHTML = '';
  m.terms.forEach((t) => option(termSel, t, m.coefs.find((c) => c.term === t).label, t === prevTerm));
  $('forestTitle').textContent = `${S.res.outcomes[y].label}: ${S.res.specs[spec].label}`;
  const rows = [...m.coefs].reverse();
  const mk = (sig) => {
    const r = rows.filter((c) => (c.p < 0.05) === sig);
    return {
      type: 'scatter', mode: 'markers', name: sig ? 'p < 0.05' : 'not significant',
      x: r.map((c) => c.b), y: r.map((c) => c.label),
      error_x: { type: 'data', symmetric: false, array: r.map((c) => c.hi - c.b), arrayminus: r.map((c) => c.b - c.lo), color: css('--s1'), thickness: 2, width: 0 },
      marker: { size: 10, color: sig ? css('--s1') : css('--surface'), line: { color: css('--s1'), width: 2 } },
      customdata: r.map((c) => [c.se, c.p, c.lo, c.hi]),
      hovertemplate: '%{y}<br>β = %{x:.3f} (SE %{customdata[0]:.3f})<br>95% CI %{customdata[2]:.3f} to %{customdata[3]:.3f}<br>p = %{customdata[1]:.3f}<extra></extra>',
    };
  };
  plot('forest', [mk(true), mk(false)], baseLayout({
    xaxis: { ...baseLayout().xaxis, zeroline: true, zerolinewidth: 1.5, title: axTitle('coefficient (per SD of predictor)') },
    yaxis: { ...baseLayout().yaxis, categoryorder: 'array', categoryarray: rows.map((c) => c.label) },
    margin: { l: 10, r: 16, t: 10, b: 60 },
  }));
  drawRobust();
  const t = $('coefTable');
  t.innerHTML = `<thead><tr><th>Term</th><th>β</th><th>SE</th><th>p</th><th>95% CI</th></tr></thead><tbody>${
    m.coefs.map((c) => `<tr><td>${c.label}</td><td>${c.b.toFixed(3)}${stars(c.p)}</td><td>${c.se.toFixed(3)}</td><td>${c.p < 0.001 ? '<0.001' : c.p.toFixed(3)}</td><td>${c.lo.toFixed(3)} to ${c.hi.toFixed(3)}</td></tr>`).join('')
  }</tbody>`;
  $('coefNote').textContent = `N = ${m.n.toLocaleString('en')} · ${m.countries} countries · ${m.years[0]}–${m.years[1]}` +
    (m.r2 !== null ? ` · R² = ${m.r2.toFixed(3)} (fixed effects included)` : '') +
    ` · *** p < 0.01, ** p < 0.05, * p < 0.10 · ${S.res.specs[spec].fe ? 'Driscoll–Kraay SE, 2 lags' : 'asymptotic SE'}`;
}
function drawRobust() {
  const y = $('rsOutcome').value, term = $('rsTerm').value;
  const specs = Object.keys(S.res.specs).filter((s) => S.res.models[y][s].terms.includes(term)).reverse();
  const cs = specs.map((s) => ({ s, c: coef(y, s, term) }));
  $('robTitle').textContent = `${coef(y, 'full', term)?.label || term} across specifications`;
  const mk = (sig) => {
    const r = cs.filter((o) => (o.c.p < 0.05) === sig);
    return {
      type: 'scatter', mode: 'markers', name: sig ? 'p < 0.05' : 'not significant',
      x: r.map((o) => o.c.b), y: r.map((o) => S.res.specs[o.s].short),
      error_x: { type: 'data', symmetric: false, array: r.map((o) => o.c.hi - o.c.b), arrayminus: r.map((o) => o.c.b - o.c.lo), color: css('--s2'), thickness: 2, width: 0 },
      marker: { size: 10, color: sig ? css('--s2') : css('--surface'), line: { color: css('--s2'), width: 2 } },
      customdata: r.map((o) => [o.c.se, o.c.p, S.res.models[y][o.s].n]),
      hovertemplate: '%{y}<br>β = %{x:.3f} (SE %{customdata[0]:.3f}), p = %{customdata[1]:.3f}<br>N = %{customdata[2]}<extra></extra>',
    };
  };
  plot('robust', [mk(true), mk(false)], baseLayout({
    xaxis: { ...baseLayout().xaxis, zeroline: true, zerolinewidth: 1.5, title: axTitle('coefficient') },
    yaxis: { ...baseLayout().yaxis, categoryorder: 'array', categoryarray: specs.map((s) => S.res.specs[s].short) },
    margin: { l: 10, r: 16, t: 10, b: 60 },
  }));
}

// ---------------------------------------------------------------- robustness
function renderRobust() {
  if (!$('rbOutcome').options.length) {
    OUTCOME_KEYS.forEach((y) => option($('rbOutcome'), y, `${y} · ${S.res.outcomes[y].label}`, y === 'AL'));
    [['INFRA', 'Infrastructure (INFRA)'], ['HCR', 'Human capital (HCR)'], ['IX', 'INFRA × HCR']]
      .forEach(([k, l]) => option($('rbTerm'), k, l, k === 'INFRA'));
    ['rbOutcome', 'rbTerm'].forEach((id) => $(id).addEventListener('change', drawRobustTab));
  }
  drawRobustTab();
}
function drawRobustTab() { drawLoo(); drawLags(); }
function drawLoo() {
  const y = $('rbOutcome').value, term = $('rbTerm').value, L = S.res.robustness.loo[y];
  const sm = L.summary[term], full = sm.full, label = $('rbTerm').selectedOptions[0].textContent;
  $('looTitle').textContent = `${label} in ${S.res.outcomes[y].label.toLowerCase()}: leave-one-country-out (${L.rows.length} runs)`;
  const infl = L.rows.find((r) => r.iso3 === sm.most_influential);
  $('looSummary').innerHTML = [
    `<span class="badge neutral">Full sample β = ${full.b.toFixed(3)}${stars(full.p)} (N = ${L.n.toLocaleString('en')}, ${L.countries} countries)</span>`,
    `<span class="badge neutral">Range ${sm.min.toFixed(3)} to ${sm.max.toFixed(3)}</span>`,
    sm.sign_flips ? `<span class="badge bad">Sign reverses in ${sm.sign_flips} run${sm.sign_flips > 1 ? 's' : ''}</span>` : '<span class="badge good">Sign never reverses</span>',
    sm.inference_changes ? `<span class="badge warn">5% significance changes in ${sm.inference_changes} run${sm.inference_changes > 1 ? 's' : ''}</span>` : '<span class="badge good">5% significance unchanged in every run</span>',
    `<span class="badge neutral">Most influential: ${infl.country} (Δ = ${infl[term].delta >= 0 ? '+' : ''}${infl[term].delta.toFixed(3)})</span>`,
  ].join('');
  const rows = [...L.rows].sort((a, b) => a[term].b - b[term].b);
  const names = rows.map((r) => r.country);
  const mk = (sig) => {
    const r = rows.filter((o) => (o[term].p < 0.05) === sig);
    return {
      type: 'scatter', mode: 'markers', name: sig ? 'p < 0.05' : 'not significant',
      x: r.map((o) => o[term].b), y: r.map((o) => o.country),
      error_x: { type: 'data', symmetric: false, array: r.map((o) => o[term].hi - o[term].b), arrayminus: r.map((o) => o[term].b - o[term].lo), color: css('--s1'), thickness: 1.5, width: 0 },
      marker: { size: 8, color: sig ? css('--s1') : css('--surface'), line: { color: css('--s1'), width: 1.5 } },
      customdata: r.map((o) => [o[term].se, o[term].p, o[term].delta, o.n]),
      hovertemplate: 'Without %{y}<br>β = %{x:.3f} (SE %{customdata[0]:.3f}), p = %{customdata[1]:.3f}<br>Δ vs full = %{customdata[2]:+.3f} · N = %{customdata[3]}<extra></extra>',
    };
  };
  const band = { type: 'rect', xref: 'x', yref: 'paper', x0: full.lo, x1: full.hi, y0: 0, y1: 1, fillcolor: css('--s1'), opacity: 0.10, line: { width: 0 } };
  const line = { type: 'line', xref: 'x', yref: 'paper', x0: full.b, x1: full.b, y0: 0, y1: 1, line: { color: css('--ink-2'), width: 1.5 } };
  plot('loo', [mk(true), mk(false)], baseLayout({
    shapes: [band, line],
    xaxis: { ...baseLayout().xaxis, zeroline: true, zerolinewidth: 1.5, title: axTitle('coefficient with country omitted') },
    yaxis: { ...baseLayout().yaxis, categoryorder: 'array', categoryarray: names, tickfont: { size: 11, color: css('--ink-2') } },
    margin: { l: 10, r: 16, t: 10, b: 60 }, legend: { orientation: 'h', y: -0.05, font: { color: css('--ink-2') } },
  }));
}
function drawLags() {
  const y = $('rbOutcome').value, term = $('rbTerm').value, R = S.res.robustness;
  const keys = Object.keys(R.timing_labels), labs = keys.map((k) => R.timing_labels[k]);
  const label = $('rbTerm').selectedOptions[0].textContent;
  $('lagTitle').textContent = `${label} by infrastructure timing`;
  const get = (smp, k) => R.lags[y][smp][k].coefs.find((c) => c.term === term);
  const tr = (smp, name, slot, dx) => ({
    type: 'scatter', mode: 'markers+lines', name, x: labs, y: keys.map((k) => get(smp, k).b),
    line: { color: css(slot), width: 1, dash: 'dot' },
    error_y: { type: 'data', symmetric: false, array: keys.map((k) => get(smp, k).hi - get(smp, k).b), arrayminus: keys.map((k) => get(smp, k).b - get(smp, k).lo), color: css(slot), thickness: 2, width: 0 },
    marker: { size: 10, color: keys.map((k) => (get(smp, k).p < 0.05 ? css(slot) : css('--surface'))), line: { color: css(slot), width: 2 } },
    customdata: keys.map((k) => [get(smp, k).se, get(smp, k).p, R.lags[y][smp][k].n]),
    hovertemplate: `${name}<br>%{x}: β = %{y:.3f} (SE %{customdata[0]:.3f}), p = %{customdata[1]:.3f}<br>N = %{customdata[2]}<extra></extra>`,
    xaxis: 'x', offsetgroup: dx,
  });
  plot('lags', [tr('own', 'Own sample', '--s1', 0), tr('common', 'Common sample', '--s2', 1)], baseLayout({
    hovermode: 'closest',
    yaxis: { ...baseLayout().yaxis, zeroline: true, zerolinewidth: 1.5, title: axTitle('coefficient') },
    margin: { l: 10, r: 16, t: 10, b: 60 },
  }));
  const cell = (c) => `${c.b.toFixed(3)}${stars(c.p)}<br><small>(${c.se.toFixed(3)})</small>`;
  $('lagTable').innerHTML = `<thead><tr><th>Timing</th><th>Own sample</th><th>N</th><th>Common sample</th><th>N</th></tr></thead><tbody>${
    keys.map((k, i) => `<tr><td>${labs[i]}</td><td>${cell(get('own', k))}</td><td>${R.lags[y].own[k].n}</td><td>${cell(get('common', k))}</td><td>${R.lags[y].common[k].n}</td></tr>`).join('')
  }</tbody>`;
}

// ---------------------------------------------------------------- simulator
const LEVERS = [
  { term: 'INFRA', raw: 'INFRA', label: 'Infrastructure index', kind: 'abs', min: -1.5, max: 1.5, step: 0.05, unit: ' pts' },
  { term: 'HCR', raw: 'HCR', label: 'Human capital index', kind: 'abs', min: -1.5, max: 1.5, step: 0.05, unit: ' pts' },
  { term: 'GDP', raw: 'GDPPC', label: 'GDP per capita', kind: 'pct', min: -50, max: 100, step: 5, unit: '%' },
  { term: 'POP', raw: 'POP', label: 'Population', kind: 'pct', min: -20, max: 100, step: 5, unit: '%' },
  { term: 'URB', raw: 'URB', label: 'Urbanisation', kind: 'abs', min: -10, max: 30, step: 1, unit: ' pp', clamp: [0, 100] },
  { term: 'ENERGY', raw: 'ENERGY', label: 'Renewable energy share', kind: 'abs', min: -40, max: 40, step: 1, unit: ' pp', clamp: [0, 100] },
  { term: 'TRADE', raw: 'TRADE', label: 'Trade openness', kind: 'abs', min: -40, max: 40, step: 1, unit: ' pp', clamp: [0, 400] },
];
const SIM = { vals: {} };
const TRANS = {
  ihs: [Math.asinh, Math.sinh], level: [(v) => v, (v) => v], log1p: [Math.log1p, Math.expm1],
};
function renderSim() {
  if (!$('smCountry').options.length) {
    S.panel.countries.forEach((c) => option($('smCountry'), c.iso3, c.name, c.iso3 === 'GHA'));
    OUTCOME_KEYS.forEach((y) => option($('smOutcome'), y, `${y} · ${S.res.outcomes[y].label}`, y === 'TNRR'));
    FE_SPECS.forEach((s) => option($('smSpec'), s, S.res.specs[s].label, s === 'full'));
    ['smCountry', 'smOutcome', 'smSpec'].forEach((id) => $(id).addEventListener('change', buildSliders));
    document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => applyPreset(b.dataset.preset)));
  }
  buildSliders();
}
function buildSliders() {
  const m = S.res.models[$('smOutcome').value][$('smSpec').value];
  const box = $('sliders');
  box.innerHTML = '';
  LEVERS.filter((l) => m.terms.includes(l.term)).forEach((l) => {
    const v = SIM.vals[l.term] ?? 0;
    const div = document.createElement('div');
    div.className = 'slider';
    div.innerHTML = `<span>${l.label}${l.warn ? ' ⚠' : ''}</span><output id="o_${l.term}"></output>
      <input type="range" id="s_${l.term}" min="${l.min}" max="${l.max}" step="${l.step}" value="${v}" aria-label="${l.label} change">
      <small id="b_${l.term}"></small>`;
    box.appendChild(div);
    div.querySelector('input').addEventListener('input', (e) => { SIM.vals[l.term] = +e.target.value; simulate(); });
  });
  simulate();
}
function applyPreset(p) {
  SIM.vals = {};
  const sd = (t) => Math.round(S.res.scaling[t].sd * 20) / 20; // one SD, on the slider's 0.05 grid
  if (p === 'infra') SIM.vals.INFRA = sd('INFRA');
  if (p === 'green') { SIM.vals.INFRA = sd('INFRA'); SIM.vals.ENERGY = 20; }
  if (p === 'skills') SIM.vals.HCR = sd('HCR');
  buildSliders();
}
function baseline(iso, y, terms) {
  const raws = LEVERS.filter((l) => terms.includes(l.term)).map((l) => l.raw);
  const out = series(y, iso);
  for (let i = S.panel.years.length - 1; i >= 0; i--) {
    if (out[i] === null) continue;
    if (raws.every((r) => series(r, iso)[i] !== null)) {
      const vals = {}; raws.forEach((r) => { vals[r] = series(r, iso)[i]; });
      return { year: S.panel.years[i], y: out[i], vals };
    }
  }
  return null;
}
function zOf(term, raw) {
  const sc = S.res.scaling[term];
  return ((sc.log ? Math.log(raw) : raw) - sc.mean) / sc.sd;
}
function simulate() {
  const iso = $('smCountry').value, y = $('smOutcome').value, spec = $('smSpec').value;
  const m = S.res.models[y][spec], o = S.res.outcomes[y];
  const b0 = baseline(iso, y, m.terms);
  const levers = LEVERS.filter((l) => m.terms.includes(l.term));
  levers.forEach((l) => {
    const v = SIM.vals[l.term] ?? 0;
    $('o_' + l.term).textContent = `${v > 0 ? '+' : ''}${+v.toFixed(2)}${l.unit}`;
  });
  if (!b0) {
    $('simHeadline').innerHTML = `<div class="big">–</div><div class="sub">${nameOf(iso)} has no year with ${y} and all model inputs observed. Try another country or the broad-control model.</div>`;
    $('simBadges').innerHTML = ''; Plotly.purge('simBars'); Plotly.purge('simTs');
    return;
  }
  const z0 = {}, z1 = {}, newRaw = {};
  levers.forEach((l) => {
    const r0 = b0.vals[l.raw], v = SIM.vals[l.term] ?? 0;
    let r1 = l.kind === 'pct' ? r0 * (1 + v / 100) : r0 + v;
    if (l.clamp) r1 = Math.min(l.clamp[1], Math.max(l.clamp[0], r1));
    newRaw[l.term] = r1;
    z0[l.term] = zOf(l.term, r0); z1[l.term] = zOf(l.term, r1);
    $('b_' + l.term).textContent = `baseline ${fmt(r0)} → ${fmt(r1)}`;
  });
  z0.IX = z0.INFRA * z0.HCR; z1.IX = z1.INFRA * z1.HCR;
  const d = m.terms.map((t) => z1[t] - z0[t]);
  const beta = m.terms.map((t) => m.coefs.find((c) => c.term === t).b);
  const dy = d.reduce((s, di, i) => s + di * beta[i], 0);
  const V = m.vcov;
  let varDy = 0;
  for (let i = 0; i < d.length; i++) for (let j = 0; j < d.length; j++) varDy += d[i] * V[i][j] * d[j];
  const se = Math.sqrt(Math.max(varDy, 0));
  const [T, Ti] = TRANS[o.transform];
  const Y0 = T(b0.y);
  const val = Ti(Y0 + dy), lo = Ti(Y0 + dy - m.crit * se), hi = Ti(Y0 + dy + m.crit * se);
  const diff = val - b0.y;
  const unit = o.unit;
  const moved = d.some((x) => Math.abs(x) > 1e-12);
  $('simHeadline').innerHTML = `
    <div class="sub">${o.label}, ${nameOf(iso)} (baseline ${b0.year}: ${fmt(b0.y)} ${unit})</div>
    <div class="big">${moved ? `${diff >= 0 ? '+' : ''}${fmt(diff)} ${unit}` : 'No change'}</div>
    <div class="sub">${moved ? `Scenario value ${fmt(val)} ${unit} · 95% interval ${fmt(Math.min(lo, hi))} to ${fmt(Math.max(lo, hi))}` : 'Move a lever or pick a preset.'}</div>`;

  // badges: robustness, significance, extrapolation, data quality
  const badges = [];
  const infraSig = FE_SPECS.map((s) => coef(y, s, 'INFRA').p < 0.05);
  const nSig = infraSig.filter(Boolean).length;
  badges.push(nSig === 3 ? '<span class="badge good">INFRA effect robust in all FE models</span>'
    : nSig > 0 ? `<span class="badge warn">INFRA effect significant in ${nSig} of 3 FE models</span>`
      : '<span class="badge neutral">INFRA effect not significant</span>');
  if (moved) {
    const excl = lo <= b0.y && hi >= b0.y;
    badges.push(excl ? '<span class="badge neutral">Interval includes no change</span>' : '<span class="badge warn">Interval excludes no change</span>');
  }
  const outside = m.terms.filter((t) => z1[t] < m.support[t][0] || z1[t] > m.support[t][1]);
  if (moved && outside.length) badges.push(`<span class="badge bad">Extrapolation: ${outside.join(', ')} outside the estimation sample</span>`);
  badges.push('<span class="badge neutral">Association, not a causal forecast</span>');
  $('simBadges').innerHTML = badges.join('');

  // contribution bars in natural units (each lever alone)
  const contrib = levers.map((l) => {
    const i = m.terms.indexOf(l.term);
    let c = d[i] * beta[i];
    if (l.term === 'INFRA' || l.term === 'HCR') {
      const k = m.terms.indexOf('IX');
      const zI = l.term === 'INFRA' ? z1.INFRA : z0.INFRA, zH = l.term === 'HCR' ? z1.HCR : z0.HCR;
      c += (zI * zH - z0.IX) * beta[k];
    }
    return { label: l.label, v: Ti(Y0 + c) - b0.y };
  });
  const up = css('--s2'), down = css('--s1');
  plot('simBars', [{
    type: 'bar', orientation: 'h', y: contrib.map((c) => c.label), x: contrib.map((c) => c.v),
    marker: { color: contrib.map((c) => (c.v >= 0 ? up : down)) },
    hovertemplate: `%{y}: %{x:+.3~g} ${unit}<extra></extra>`,
  }], baseLayout({
    xaxis: { ...baseLayout().xaxis, zeroline: true, zerolinewidth: 1.5, title: axTitle(`change in ${unit}, each lever alone`) },
    yaxis: { ...baseLayout().yaxis, autorange: 'reversed' }, showlegend: false, margin: { l: 10, r: 16, t: 10, b: 50 },
  }));

  // observed series with the scenario point
  $('simTsTitle').textContent = `${o.label}: observed and scenario`;
  const obs = { type: 'scatter', mode: 'lines', name: 'Observed', x: S.panel.years, y: series(y, iso),
    line: { color: css('--s1'), width: 2 }, hovertemplate: `%{x}: %{y:.3~g} ${unit}<extra></extra>` };
  const sc = { type: 'scatter', mode: 'markers', name: 'Scenario (95% interval)', x: [b0.year], y: [val],
    error_y: { type: 'data', symmetric: false, array: [Math.max(lo, hi) - val], arrayminus: [val - Math.min(lo, hi)], color: css('--s2'), thickness: 2, width: 6 },
    marker: { size: 11, color: css('--s2'), line: { color: css('--surface'), width: 2 } },
    hovertemplate: `Scenario: %{y:.3~g} ${unit}<extra></extra>` };
  plot('simTs', moved ? [obs, sc] : [obs], baseLayout({ hovermode: 'closest', yaxis: { ...baseLayout().yaxis, title: axTitle(unit) } }));
}

// ---------------------------------------------------------------- data quality
function renderQuality() {
  const rows = S.diag.variables.map((v) => {
    let status = '<span class="badge good">OK</span>', flag = false;
    if (v.key.endsWith('_ORIG')) { status = `<span class="badge bad">Superseded${v.autocorr < 0.5 ? ': no persistence' : ': scales with size'}</span>`; flag = true; }
    else if (v.within_sd === 0 || v.autocorr === null) { status = '<span class="badge warn">Constant within country</span>'; flag = true; }
    else if (v.autocorr < 0.5) { status = '<span class="badge bad">Fails: no persistence</span>'; flag = true; }
    else if (v.share < 0.5) status = '<span class="badge warn">Sparse</span>';
    return `<tr class="${flag ? 'flag' : ''}"><td>${v.key} · ${metaOf(v.key).key === metaOf(v.key).name ? metaOf(v.key).description : metaOf(v.key).name}</td><td>${(v.share * 100).toFixed(1)}%</td><td>${v.countries}</td><td>${v.first_year}</td>
      <td>${v.autocorr === null ? '–' : v.autocorr.toFixed(2)}</td><td>${v.corr_lgdp.toFixed(2)}</td><td style="text-align:left">${status}</td></tr>`;
  }).join('');
  $('diagTable').innerHTML = `<thead><tr><th>Variable</th><th>Coverage</th><th>Countries</th><th>First year</th><th>Lag-1 autocorrelation</th><th>Corr. with log GDP pc</th><th style="text-align:left">Status</th></tr></thead><tbody>${rows}</tbody>`;

  drawIndexCards();
  const h = S.panel.values.HCR_ORIG.flat().filter((v) => v !== null);
  const u = S.diag.hcr_uniformity;
  const xs = []; for (let v = u.min; v <= u.max; v++) xs.push(v);
  const counts = xs.map((x) => h.filter((v) => v === x).length);
  const expected = h.length / xs.length;
  plot('hcrHist', [
    { type: 'bar', name: 'Observed count', x: xs, y: counts, marker: { color: css('--s1') }, hovertemplate: 'HCR = %{x}: %{y} obs<extra></extra>' },
    { type: 'scatter', mode: 'lines', name: 'Uniform expectation', x: [u.min - 0.5, u.max + 0.5], y: [expected, expected], line: { color: css('--s2'), width: 2, dash: 'dash' }, hoverinfo: 'skip' },
  ], baseLayout({ bargap: 0.1, xaxis: { ...baseLayout().xaxis, title: axTitle('HCR value') }, yaxis: { ...baseLayout().yaxis, title: axTitle('observations') } }));
  $('hcrNote').textContent = `${h.length.toLocaleString('en')} values, all whole numbers from ${u.min} to ${u.max}. A chi-square test cannot reject a uniform distribution (χ² = ${u.chi2.toFixed(1)}, p = ${u.p.toFixed(2)}), which is what randomly generated placeholders would produce.`;

  const sel = $('qCountry');
  if (!sel.options.length) {
    S.panel.countries.forEach((c) => option(sel, c.iso3, c.name, c.iso3 === 'GHA'));
    sel.addEventListener('change', drawHcrTs);
    $('qIndex').addEventListener('change', drawHcrTs);
  }
  drawHcrTs();
}
function drawIndexCards() {
  const I = S.diag.indices, cmp = S.diag.rebuilt_vs_orig;
  const card = (k, title) => {
    const r = I[k];
    const rows = Object.entries(r.components).map(([c, m]) =>
      `<tr><td>${m.label}${m.log ? ' (log)' : ''}</td><td>${m.source}</td><td class="n">${m.obs.toLocaleString('en')}</td><td class="n">${r.pc_loadings[c].toFixed(2)}</td></tr>`).join('');
    return `<div class="idx"><h4>${title}: ${r.obs.toLocaleString('en')} country-years, ${r.years[0]}–${r.years[1]}</h4>
      <div class="table-wrap"><table><thead><tr><th>Component</th><th>Source</th><th class="n">Obs</th><th class="n">PC1 loading</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="chart-note">First principal component explains ${Math.round(r.pc_share * 100)}% of the variance, with near-equal loadings, so equal weighting is essentially the principal-component solution. Correlation with the original workbook index: ${cmp[k].corr.toFixed(2)}.</p></div>`;
  };
  const ex = Object.values(I.excluded).map((m) => `<tr><td>${m.label}</td><td>${m.source}</td><td class="n">${m.obs}</td></tr>`).join('');
  $('idxCards').innerHTML = card('INFRA', 'INFRA') + card('HCR', 'HCR') +
    `<div class="idx excl"><h4>Candidate components not used (too sparse)</h4><div class="table-wrap"><table><thead><tr><th>Series</th><th>Source</th><th class="n">Obs (of ~1,700)</th></tr></thead><tbody>${ex}</tbody></table></div></div>`;
  $('idxNote').textContent = `Each component is z-scored within year across countries; the index is the mean of available z-scores (at least ${I.rules.min_components}). Internal gaps of up to ${I.rules.max_gap} years are interpolated linearly; nothing is extrapolated.`;
}
function drawHcrTs() {
  const iso = $('qCountry').value, k = $('qIndex').value;
  const zs = (arr) => {
    const v = arr.filter((x) => x !== null), mu = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / (v.length - 1)) || 1;
    return arr.map((x) => (x === null ? null : (x - mu) / sd));
  };
  plot('hcrTs', [
    { type: 'scatter', mode: 'lines', name: `${k} rebuilt`, x: S.panel.years, y: zs(series(k, iso)), line: { color: css('--s1'), width: 2 } },
    { type: 'scatter', mode: 'lines', name: `${k} original workbook`, x: S.panel.years, y: zs(series(k + '_ORIG', iso)), line: { color: css('--s2'), width: 2 } },
  ], baseLayout({ hovermode: 'x unified', xaxis: { ...baseLayout().xaxis, range: [1985, 2024] }, yaxis: { ...baseLayout().yaxis, title: axTitle('z-score within country') } }));
}

// ---------------------------------------------------------------- boot
async function boot() {
  initTheme();
  const get = (f) => fetch('data/' + f).then((r) => { if (!r.ok) throw new Error(f); return r.json(); });
  try {
    [S.panel, S.meta, S.res, S.diag] = await Promise.all(['panel.json', 'metadata.json', 'results.json', 'diagnostics.json'].map(get));
  } catch (e) {
    $('main').innerHTML = `<div class="alert">Could not load the data files (${e.message}). If you opened index.html directly from disk, serve the <code>docs</code> folder over HTTP instead, for example <code>python -m http.server</code>.</div>`;
    return;
  }
  if (REPO_URL !== '#') $('repoLink').href = REPO_URL;
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  document.querySelectorAll('[data-goto]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); showTab(a.dataset.goto); }));
  window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
  showTab(location.hash.slice(1) || 'overview');
}
document.addEventListener('DOMContentLoaded', () => {
  if (window.Plotly) boot(); else window.addEventListener('load', boot);
});
