(function () {
'use strict';

var I = window.I18N;
var LS_LANG = 'dash_lang', SS_TOKEN = 'dash_token';
var lang = 'fa', token = null, sessionExpired = false, ctx = null, dlgN = 0;
var appRoot = document.getElementById('app');
var ROUTES = ['home', 'servers', 'sources', 'devices', 'adguard', 'settings'];
var PING = {};          // session-only latency results: node id -> ms, or -1 for failed
var pendingSub = null;  // subscription to open when Sources is shown (from the Home banner)

try { var sl = localStorage.getItem(LS_LANG); if (sl === 'en' || sl === 'fa') lang = sl; } catch (e) {}
try { token = sessionStorage.getItem(SS_TOKEN) || null; } catch (e) {}

var LS_THEME = 'dash_theme', theme = 'system';
try { var th = localStorage.getItem(LS_THEME); if (th === 'dark' || th === 'light' || th === 'system') theme = th; } catch (e) {}
var themeMq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

/* ---------- i18n and formatting ---------- */

function t(k, v) {
  var s = I[lang][k];
  if (s === undefined) s = I.en[k];
  if (s === undefined) return k;
  if (v) s = s.replace(/\{(\w+)\}/g, function (m, n) { return v[n] !== undefined ? v[n] : m; });
  return s;
}
function has(k) { return I[lang][k] !== undefined; }
function locale() { return lang === 'fa' ? 'fa-IR' : 'en-US'; }
function num(n, max) {
  var x = Number(n);
  if (!isFinite(x)) return '-';
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: max === undefined ? 0 : max }).format(x);
}
function fmtBytes(b) {
  var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0, x = Number(b) || 0;
  while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
  return num(x, i > 1 ? 1 : 0) + ' ' + u[i];
}
function fmtDur(s) {
  var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), p = [];
  if (d) p.push(num(d) + ' ' + t('u_d'));
  if (d || h) p.push(num(h) + ' ' + t('u_h'));
  p.push(num(m) + ' ' + t('u_m'));
  return p.join(' ');
}
function fmtDate(sec) {
  try {
    return new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR-u-ca-persian' : 'en-GB', { dateStyle: 'medium' }).format(new Date(sec * 1000));
  } catch (e) { return String(sec); }
}
function fmtInterval(v) {
  var m = /^(\d+)([ms])$/.exec(v || '');
  if (!m) return v || '-';
  return num(m[1]) + ' ' + t(m[2] === 'm' ? 'u_min' : 'u_sec');
}
function countryName(code) {
  if (!code) return '';
  try { return new Intl.DisplayNames([locale()], { type: 'region' }).of(String(code).toUpperCase()) || code; }
  catch (e) { return code; }
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* ---------- DOM helpers (all server data goes through these) ---------- */

var PROPS = { value: 1, checked: 1, disabled: 1, selected: 1, hidden: 1 };
function add(n, kids) {
  if (kids === undefined || kids === null || kids === false) return;
  if (!Array.isArray(kids)) kids = [kids];
  kids.forEach(function (c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) add(n, c);
    else n.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  });
}
function el(tag, attrs, kids) {
  var n = document.createElement(tag);
  if (attrs) {
    for (var k in attrs) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (PROPS[k]) n[k] = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
  }
  add(n, kids);
  return n;
}
// NFKC turns the decorative Unicode letters some providers use into plain, readable ones.
function bdi(s) { return el('bdi', null, typeof s === 'string' ? s.normalize('NFKC') : s); }
function ltr(s) { return el('span', { dir: 'ltr', class: 'ltr' }, s); }

var SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  var n = document.createElementNS(SVGNS, tag);
  for (var k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}
var IC = {
  home: 'M3 12l9-9 9 9M5 10v10h14V10',
  servers: 'M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01',
  sources: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  devices: 'M3 5h18v11H3zM8 20h8M12 16v4',
  adguard: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
  webrtc: 'M15 10l5-3v10l-5-3M3 7h12v10H3z',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2',
  power: 'M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0',
  check: 'M5 12l5 5 9-10',
  warn: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  x: 'M6 6l12 12M18 6L6 18',
  refresh: 'M21 12a9 9 0 1 1-3-6.7M21 4v5h-5',
  logout: 'M9 4H4v16h5M16 8l4 4-4 4M20 12H9',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4'
};
function icon(name, size) {
  var z = String(size || 20);
  var s = svgEl('svg', { viewBox: '0 0 24 24', width: z, height: z, fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', 'class': 'ic' });
  s.appendChild(svgEl('path', { d: IC[name] || '' }));
  return s;
}

function toast(msg, kind) {
  var box = document.getElementById('toasts');
  var n = el('div', { class: 'toast ' + (kind || ''), 'data-testid': 'toast' }, [kind ? icon(kind === 'ok' ? 'check' : 'warn') : null, el('span', null, msg)]);
  box.appendChild(n);
  setTimeout(function () { n.remove(); }, kind === 'bad' ? 7000 : 4500);
}

function errMsg(e) {
  var c = e && e.code;
  return has('err_' + c) ? t('err_' + c) : t('err_generic');
}

function guard(btn, fn) {
  return function () {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    Promise.resolve().then(fn).catch(function (e) {
      if (e && e.code === 'cancelled') return;
      toast(errMsg(e), 'bad');
    }).then(function () {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    });
  };
}
function mkBtn(label, kind, ic, fn) {
  var b = el('button', { type: 'button', class: 'btn btn-' + kind }, [ic ? icon(ic) : null, el('span', null, label)]);
  if (fn) b.addEventListener('click', guard(b, fn));
  return b;
}
// For buttons inside a modal dialog: toasts would sit behind the modal, so errors show inline.
// fn may throw { msg: '...' } for validation messages.
function dlgRun(btn, errBox, fn) {
  return function () {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    errBox.hidden = true;
    Promise.resolve().then(fn).catch(function (e) {
      if (e && e.code === 'cancelled') return;
      errBox.textContent = e && e.msg ? e.msg : errMsg(e);
      errBox.hidden = false;
    }).then(function () {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    });
  };
}

function modal(title, kids) {
  var id = 'dlg-t' + (++dlgN);
  var dlg = el('dialog', { class: 'dlg', 'aria-labelledby': id });
  add(dlg, [el('h2', { id: id }, title), kids]);
  dlg.addEventListener('close', function () { dlg.remove(); });
  document.body.appendChild(dlg);
  dlg.showModal();
  return dlg;
}
function confirmBox(title, text, okLabel, danger) {
  return new Promise(function (resolve) {
    var cancel = el('button', { type: 'button', class: 'btn btn-secondary', 'data-testid': 'confirm-cancel' }, t('cancel'));
    var ok = el('button', { type: 'button', class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), 'data-testid': 'confirm-ok' }, okLabel);
    var dlg = modal(title, [el('p', null, text), el('div', { class: 'dlg-actions' }, [cancel, ok])]);
    cancel.addEventListener('click', function () { dlg.close('cancel'); });
    ok.addEventListener('click', function () { dlg.close('ok'); });
    dlg.addEventListener('close', function () { resolve(dlg.returnValue === 'ok'); });
    cancel.focus();
  });
}
function pwField(id, label, autoc, tid) {
  var inp = el('input', { type: 'password', class: 'input', id: id, autocomplete: autoc, spellcheck: 'false', dir: 'ltr', 'data-testid': tid });
  return { input: inp, node: el('div', { class: 'field' }, [el('label', { class: 'fld', 'for': id }, label), inp]) };
}
function showToggle(inputs) {
  var shown = false;
  var b = el('button', { type: 'button', class: 'btn btn-ghost', 'aria-pressed': 'false' }, t('show'));
  b.addEventListener('click', function () {
    shown = !shown;
    inputs.forEach(function (i) { i.type = shown ? 'text' : 'password'; });
    b.textContent = t(shown ? 'hide' : 'show');
    b.setAttribute('aria-pressed', shown ? 'true' : 'false');
  });
  return b;
}

function loadingEl() {
  return el('div', { class: 'state', role: 'status' }, [el('div', { class: 'spinner' }), el('span', null, t('loading'))]);
}
function errorEl(e, retry) {
  return el('div', { class: 'state err', role: 'alert' }, [icon('warn', 28), el('span', null, errMsg(e)), retry ? mkBtn(t('retry'), 'secondary', 'refresh', retry) : null]);
}
function emptyEl(msg) { return el('div', { class: 'state' }, msg); }

function loadInto(box, c, fetcher, paint) {
  box.replaceChildren(loadingEl());
  fetcher().then(function (d) {
    if (!c.alive()) return;
    box.replaceChildren();
    paint(d);
  }).catch(function (e) {
    if (!c.alive()) return;
    box.replaceChildren(errorEl(e, function () { loadInto(box, c, fetcher, paint); }));
  });
}

// Sticky thin bar for long operations (switching, testing, subscription updates).
function makeBar() {
  var txt = el('span');
  var cancel = el('button', { type: 'button', class: 'btn btn-ghost', hidden: true }, t('cancel'));
  var node = el('div', { class: 'sbar', role: 'status', hidden: true }, [el('div', { class: 'sbar-line' }), el('div', { class: 'sbar-in' }, [txt, cancel])]);
  var onCancel = null;
  cancel.addEventListener('click', function () { if (onCancel) onCancel(); });
  return {
    node: node,
    show: function (text, cb) {
      txt.textContent = text;
      onCancel = cb || null;
      cancel.hidden = !cb;
      node.hidden = false;
    },
    hide: function () { node.hidden = true; onCancel = null; }
  };
}

function viewTitle(title, actions) {
  return el('div', { class: 'view-head' }, [el('h1', null, title), actions ? el('div', { class: 'toolbar' }, actions) : null]);
}
/* Liquid Glass switch on Home, with its name and the word On or Off under it. */
function glassSwitch(c, o) {
  var on = false, known = false;
  var wordTxt = el('span', { class: 'gs-state' }, '...');
  var btn = el('button', { type: 'button', class: 'gs', role: 'switch', 'data-testid': o.testid, 'aria-checked': 'false', 'aria-label': t(o.aria), disabled: true }, [
    el('span', { class: 'gs-track' }, el('i', { class: 'gs-knob' })),
    el('span', { class: 'gs-text' }, [el('span', { class: 'gs-name' }, t(o.label)), wordTxt])
  ]);
  function paint(k) {
    on = !!k.enabled;
    known = true;
    btn.className = 'gs' + (on ? (k.active ? ' on' : ' wait') : '');
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
    wordTxt.textContent = t(on ? 'ab_state_on' : 'ab_state_off');
    btn.disabled = false;
  }
  function load() {
    return api(o.api).then(function (k) { if (c.alive()) paint(k); }).catch(function () {
      if (!c.alive()) return;
      if (!known) wordTxt.textContent = '-';
      btn.disabled = false;
    });
  }
  btn.addEventListener('click', async function () {
    if (btn.disabled) return;
    if (!known) { btn.disabled = true; load(); return; }
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    try {
      var r = await api(o.api, { method: 'POST', body: { enabled: !on }, timeout: 45000 });
      if (c.alive()) { paint(r); toast(t('saved'), 'ok'); }
    } catch (e) {
      toast(errMsg(e), 'bad');
      if (c.alive()) load();
    }
    if (!c.alive()) return;
    btn.removeAttribute('aria-busy');
    btn.disabled = false;
  });
  load();
  return btn;
}
function adblockSwitch(c) {
  return glassSwitch(c, { api: 'api-adblock', testid: 'adblock-toggle', label: 'ab_pill', aria: 'ab_aria' });
}
function webrtcSwitch(c) {
  return glassSwitch(c, { api: 'api-webrtc', testid: 'webrtc-toggle', label: 'rtc_pill', aria: 'rtc_aria' });
}

/* Install as an app. Chrome installs only over trusted HTTPS, which a private router cannot get
   without a certificate on the phone, so the row offers a small Android app instead. */
var installPrompt = null;
window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installPrompt = e; });
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(function () {});
}
function installRow() {
  var box = el('div', { class: 'srow col', 'data-testid': 'install-row' }, [el('span', { class: 'rb-name' }, t('in_title'))]);
  if (/RouterDashApp/.test(navigator.userAgent) || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)) {
    box.appendChild(el('p', { class: 'help' }, t('in_done')));
  } else if (installPrompt) {
    box.appendChild(mkBtn(t('in_button'), 'primary', 'plus', async function () {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
    }));
  } else {
    box.appendChild(el('p', { class: 'help' }, t('in_steps')));
    box.appendChild(el('a', { class: 'btn btn-primary', href: 'router-dashboard.apk', download: 'router-dashboard.apk', 'data-testid': 'install-apk' }, t('in_apk')));
  }
  return box;
}

// Rounds a chart maximum up to 1, 2, 5 or 10 times a power of ten.
function niceMax(v) {
  var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10)), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function secTitle(text) { return el('h2', { class: 'sec' }, text); }

/* ---------- API ---------- */

function apiErr(code, status) { var e = new Error(code); e.code = code; e.status = status; return e; }

async function api(path, o) {
  o = o || {};
  var timeout = o.timeout || 20000, auth = o.auth !== false;
  var ctl = new AbortController(), timedOut = false;
  var to = setTimeout(function () { timedOut = true; ctl.abort(); }, timeout);
  if (o.signal) {
    if (o.signal.aborted) ctl.abort();
    else o.signal.addEventListener('abort', function () { ctl.abort(); }, { once: true });
  }
  var headers = {};
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && token) headers.Authorization = 'Bearer ' + token;
  var res, data = null;
  try {
    res = await fetch('/cgi-bin/' + path, {
      method: o.method || 'GET',
      headers: headers,
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
      signal: ctl.signal,
      cache: 'no-store'
    });
    try { data = await res.json(); } catch (e2) { data = null; }
  } catch (e) {
    clearTimeout(to);
    throw apiErr(timedOut ? 'timeout' : (o.signal && o.signal.aborted ? 'cancelled' : 'network'));
  }
  clearTimeout(to);
  if (res.status === 401) { logout(true); throw apiErr('unauthorized', 401); }
  if (!res.ok || !data || data.ok === false) throw apiErr((data && data.error) || 'server', res.status);
  return data;
}

async function waitApply() {
  await sleep(1500);
  for (var i = 0; i < 90; i++) {
    try {
      var s = await api('api-status', { auth: false, timeout: 8000 });
      var a = s.passwall && s.passwall.last_apply;
      if (a === 'ok' || a === 'failed' || a === 'reverted') return a;
    } catch (e) {}
    await sleep(2000);
  }
  return 'timeout';
}
function applyToast(o) {
  if (o === 'ok') toast(t('apply_ok'), 'ok');
  else if (o === 'reverted') toast(t('apply_reverted'), 'bad');
  else if (o === 'failed') toast(t('apply_failed'), 'bad');
  else toast(t('apply_timeout'), 'bad');
}

function subAlert(inf) {
  var exp = Number(inf.expire) || 0;
  if (exp <= 0) return null;
  if (inf.expired || exp * 1000 < Date.now()) return { kind: 'expired', exp: exp };
  var left = exp * 1000 - Date.now();
  if (left < 3 * 86400000) return { kind: 'soon', exp: exp, days: Math.max(1, Math.ceil(left / 86400000)) };
  return null;
}

/* ---------- Session ---------- */

function logout(expired) {
  if (token && !expired) {
    fetch('/cgi-bin/api-logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } }).catch(function () {});
  }
  token = null;
  try { sessionStorage.removeItem(SS_TOKEN); } catch (e) {}
  if (expired) sessionExpired = true;
  render();
}
function setLang(l) {
  lang = l;
  try { localStorage.setItem(LS_LANG, l); } catch (e) {}
  render();
}
function langButton(kind) {
  return el('button', { type: 'button', class: 'btn btn-' + (kind || 'ghost'), 'data-testid': 'lang-toggle', 'aria-label': t('lang_switch'), onclick: function () { setLang(lang === 'fa' ? 'en' : 'fa'); } },
    [icon('globe'), el('span', { lang: lang === 'fa' ? 'en' : 'fa' }, lang === 'fa' ? 'English' : 'فارسی')]);
}

/* ---------- Theme ---------- */

function resolvedTheme() { return theme === 'system' ? (themeMq && themeMq.matches ? 'light' : 'dark') : theme; }
function applyTheme() {
  var r = resolvedTheme();
  document.documentElement.setAttribute('data-theme', r);
  var m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', r === 'light' ? '#DCE6F2' : '#07060C');
  document.querySelectorAll('[data-theme-seg]').forEach(function (b) {
    b.setAttribute('aria-pressed', b.getAttribute('data-theme-seg') === theme ? 'true' : 'false');
  });
  document.querySelectorAll('[data-theme-flip]').forEach(function (b) {
    var p = b.querySelector('path');
    if (p) p.setAttribute('d', IC[r === 'dark' ? 'sun' : 'moon']);
    b.setAttribute('aria-label', t(r === 'dark' ? 'th_to_light' : 'th_to_dark'));
  });
}
function setTheme(v) {
  theme = v;
  try { localStorage.setItem(LS_THEME, v); } catch (e) {}
  applyTheme();
}
// Icon button that flips dark/light. Shows the icon of the theme it will switch to.
function themeFlip() {
  var dark = resolvedTheme() === 'dark';
  return el('button', { type: 'button', class: 'btn btn-ghost btn-icon', 'data-theme-flip': '1', 'data-testid': 'theme-toggle', 'aria-label': t(dark ? 'th_to_light' : 'th_to_dark'), onclick: function () { setTheme(resolvedTheme() === 'dark' ? 'light' : 'dark'); } }, icon(dark ? 'sun' : 'moon'));
}
// Segmented control: System, Dark, Light.
function themeSeg() {
  var opts = [['system', 'th_system'], ['dark', 'th_dark'], ['light', 'th_light']];
  return el('div', { class: 'seg', role: 'group', 'aria-label': t('st_theme') }, opts.map(function (o) {
    return el('button', { type: 'button', class: 'seg-b', 'aria-pressed': theme === o[0] ? 'true' : 'false', 'data-theme-seg': o[0], 'data-testid': 'theme-' + o[0], onclick: function () { setTheme(o[0]); } }, el('span', null, t(o[1])));
  }));
}

function renderLogin() {
  var pw = el('input', { type: 'password', id: 'pw', class: 'input', autocomplete: 'current-password', required: true, dir: 'ltr', 'data-testid': 'login-password' });
  var err = el('p', { class: 'err-text', role: 'alert', hidden: true });
  var btn = el('button', { type: 'submit', class: 'btn btn-primary btn-block', 'data-testid': 'login-submit' },[icon('check'), el('span', null, t('lg_submit'))]);
  // Password managers save a login only with a user name beside the password. The router's
  // user is always root, so the field is fixed.
  var user = el('input', { type: 'text', id: 'user', name: 'username', class: 'input', autocomplete: 'username', readonly: true, value: 'root', dir: 'ltr', 'data-testid': 'login-user' });
  pw.name = 'password';
  var form = el('form', { novalidate: true, method: 'post', action: '#' }, [
    el('div', { class: 'field' }, [el('label', { class: 'fld', 'for': 'user' }, t('lg_user')), user]),
    el('div', { class: 'field' }, [el('label', { class: 'fld', 'for': 'pw' }, t('lg_password')), pw]),
    err, btn
  ]);
  function fail(msg) { err.textContent = msg; err.hidden = false; }
  var run = guard(btn, async function () {
    err.hidden = true;
    if (!pw.value) { fail(t('lg_empty')); return; }
    var ctl = new AbortController(), to = setTimeout(function () { ctl.abort(); }, 20000), j = null;
    try {
      var r = await fetch('/ubus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctl.signal,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'call', params: ['00000000000000000000000000000000', 'session', 'login', { username: 'root', password: pw.value, timeout: 3600 }] })
      });
      j = await r.json();
    } catch (e) { clearTimeout(to); fail(t('lg_network')); return; }
    clearTimeout(to);
    var res = j && j.result;
    if (!Array.isArray(res) || res[0] !== 0 || res.length < 2 || !res[1] || !res[1].ubus_rpc_session) { fail(t('lg_wrong')); return; }
    token = res[1].ubus_rpc_session;
    try { sessionStorage.setItem(SS_TOKEN, token); } catch (e) {}
    pw.value = '';
    sessionExpired = false;
    render();
  });
  form.addEventListener('submit', function (e) { e.preventDefault(); run(); });
  if (sessionExpired) { err.textContent = t('err_unauthorized'); err.hidden = false; }
  appRoot.replaceChildren(el('div', { class: 'login' }, el('div', { class: 'surface login-box' }, [
    el('div', { class: 'tools' }, [themeFlip(), langButton()]),
    el('div', { class: 'hero', 'aria-hidden': 'true' }, icon('globe', 40)),
    el('h1', null, t('app_title')),
    el('p', { class: 'help', style: 'margin-block-end:16px' }, t('lg_sub')),
    form
  ])));
  pw.focus();
}

function renderShell() {
  var links = ROUTES.map(function (r) {
    return el('a', { href: '#' + r, 'data-r': r, 'data-testid': 'nav-' + r, 'aria-label': t('nav_' + r) }, [icon(r), el('span', null, t('nav_' + r))]);
  });
  var nav = el('nav', { class: 'nav', 'aria-label': t('nav_label') }, links);
  var view = el('div', { class: 'view', id: 'view' });
  var main = el('main', { id: 'main', tabindex: '-1' }, view);
  appRoot.replaceChildren(el('div', { class: 'app' }, [nav, main]));
}

/* ---------- Router ---------- */

function killCtx() {
  if (!ctx) return;
  ctx.dead = true;
  ctx.cleanups.forEach(function (f) { try { f(); } catch (e) {} });
  ctx = null;
}
function newCtx() {
  var c = { dead: false, cleanups: [], alive: function () { return !c.dead; } };
  ctx = c;
  return c;
}
function currentRoute() {
  var h = (location.hash || '').replace('#', '');
  return ROUTES.indexOf(h) >= 0 ? h : 'home';
}
function route() {
  if (!token) return;
  killCtx();
  var view = document.getElementById('view');
  if (!view) return;
  var r = currentRoute();
  document.querySelectorAll('.nav a').forEach(function (a) {
    if (a.getAttribute('data-r') === r) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  view.replaceChildren();
  window.scrollTo(0, 0);
  var c = newCtx();
  var views = { home: viewHome, servers: viewServers, sources: viewSources, devices: viewDevices, adguard: viewAdguard, settings: viewSettings };
  views[r](view, c);
}
function render() {
  killCtx();
  document.querySelectorAll('dialog').forEach(function (d) { try { d.close(); } catch (e) {} d.remove(); });
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
  document.title = t('app_title');
  if (!token) { renderLogin(); return; }
  renderShell();
  route();
}

/* ---------- Home: the halo ---------- */

function viewHome(root, c) {
  var H = { busy: false, loaded: false, fails: 0, status: null, exit: null, exitBad: 0, prev: null, down: null, up: null, sd: [], su: [], base: '' };
  var asking = false, tS = null, tE = null;

  // Ring: one button, an SVG ring and a power glyph. Halo is the button's ::before.
  var svg = svgEl('svg', { viewBox: '0 0 232 232', 'aria-hidden': 'true', 'class': 'ring-svg' });
  // A glass tube: clear body, tinted fill, two lit edges, a light running inside, one reflection.
  [['ring-track', 102], ['ring-arc', 102], ['ring-edge', 113], ['ring-edge', 91], ['ring-core', 102], ['ring-spec', 107]].forEach(function (c) {
    svg.appendChild(svgEl('circle', { cx: '116', cy: '116', r: String(c[1]), 'class': c[0] }));
  });
  var ring = el('button', { type: 'button', class: 'ring s-unknown', 'data-testid': 'ring' }, [svg, el('span', { class: 'ring-glyph' }, icon('power', 64))]);
  var word = el('div', { class: 'ring-word', 'aria-hidden': 'true' });
  var hint = el('div', { class: 'ring-hint' });
  var countryLn = el('div', { class: 'exit-country' });
  var ipLn = el('div', { class: 'exit-ip' });
  var retryBox = el('div', { class: 'ring-retry', hidden: true }, [
    el('span', null, t('h_unreach')),
    mkBtn(t('retry'), 'secondary', 'refresh', function () { return pollStatus(); })
  ]);
  var stage = el('div', { class: 'stage' }, [ring, word, hint, el('div', { class: 'exit' }, [countryLn, ipLn]), retryBox]);

  var vServer = el('div', { class: 'fact-v' });
  var vSpeed = el('div', { class: 'fact-v' });
  var vProt = el('div', { class: 'fact-v' });
  var protFact = el('a', { href: '#settings', class: 'fact fact-link' }, [el('div', { class: 'fact-k' }, t('h_protect')), vProt]);
  var facts = el('div', { class: 'facts surface' }, [
    el('div', { class: 'fact' }, [el('div', { class: 'fact-k' }, t('h_server')), vServer]),
    el('div', { class: 'fact' }, [el('div', { class: 'fact-k' }, t('h_speed')), vSpeed]),
    protFact
  ]);
  var banners = el('div', { class: 'banners' });

  /* Speed chart: one SVG built once; polls only change path d attributes and text. */
  var CHW = 300, CHT = 18, CHB = 114, CHN = 60;
  var chGrad = svgEl('linearGradient', { id: 'ch-fill', x1: '0', y1: '0', x2: '0', y2: '1' });
  chGrad.appendChild(svgEl('stop', { offset: '0', 'class': 'ch-s0' }));
  chGrad.appendChild(svgEl('stop', { offset: '1', 'class': 'ch-s1' }));
  var chSvg = svgEl('svg', { viewBox: '0 0 300 120', preserveAspectRatio: 'none', 'aria-hidden': 'true', 'class': 'chart-svg' });
  chSvg.appendChild(svgEl('defs', {})).appendChild(chGrad);
  [18, 50, 82, 114].forEach(function (y) { chSvg.appendChild(svgEl('line', { x1: '0', x2: '300', y1: String(y), y2: String(y), 'class': 'ch-grid' })); });
  var chArea = chSvg.appendChild(svgEl('path', { d: '', fill: 'url(#ch-fill)', 'class': 'ch-area' }));
  var chDown = chSvg.appendChild(svgEl('path', { d: '', 'class': 'ch-down' }));
  var chUp = chSvg.appendChild(svgEl('path', { d: '', 'class': 'ch-up' }));
  var chMax = el('span', { class: 'ch-max' });
  var chDot = el('i', { class: 'ch-dot', hidden: true });
  var chEmpty = el('div', { class: 'ch-empty' }, t('ch_empty'));
  var lvD = el('b', { class: 'ltr', dir: 'ltr' }, '-');
  var lvU = el('b', { class: 'ltr', dir: 'ltr' }, '-');
  var chart = el('section', { class: 'chart-panel surface', 'aria-label': t('ch_title') }, [
    el('div', { class: 'chart-head' }, [
      el('h2', null, t('ch_title')),
      el('div', { class: 'legend' }, [
        el('span', { class: 'lg' }, [el('i', { class: 'lg-sw lg-down' }), t('h_down'), ' ', lvD]),
        el('span', { class: 'lg' }, [el('i', { class: 'lg-sw lg-up' }), t('h_up'), ' ', lvU])
      ])
    ]),
    el('div', { class: 'chart-wrap', dir: 'ltr', role: 'img', 'aria-label': t('ch_aria') }, [chSvg, chDot, chMax, chEmpty])
  ]);
  function drawChart(s) {
    if (document.hidden) return;
    var n = H.sd.length, live = H.down !== null && s !== 'off' && s !== 'unknown';
    lvD.textContent = live ? num(H.down, 1) : '-';
    lvU.textContent = live ? num(H.up, 1) : '-';
    chEmpty.hidden = n > 1;
    if (n < 2) { chMax.textContent = ''; chArea.setAttribute('d', ''); chDown.setAttribute('d', ''); chUp.setAttribute('d', ''); return; }
    var mx = niceMax(Math.max(1, Math.max.apply(null, H.sd.concat(H.su))));
    var step = CHW / (CHN - 1), x0 = CHW - (n - 1) * step;
    function line(a) {
      return a.map(function (v, i) { return (i ? 'L' : 'M') + (x0 + i * step).toFixed(1) + ' ' + (CHB - Math.min(v, mx) / mx * (CHB - CHT)).toFixed(1); }).join('');
    }
    var pd = line(H.sd);
    chDown.setAttribute('d', pd);
    chDot.style.top = (parseFloat(pd.slice(pd.lastIndexOf(' ') + 1)) / 120 * 100) + '%';
    chDot.hidden = false;
    chArea.setAttribute('d', pd + 'L' + CHW + ' ' + CHB + 'L' + x0.toFixed(1) + ' ' + CHB + 'Z');
    chUp.setAttribute('d', line(H.su));
    chMax.textContent = num(mx, 1) + ' ' + t('ch_unit');
  }

  function ringState() {
    if (H.busy) return 'connecting';
    if (!H.status) return 'unknown';
    var st = H.status.passwall && H.status.passwall.state;
    if (st === 'running') return H.exitBad >= 2 ? 'problem' : 'connected';
    if (st === 'disabled') return 'off';
    if (st === 'stopped') return 'problem';
    return 'unknown';
  }
  function paint() {
    var s = ringState();
    ring.className = 'ring s-' + s;
    ring.disabled = H.busy;
    if (H.busy) ring.setAttribute('aria-busy', 'true'); else ring.removeAttribute('aria-busy');
    ring.setAttribute('aria-label', t('h_aria_' + s));
    word.className = 'ring-word w-' + s;
    word.textContent = H.loaded || H.busy ? t('h_' + s) : '...';

    // Hint: one suggested action when something is wrong.
    hint.replaceChildren();
    if (s === 'problem') {
      var running = H.status && H.status.passwall && H.status.passwall.state === 'running';
      if (running) hint.appendChild(el('a', { href: '#servers' }, t('h_hint_server')));
      else hint.textContent = t('h_hint_stopped');
    }
    retryBox.hidden = !(s === 'unknown' && H.loaded);

    // Exit line
    countryLn.textContent = '';
    ipLn.textContent = '';
    ipLn.hidden = true;
    countryLn.className = 'exit-country';
    if (s === 'off') {
      countryLn.textContent = t('h_off_warn');
      countryLn.className = 'exit-country warn-text';
    } else if (s === 'unknown' || s === 'connecting') {
      countryLn.textContent = '...';
    } else if (H.exit && H.exit.reachable && H.exit.ip) {
      countryLn.textContent = countryName(H.exit.country) || '';
      ipLn.replaceChildren(ltr(H.exit.ip));
      ipLn.hidden = false;
    } else if (H.exit && H.exit.reachable === false && H.exitBad >= 2) {
      countryLn.textContent = t('h_no_exit');
    } else {
      countryLn.textContent = '...';
    }

    // Facts
    var n = H.status && H.status.node;
    if (!H.status) vServer.textContent = '-';
    else if (n && n.protocol === '_balancing') vServer.textContent = t('h_auto');
    else vServer.replaceChildren(n && n.name ? bdi(n.name) : '-');

    if (H.down === null || s === 'off' || s === 'unknown') {
      vSpeed.textContent = '-';
    } else {
      vSpeed.replaceChildren(
        el('span', { class: 'ltr', dir: 'ltr', title: t('h_down') }, '↓ ' + num(H.down, 1)),
        ' ',
        el('span', { class: 'ltr', dir: 'ltr', title: t('h_up') }, '↑ ' + num(H.up, 1)),
        ' ', el('span', { class: 'fact-u' }, t('u_mbps'))
      );
    }
    drawChart(s);

    var ks = H.status && H.status.killswitch;
    if (!ks) vProt.textContent = '-';
    else if (ks.armed) vProt.textContent = t('h_prot_on') + ' (' + t(ks.mode === 'strict' ? 'ks_strict_s' : 'ks_smart_s') + ')';
    else vProt.textContent = t('h_prot_off');
    protFact.className = 'fact fact-link' + (ks && ks.armed ? ' ok' : ks ? ' warn' : '');
  }

  function pollStatus() {
    if (H.busy) return Promise.resolve();
    return api('api-status', { auth: false, timeout: 10000 }).then(function (s) {
      if (!c.alive() || H.busy) return;
      H.loaded = true;
      H.fails = 0;
      H.status = s;
      var w = s.wan || {}, now = Date.now(), rx = parseFloat(w.rx_bytes), tx = parseFloat(w.tx_bytes);
      if (isFinite(rx) && isFinite(tx)) {
        if (H.prev && rx >= H.prev.rx && tx >= H.prev.tx && now - H.prev.t > 500) {
          var dt = (now - H.prev.t) / 1000;
          H.down = (rx - H.prev.rx) * 8 / 1e6 / dt;
          H.up = (tx - H.prev.tx) * 8 / 1e6 / dt;
          H.sd.push(H.down);
          H.su.push(H.up);
          if (H.sd.length > CHN) { H.sd.shift(); H.su.shift(); }
        }
        H.prev = { t: now, rx: rx, tx: tx };
      } else { H.prev = null; H.down = null; H.up = null; }
      var base = s.passwall && s.passwall.state;
      if (base !== H.base) {
        H.base = base;
        H.exit = null;
        H.exitBad = 0;
        paint();
        if (base === 'running') getExit();
      }
      paint();
    }).catch(function (e) {
      if (!c.alive()) return;
      H.fails++;
      if (H.fails >= 2) { H.status = null; H.loaded = true; H.base = ''; paint(); }
    });
  }
  function getExit() {
    if (!c.alive() || H.busy) return Promise.resolve();
    if (!H.status || !H.status.passwall || H.status.passwall.state !== 'running') return Promise.resolve();
    return api('api-exit', { timeout: 15000 }).then(function (r) {
      if (!c.alive()) return;
      H.exit = r;
      H.exitAt = Date.now();
      H.exitBad = r.reachable === false ? H.exitBad + 1 : 0;
      paint();
    }).catch(function () {});
  }

  // Asks often until the exit is known, then settles at once every 30 seconds.
  function exitTick() {
    if (H.exit && H.exit.reachable && Date.now() - H.exitAt < 30000) return;
    getExit();
  }

  function stop() { clearInterval(tS); clearInterval(tE); tS = tE = null; }
  function start() { stop(); tS = setInterval(pollStatus, 3000); tE = setInterval(exitTick, 6000); }
  function vis() {
    if (document.hidden) { stop(); return; }
    H.prev = null;
    pollStatus();
    getExit();
    start();
  }
  document.addEventListener('visibilitychange', vis);
  c.cleanups.push(function () { stop(); document.removeEventListener('visibilitychange', vis); });

  ring.addEventListener('click', async function () {
    if (H.busy || asking) return;
    var s = ringState();
    if (s === 'unknown') { pollStatus(); return; }
    var running = H.status.passwall.state === 'running';
    var action = running ? 'off' : 'on';
    if (action === 'off') {
      asking = true;
      var hiding = H.status.webrtc && H.status.webrtc.enabled;
      var ok = await confirmBox(t('cf_off_t'), t(hiding ? 'cf_off_rtc' : 'cf_off_d'), t('turn_off'), true);
      asking = false;
      if (!ok) return;
    }
    H.busy = true;
    paint();
    try {
      await api('api-toggle', { method: 'POST', body: { action: action } });
      applyToast(await waitApply());
    } catch (e) {
      if (!e || e.code !== 'unauthorized') toast(errMsg(e), 'bad');
    }
    H.busy = false;
    if (!c.alive()) return;
    H.base = '';
    H.exit = null;
    H.exitBad = 0;
    H.prev = null;
    paint();
    pollStatus();
  });

  add(root, [el('div', { class: 'home-tools' }, themeFlip()), banners, stage, el('div', { class: 'home-sw' }, [adblockSwitch(c), webrtcSwitch(c)]), facts, chart]);
  paint();
  pollStatus();
  start();

  // Subscription alerts. Slow (each panel is asked live), so they never block the ring.
  Promise.all([api('api-sub'), api('api-sub-info', { timeout: 40000 })]).then(function (r) {
    if (!c.alive()) return;
    var names = {};
    (r[0].subscriptions || []).forEach(function (s) { names[s.id] = s.remark; });
    (r[1].subscriptions || []).forEach(function (inf) {
      var a = subAlert(inf);
      if (!a) return;
      var msg = a.kind === 'expired' ? t('al_expired', { d: fmtDate(a.exp) }) : t('al_soon', { d: num(a.days) });
      banners.appendChild(el('a', { href: '#sources', class: 'banner ' + (a.kind === 'expired' ? 'bad' : 'warn'), role: 'alert', onclick: function () { pendingSub = inf.id; } }, [
        icon('warn'), el('span', null, [bdi(names[inf.id] || inf.id), ' - ', msg])
      ]));
    });
  }).catch(function () {});
}

/* ---------- Servers ---------- */

function pingChip(S, n) {
  if (n.kind !== 'server') return null;
  if (S.cur === n.id) return el('span', { class: 'chip' }, t('sv_testing'));
  var p = PING[n.id];
  if (p === undefined) return null;
  if (p < 0) return el('span', { class: 'chip chip-bad' }, t('failed'));
  return el('span', { class: 'chip ' + (p < 800 ? 'chip-ok' : p < 1500 ? 'chip-warn' : 'chip-bad') }, [el('span', { class: 'ltr', dir: 'ltr' }, num(p)), ' ', t('u_ms')]);
}

function viewServers(root, c) {
  var S = { nodes: [], active: '', auto: null, q: '', sort: 'name', locked: false, testing: false, cur: null, abort: null, shuntOpen: false, autoOpen: false, pool: {}, interval: '2m' };
  var bar = makeBar();
  var body = el('div', { class: 'stack' });
  var list = el('div', { class: 'stack' });
  var search = el('input', { type: 'search', class: 'input', 'data-testid': 'server-search', 'aria-label': t('sv_search'), placeholder: t('sv_search'), autocomplete: 'off', oninput: function () { S.q = search.value.trim().toLowerCase(); renderList(); } });
  var sortSel = el('select', { class: 'input', 'aria-label': t('sv_sort') }, [
    el('option', { value: 'name' }, t('sv_sort_name')),
    el('option', { value: 'speed' }, t('sv_sort_speed'))
  ]);
  sortSel.addEventListener('change', function () { S.sort = sortSel.value; renderList(); });
  var testBtn = mkBtn(t('sv_test_all'), 'secondary', 'bolt', runTests);
  testBtn.setAttribute('data-testid', 'test-all');

  c.cleanups.push(function () { if (S.abort) S.abort.abort(); });

  function cmp(a, b) {
    if (S.sort === 'speed') {
      var ka = PING[a.id] === undefined ? 1e9 : PING[a.id] < 0 ? 1e9 + 1 : PING[a.id];
      var kb = PING[b.id] === undefined ? 1e9 : PING[b.id] < 0 ? 1e9 + 1 : PING[b.id];
      if (ka !== kb) return ka - kb;
    }
    return String(a.name || a.id).localeCompare(String(b.name || b.id));
  }
  function matches(n) {
    if (!S.q) return true;
    return (String(n.name || '') + ' ' + String(n.group || '') + ' ' + String(n.protocol || '')).toLowerCase().indexOf(S.q) >= 0;
  }
  function rowBtn(n, title, meta, chip, selected) {
    var isAuto = n.kind === 'auto';
    var b = el('button', { type: 'button', class: 'rowb' + (selected ? ' sel' : ''), 'data-testid': isAuto ? 'server-auto' : 'server-row', 'data-id': isAuto ? null : n.id, 'aria-current': selected ? 'true' : null, disabled: S.locked || S.testing, onclick: function () { choose(n); } }, [
      el('span', { class: 'rb-main' }, [el('span', { class: 'rb-name' }, title), meta]),
      chip,
      selected ? el('span', { class: 'tick' }, icon('check', 20)) : null
    ]);
    return el('li', null, b);
  }
  function serverRow(n) {
    var meta = n.protocol && n.protocol.charAt(0) !== '_' ? el('span', { class: 'rb-meta ltr', dir: 'ltr' }, n.protocol) : null;
    return rowBtn(n, bdi(n.name || n.id), meta, pingChip(S, n), n.id === S.active);
  }
  function surface(items) { return el('ul', { class: 'surface list' }, items); }

  function autoSettings(servers) {
    var count = el('span', { class: 'count', 'aria-live': 'polite' });
    var intSel = el('select', { class: 'input', id: 'sv-int' });
    var opts = ['1m', '2m', '5m', '10m', '30m'];
    if (S.interval && opts.indexOf(S.interval) < 0) opts.push(S.interval);
    opts.forEach(function (v) { intSel.appendChild(el('option', { value: v, selected: v === S.interval }, fmtInterval(v))); });
    intSel.addEventListener('change', function () { S.interval = intSel.value; });
    var boxes = [];
    function upd() { count.textContent = t('sv_count', { n: num(boxes.filter(function (x) { return x.i.checked; }).length), m: num(servers.length) }); }
    var checks = el('div', { class: 'checks' });
    servers.forEach(function (n) {
      var inp = el('input', { type: 'checkbox', checked: !!S.pool[n.id], onchange: function () { S.pool[n.id] = inp.checked; upd(); } });
      boxes.push({ id: n.id, i: inp });
      checks.appendChild(el('label', { class: 'check' }, [inp, el('span', null, [bdi(n.name || n.id), n.group ? el('span', { class: 'rb-meta' }, [' - ', bdi(n.group)]) : null])]));
    });
    function setAll(v) { boxes.forEach(function (x) { x.i.checked = v; S.pool[x.id] = v; }); upd(); }
    var save = mkBtn(t('save'), 'primary', 'check', async function () {
      var pool = boxes.filter(function (x) { return x.i.checked; }).map(function (x) { return x.id; });
      if (!pool.length) { toast(t('err_empty_pool'), 'bad'); return; }
      await api('api-auto', { method: 'POST', body: { interval: S.interval, pool: pool } });
      toast(t('saved'), 'ok');
    });
    upd();
    var d = el('details', { class: 'fold', open: S.autoOpen, ontoggle: function (e) { S.autoOpen = e.target.open; } }, [
      el('summary', null, el('span', null, t('sv_auto_set'))),
      el('div', { class: 'dbody' }, [
        el('div', { class: 'field' }, [el('label', { class: 'fld', 'for': 'sv-int' }, t('sv_interval')), intSel]),
        el('p', { class: 'help' }, t('sv_pool_help')),
        el('div', { class: 'pool-ctl' }, [count, mkBtn(t('sel_all'), 'ghost', null, function () { setAll(true); }), mkBtn(t('sel_none'), 'ghost', null, function () { setAll(false); })]),
        checks, el('div', { class: 'actions' }, save)
      ])
    ]);
    return el('li', null, d);
  }

  function renderList() {
    list.replaceChildren();
    if (!S.nodes.length) { list.appendChild(emptyEl(t('sv_empty'))); return; }
    var servers = S.nodes.filter(function (n) { return n.kind === 'server'; });
    var shunts = S.nodes.filter(function (n) { return n.kind === 'shunt'; });
    var autoNode = S.nodes.filter(function (n) { return n.kind === 'auto'; })[0];
    if (autoNode) {
      var items = [rowBtn(autoNode, t('sv_auto'), el('span', { class: 'rb-meta' }, t('sv_auto_d')), null, autoNode.id === S.active)];
      if (S.auto) items.push(autoSettings(servers));
      list.appendChild(surface(items));
    }
    var order = [], map = {};
    servers.filter(matches).forEach(function (n) {
      var g = n.group || '';
      if (!map[g]) { map[g] = []; order.push(g); }
      map[g].push(n);
    });
    order.forEach(function (g) {
      list.appendChild(el('section', null, [secTitle(g ? bdi(g) : t('sv_nogroup')), surface(map[g].sort(cmp).map(serverRow))]));
    });
    if (!order.length && S.q) list.appendChild(emptyEl(t('sv_nomatch')));
    if (shunts.length) {
      var rows = shunts.filter(matches).sort(cmp).map(serverRow);
      if (rows.length) {
        list.appendChild(el('details', { class: 'surface fold', open: S.shuntOpen, ontoggle: function (e) { S.shuntOpen = e.target.open; } }, [
          el('summary', null, el('span', null, t('sv_shunt') + ' (' + num(shunts.length) + ')')),
          el('ul', { class: 'list' }, rows)
        ]));
      }
    }
  }
  function apply(r) {
    S.nodes = r[0].nodes || [];
    S.active = r[0].active || '';
    S.auto = r[1];
    if (S.auto) {
      S.interval = S.auto.interval || S.interval;
      S.pool = {};
      (S.auto.pool || []).forEach(function (id) { S.pool[id] = true; });
    }
  }
  function fetchAll() {
    return Promise.all([api('api-nodes'), api('api-auto').catch(function (e) { if (e.code === 'unauthorized') throw e; return null; })]);
  }
  function load() {
    loadInto(body, c, fetchAll, function (r) {
      apply(r);
      body.appendChild(list);
      renderList();
    });
  }
  function refreshQuiet() {
    return api('api-nodes').then(function (d) {
      if (!c.alive()) return;
      S.nodes = d.nodes || [];
      S.active = d.active || '';
      renderList();
    }).catch(function () {});
  }

  async function choose(n) {
    if (n.id === S.active || S.locked || S.testing) return;
    S.locked = true;
    renderList();
    bar.show(t('applying'));
    try {
      var r = await api('api-switch', { method: 'POST', body: { id: n.id } });
      if (!r.restarting) toast(t('sv_selected'), 'ok');
      else applyToast(await waitApply());
    } catch (e) { toast(errMsg(e), 'bad'); }
    S.locked = false;
    bar.hide();
    if (c.alive()) await refreshQuiet();
  }

  async function runTests() {
    if (S.testing) return;
    var ids = S.nodes.filter(function (n) { return n.kind === 'server'; }).map(function (n) { return n.id; });
    if (!ids.length) return;
    S.testing = true;
    S.abort = new AbortController();
    var ctl = S.abort, sig = ctl.signal;
    for (var i = 0; i < ids.length; i++) {
      if (sig.aborted || !c.alive()) break;
      S.cur = ids[i];
      bar.show(t('sv_test_prog', { n: num(i + 1), m: num(ids.length) }), function () { ctl.abort(); });
      renderList();
      try {
        var r = await api('api-ping?id=' + encodeURIComponent(ids[i]) + '&mode=real', { timeout: 45000, signal: sig });
        PING[ids[i]] = typeof r.ms === 'number' ? r.ms : -1;
      } catch (e) {
        if (e.code === 'cancelled' || e.code === 'unauthorized') break;
        PING[ids[i]] = -1;
      }
    }
    S.cur = null;
    S.abort = null;
    S.testing = false;
    bar.hide();
    if (c.alive()) renderList();
  }

  add(root, [bar.node, viewTitle(t('nav_servers'), testBtn),
    el('div', { class: 'controls' }, [el('div', { class: 'search' }, [icon('search', 18), search]), sortSel]),
    body]);
  load();
}

/* ---------- Sources ---------- */

var CFG_RE = /^(vless|vmess|trojan|ss|hysteria2|hy2|tuic):\/\//i;
function detect(text) {
  var lines = text.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  if (!lines.length) return { kind: 'none' };
  if (lines.length === 1 && /^https?:\/\//i.test(lines[0])) return { kind: 'sub', url: lines[0] };
  if (lines.every(function (l) { return CFG_RE.test(l); })) return { kind: 'cfg', n: lines.length, links: lines.join('\n') };
  return { kind: 'bad' };
}

function viewSources(root, c) {
  var S = { updating: false };
  var bar = makeBar();
  var body = el('div', { class: 'stack' });
  var refs = {};

  function fillInfo(ref, inf) {
    ref.chip.replaceChildren();
    ref.usage.replaceChildren();
    ref.expiry.replaceChildren();
    if (!inf) { ref.usage.textContent = t('sb_noinfo'); return; }
    if (!inf.reachable) {
      ref.chip.appendChild(el('span', { class: 'chip chip-warn' }, t('sb_unreach')));
      ref.usage.textContent = t('sb_unreach');
    } else {
      var total = Number(inf.total_bytes) || 0, used = Number(inf.used_bytes) || 0;
      if (total > 0) {
        var pct = Math.min(100, Math.round(used / total * 100));
        var fill = el('i');
        fill.style.width = pct + '%';
        ref.usage.appendChild(el('div', null, t('sb_usage', { u: fmtBytes(used), t: fmtBytes(total), p: num(pct) })));
        ref.usage.appendChild(el('div', { class: 'bar' + (pct > 90 ? ' bad' : pct > 75 ? ' warn' : ''), role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, fill));
      } else {
        ref.usage.textContent = used > 0 ? t('sb_used_only', { u: fmtBytes(used) }) : t('sb_nototal');
      }
    }
    var exp = Number(inf.expire) || 0;
    if (exp > 0) {
      var a = subAlert(inf);
      ref.expiry.textContent = t('sb_expires') + ': ' + fmtDate(exp);
      if (inf.reachable) {
        if (a && a.kind === 'expired') ref.chip.appendChild(el('span', { class: 'chip chip-bad' }, t('sb_expired')));
        else if (a) ref.chip.appendChild(el('span', { class: 'chip chip-warn' }, t('al_soon_s', { d: num(a.days) })));
        else ref.chip.appendChild(el('span', { class: 'chip' }, fmtDate(exp)));
      }
    } else {
      ref.expiry.textContent = t('sb_noexpiry');
    }
  }
  function loadInfo() {
    api('api-sub-info', { timeout: 40000 }).then(function (r) {
      if (!c.alive()) return;
      var byId = {};
      (r.subscriptions || []).forEach(function (x) { byId[x.id] = x; });
      Object.keys(refs).forEach(function (id) { fillInfo(refs[id], byId[id]); });
    }).catch(function () {
      if (!c.alive()) return;
      Object.keys(refs).forEach(function (id) { fillInfo(refs[id], null); });
    });
  }

  // The router fetches servers in the background; show progress until it finishes.
  async function waitForUpdate() {
    S.updating = true;
    bar.show(t('sb_updating'));
    var last = '';
    for (var i = 0; i < 100; i++) {
      await sleep(3000);
      if (!c.alive()) return;
      try {
        var r = await api('api-sub-update');
        last = r.last || '';
        if (!r.running) break;
      } catch (e) { if (e.code === 'unauthorized') return; }
    }
    S.updating = false;
    bar.hide();
    if (last === 'timeout') toast(t('sb_timeout'), 'bad');
    else toast(t('sb_updated'), 'ok');
    load();
  }
  async function updateAll() {
    if (S.updating) return;
    await api('api-sub-update', { method: 'POST', body: {} });
    await waitForUpdate();
  }

  function subRow(s) {
    var chip = el('span', { class: 'sum-chip' });
    var usage = el('div', { class: 'help' }, t('sb_checking'));
    var expiry = el('div', { class: 'help' });
    refs[s.id] = { chip: chip, usage: usage, expiry: expiry };
    var urlIn = el('input', { type: 'text', class: 'input', dir: 'ltr', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', 'aria-label': t('sb_new_url'), placeholder: 'https://' });
    var setBtn = mkBtn(t('sb_replace'), 'secondary', 'refresh', async function () {
      var u = urlIn.value.trim();
      if (!u) { toast(t('err_bad_url'), 'bad'); return; }
      if (S.updating) return;
      await api('api-sub', { method: 'POST', body: { action: 'set_url', id: s.id, url: u } });
      urlIn.value = '';
      await waitForUpdate();
    });
    var updBtn = mkBtn(t('sb_update'), 'secondary', 'refresh', updateAll);
    var delBtn = mkBtn(t('delete'), 'danger', 'trash', async function () {
      var ok = await confirmBox(t('sb_del_t'), t('sb_del_d', { n: num(s.nodes || 0) }), t('delete'), true);
      if (!ok) return;
      await api('api-sub', { method: 'POST', body: { action: 'delete', id: s.id } });
      toast(t('deleted'), 'ok');
      load();
    });
    var d = el('details', { class: 'fold', open: pendingSub === s.id }, [
      el('summary', null, [el('span', { class: 'sum-main' }, [el('span', { class: 'rb-name' }, bdi(s.remark || s.id)), el('span', { class: 'rb-meta' }, t('so_servers', { n: num(s.nodes || 0) }))]), chip]),
      el('div', { class: 'dbody' }, [
        el('div', { class: 'help' }, ltr(s.host || '-')),
        usage, expiry,
        el('label', { class: 'fld', style: 'margin-block-start:16px' }, t('sb_new_url')),
        el('div', { class: 'inline-form' }, [urlIn, setBtn]),
        el('p', { class: 'help' }, t('sb_url_help')),
        el('div', { class: 'actions' }, [updBtn, delBtn])
      ])
    ]);
    if (pendingSub === s.id) { pendingSub = null; setTimeout(function () { d.scrollIntoView({ block: 'center' }); }, 0); }
    return el('li', null, d);
  }
  function cfgRow(n) {
    var box = el('textarea', { class: 'input', dir: 'ltr', spellcheck: 'false', placeholder: 'vless://...', 'aria-label': t('mc_new') });
    var rep = mkBtn(t('sb_replace'), 'secondary', 'refresh', async function () {
      var v = box.value.trim();
      if (!v) { toast(t('err_no_links'), 'bad'); return; }
      await api('api-add-config', { method: 'POST', body: { group: n.group, links: v, replace: n.id }, timeout: 40000 });
      toast(t('saved'), 'ok');
      load();
    });
    var del = mkBtn(t('delete'), 'danger', 'trash', async function () {
      var ok = await confirmBox(t('mc_del_t'), t('mc_del_d'), t('delete'), true);
      if (!ok) return;
      await api('api-node', { method: 'POST', body: { action: 'delete', id: n.id } });
      toast(t('deleted'), 'ok');
      load();
    });
    return el('li', null, el('details', { class: 'fold' }, [
      el('summary', null, el('span', { class: 'sum-main' }, el('span', { class: 'rb-name' }, bdi(n.name || n.id)))),
      el('div', { class: 'dbody' }, [
        el('div', { class: 'help' }, ltr((n.address || '-') + ':' + (n.port || '-'))),
        el('label', { class: 'fld', style: 'margin-block-start:16px' }, t('mc_new')),
        box,
        el('div', { class: 'actions' }, [rep, del])
      ])
    ]));
  }

  function load() {
    refs = {};
    loadInto(body, c, function () { return Promise.all([api('api-sub'), api('api-nodes')]); }, function (r) {
      var subs = r[0].subscriptions || [];
      var cfgs = (r[1].nodes || []).filter(function (n) { return n.manual; });
      if (!subs.length && !cfgs.length) { body.appendChild(emptyEl(t('so_empty'))); return; }
      if (subs.length) body.appendChild(el('section', null, [secTitle(t('so_subs')), el('ul', { class: 'surface list' }, subs.map(subRow))]));
      var order = [], map = {};
      cfgs.forEach(function (n) {
        var g = n.group || '';
        if (!map[g]) { map[g] = []; order.push(g); }
        map[g].push(n);
      });
      order.forEach(function (g) {
        body.appendChild(el('section', null, [secTitle([t('so_configs'), ' - ', g ? bdi(g) : t('sv_nogroup')]), el('ul', { class: 'surface list' }, map[g].map(cfgRow))]));
      });
      if (subs.length) loadInfo();
    });
  }

  function addDialog() {
    var ta = el('textarea', { class: 'input', id: 'ad-ta', dir: 'ltr', spellcheck: 'false', autocapitalize: 'none', placeholder: 'https://...  vless://...', 'data-testid': 'add-textarea' });
    var det = el('p', { class: 'help', 'aria-live': 'polite' });
    var errTxt = el('p', { class: 'err-text', role: 'alert', hidden: true });
    var name = el('input', { type: 'text', class: 'input', id: 'ad-name', maxlength: '64', autocomplete: 'off', 'data-testid': 'add-name' });
    var group = el('input', { type: 'text', class: 'input', id: 'ad-group', maxlength: '64', placeholder: 'Manual', autocomplete: 'off', 'data-testid': 'add-group' });
    var nameF = el('div', { class: 'field', hidden: true }, [el('label', { class: 'fld', 'for': 'ad-name' }, t('ad_name')), name]);
    var groupF = el('div', { class: 'field', hidden: true }, [el('label', { class: 'fld', 'for': 'ad-group' }, t('ad_group')), group]);
    var cancel = el('button', { type: 'button', class: 'btn btn-secondary' }, t('cancel'));
    var save = el('button', { type: 'button', class: 'btn btn-primary', disabled: true, 'data-testid': 'add-save' }, t('save'));
    var fail = el('p', { class: 'err-text', role: 'alert', hidden: true });
    var dlg = modal(t('ad_title'), [
      el('div', { class: 'field' }, [el('label', { class: 'fld', 'for': 'ad-ta' }, t('ad_paste')), ta]),
      det, errTxt, nameF, groupF, fail,
      el('div', { class: 'dlg-actions' }, [cancel, save])
    ]);
    var D = { kind: 'none' };
    function upd() {
      D = detect(ta.value);
      errTxt.hidden = D.kind !== 'bad';
      if (D.kind === 'bad') errTxt.textContent = t('ad_bad');
      nameF.hidden = D.kind !== 'sub';
      groupF.hidden = D.kind !== 'cfg';
      det.textContent = D.kind === 'sub' ? t('ad_is_sub') : D.kind === 'cfg' ? t('ad_is_cfg', { n: num(D.n) }) : '';
      save.disabled = !(D.kind === 'cfg' || (D.kind === 'sub' && name.value.trim()));
    }
    ta.addEventListener('input', upd);
    name.addEventListener('input', upd);
    cancel.addEventListener('click', function () { dlg.close(); });
    save.addEventListener('click', dlgRun(save, fail, async function () {
      if (D.kind === 'sub') {
        if (S.updating) throw { code: 'updating' };
        await api('api-sub', { method: 'POST', body: { action: 'add', remark: name.value.trim(), url: D.url } });
        dlg.close();
        await waitForUpdate();
      } else if (D.kind === 'cfg') {
        var r = await api('api-add-config', { method: 'POST', body: { group: group.value.trim() || 'Manual', links: D.links }, timeout: 40000 });
        dlg.close();
        toast(t('ac_done', { n: num(r.added || 0) }), 'ok');
        load();
      }
    }));
    ta.focus();
  }

  var addBtn = mkBtn(t('so_add'), 'primary', 'plus', function () { addDialog(); });
  addBtn.setAttribute('data-testid', 'sources-add');
  var updAllBtn = mkBtn(t('so_update_all'), 'secondary', 'refresh', updateAll);
  add(root, [bar.node, viewTitle(t('nav_sources'), [updAllBtn, addBtn]), body]);
  load();
}

/* ---------- Devices ---------- */

function viewDevices(root, c) {
  var body = el('div');
  function load() {
    loadInto(body, c, function () { return api('api-devices'); }, function (d) {
      var arr = (d.devices || []).slice().sort(function (a, b) {
        if (!!a.online !== !!b.online) return a.online ? -1 : 1;
        return String(a.name || a.ip).localeCompare(String(b.name || b.ip));
      });
      if (!arr.length) { body.appendChild(emptyEl(t('dv_empty'))); return; }
      var on = arr.filter(function (x) { return x.online; }).length;
      body.appendChild(el('p', { class: 'help count-line' }, t('dv_count', { n: num(on), m: num(arr.length) })));
      body.appendChild(el('ul', { class: 'surface list' }, arr.map(function (x) {
        return el('li', { class: 'dev' }, [
          el('div', { class: 'rb-main' }, [
            el('span', { class: 'rb-name' }, x.name ? bdi(x.name) : t('dv_unknown')),
            el('span', { class: 'rb-meta dev-meta' }, [ltr(x.ip || '-'), ltr(x.mac || '-')])
          ]),
          el('span', { class: 'status ' + (x.online ? 'on' : 'off') }, [el('span', { class: 'dot' }), t(x.online ? 'online' : 'offline')])
        ]);
      })));
    });
  }
  add(root, [viewTitle(t('nav_devices'), mkBtn(t('refresh'), 'secondary', 'refresh', function () { load(); })), body]);
  load();
}

/* ---------- AdGuard ---------- */

function listNum(v) { var x = Number(v); return isFinite(x) && x > 0 ? x : 0; }
// Always 24 values, oldest first. A short list is padded at the old end so the newest hour stays on the right.
function hourArr(a) {
  var r = [], i;
  a = Array.isArray(a) ? a.slice(-24) : [];
  for (i = 0; i < 24 - a.length; i++) r.push(0);
  a.forEach(function (v) { r.push(listNum(v)); });
  return r;
}
function fmtClock(sec) {
  try {
    return new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(Number(sec) * 1000));
  } catch (e) { return String(sec); }
}
// Domains and client names are untrusted: they only ever become text nodes, shown left-to-right.
function ltrText(s) { return el('bdi', { dir: 'ltr' }, s === undefined || s === null || s === '' ? '-' : String(s)); }

function viewAdguard(root, c) {
  var G = { ui: null, busy: false };
  var body = el('div');
  var timer = null;

  function fetchAg() { return api('api-adguard'); }

  function buildOff() {
    var onBtn = mkBtn(t('ag_turn_on'), 'primary', 'power', async function () {
      G.busy = true;
      try {
        await api('api-adblock', { method: 'POST', body: { enabled: true }, timeout: 45000 });
      } finally { G.busy = false; }
      if (c.alive()) load();
    });
    onBtn.setAttribute('data-testid', 'adguard-on-button');
    var node = el('section', { class: 'surface ag-off', 'data-testid': 'adguard-off' }, [
      el('h1', { lang: 'en', dir: 'ltr' }, t('ag_off')),
      onBtn
    ]);
    return { mode: 'off', node: node, update: function () {} };
  }

  function topList(title) {
    var ul = el('ul', { class: 'surface list' });
    return {
      node: el('section', null, [secTitle(title), ul]),
      fill: function (items) {
        ul.replaceChildren();
        var arr = (Array.isArray(items) ? items : []).slice(0, 10), mx = 1;
        if (!arr.length) { ul.appendChild(el('li', { class: 'ag-row' }, el('span', { class: 'rb-meta' }, t('ag_none')))); return; }
        arr.forEach(function (x) { mx = Math.max(mx, listNum(x && x.count)); });
        arr.forEach(function (x) {
          x = x || {};
          var n = listNum(x.count), fill = el('i');
          fill.style.width = (n / mx * 100).toFixed(1) + '%';
          ul.appendChild(el('li', { class: 'ag-row' }, [
            el('div', { class: 'ag-line1' }, [el('span', { class: 'rb-name ag-name' }, ltrText(x.name)), el('span', { class: 'ag-count' }, num(n))]),
            el('div', { class: 'ag-track' }, fill)
          ]));
        });
      }
    };
  }

  function buildOn() {
    var sw = el('button', { type: 'button', class: 'switch', role: 'switch', 'data-testid': 'adguard-toggle', 'aria-checked': 'true', 'aria-labelledby': 'ag-sw-l' }, el('span', { class: 'knob' }));
    sw.addEventListener('click', async function () {
      var ok = await confirmBox(t('ag_cf_t'), t('ag_cf_d'), t('ag_cf_ok'), true);
      if (!ok || !c.alive()) return;
      sw.disabled = true;
      G.busy = true;
      try {
        await api('api-adblock', { method: 'POST', body: { enabled: false }, timeout: 45000 });
        G.busy = false;
        if (c.alive()) load();
        return;
      } catch (e) { toast(errMsg(e), 'bad'); }
      G.busy = false;
      if (c.alive()) sw.disabled = false;
    });
    var head = el('div', { class: 'view-head' }, [
      el('h1', null, t('ag_title')),
      el('div', { class: 'ag-head-sw' }, [el('span', { id: 'ag-sw-l' }, t('ag_sw_on')), sw])
    ]);
    var notice = el('div', { class: 'note ag-note', role: 'status', hidden: true }, t('ag_starting'));

    /* Stat tiles, same tinted glass as Home */
    var vQ = el('div', { class: 'fact-v' }), vB = el('div', { class: 'fact-v' }), uB = el('div', { class: 'fact-u' }), vA = el('div', { class: 'fact-v' });
    var tiles = el('div', { class: 'facts surface ag-facts' }, [
      el('div', { class: 'fact' }, [el('div', { class: 'fact-k' }, t('ag_queries')), vQ]),
      el('div', { class: 'fact' }, [el('div', { class: 'fact-k' }, t('ag_blocked')), vB, uB]),
      el('div', { class: 'fact' }, [el('div', { class: 'fact-k' }, t('ag_avg')), vA, el('div', { class: 'fact-u' }, t('u_ms'))])
    ]);

    /* 24 hour chart: the SVG is built once, updates only change attributes and text. */
    var CW = 288, CT = 18, CB = 114, SLOT = CW / 24;
    var svg = svgEl('svg', { viewBox: '0 0 288 120', preserveAspectRatio: 'none', 'aria-hidden': 'true', 'class': 'chart-svg' });
    [18, 50, 82, 114].forEach(function (y) { svg.appendChild(svgEl('line', { x1: '0', x2: '288', y1: String(y), y2: String(y), 'class': 'ch-grid' })); });
    var bars = [], i;
    for (i = 0; i < 24; i++) {
      bars.push(svg.appendChild(svgEl('rect', { x: (i * SLOT + 2.5).toFixed(1), y: String(CB), width: '7', height: '0', 'class': 'ag-bar' })));
    }
    var line = svg.appendChild(svgEl('path', { d: '', 'class': 'ag-line' }));
    var ptO = svg.appendChild(svgEl('path', { d: '', 'class': 'ag-pt-o' }));
    var ptI = svg.appendChild(svgEl('path', { d: '', 'class': 'ag-pt-i' }));
    var chMax = el('span', { class: 'ch-max' });
    var chart = el('section', { class: 'chart-panel surface', 'aria-label': t('ag_chart_t') }, [
      el('div', { class: 'chart-head' }, [
        el('h2', null, t('ag_chart_t')),
        el('div', { class: 'legend' }, [
          el('span', { class: 'lg' }, [el('i', { class: 'lg-sw lg-bar' }), t('ag_queries')]),
          el('span', { class: 'lg' }, [el('i', { class: 'lg-sw' }), t('ag_blocked')])
        ])
      ]),
      el('div', { class: 'chart-wrap', dir: 'ltr', role: 'img', 'aria-label': t('ag_chart_aria') }, [svg, chMax])
    ]);
    function drawChart(h) {
      var q = hourArr(h && h.queries), b = hourArr(h && h.blocked), k, ld = '', pd = '';
      var mx = niceMax(Math.max(1, Math.max.apply(null, q.concat(b))));
      for (k = 0; k < 24; k++) {
        var yq = CB - Math.min(q[k], mx) / mx * (CB - CT);
        var yb = CB - Math.min(b[k], mx) / mx * (CB - CT);
        var x = (k * SLOT + SLOT / 2).toFixed(1);
        bars[k].setAttribute('y', yq.toFixed(1));
        bars[k].setAttribute('height', (CB - yq).toFixed(1));
        ld += (k ? 'L' : 'M') + x + ' ' + yb.toFixed(1);
        pd += 'M' + x + ' ' + yb.toFixed(1) + 'h.01';
      }
      line.setAttribute('d', ld);
      ptO.setAttribute('d', pd);
      ptI.setAttribute('d', pd);
      chMax.textContent = num(mx);
    }

    /* Donut: blocked share of all queries */
    var R = 48, CIRC = 2 * Math.PI * R;
    var dsvg = svgEl('svg', { viewBox: '0 0 120 120', 'aria-hidden': 'true' });
    dsvg.appendChild(svgEl('circle', { cx: '60', cy: '60', r: String(R), 'stroke-width': '14', 'class': 'dn-allowed' }));
    var dBlock = dsvg.appendChild(svgEl('circle', { cx: '60', cy: '60', r: String(R), 'stroke-width': '14', 'stroke-dasharray': '0 ' + CIRC.toFixed(2), 'class': 'dn-blocked' }));
    var dPct = el('div', { class: 'donut-c' });
    var dB = el('b'), dA = el('b');
    var donut = el('section', { class: 'surface ag-donut-panel', 'aria-label': t('ag_donut_t') }, [
      el('h2', null, t('ag_donut_t')),
      el('div', { class: 'ag-donut-body' }, [
        el('div', { class: 'donut' }, [dsvg, dPct]),
        el('ul', { class: 'dn-leg' }, [
          el('li', { class: 'dn-li' }, [el('i', { class: 'dn-sw dn-sw-b' }), el('span', null, t('ag_blocked')), dB]),
          el('li', { class: 'dn-li' }, [el('i', { class: 'dn-sw dn-sw-a' }), el('span', null, t('ag_allowed')), dA])
        ])
      ])
    ]);

    var topB = topList(t('ag_top_blocked')), topQ = topList(t('ag_top_queried')), topC = topList(t('ag_top_clients'));
    var statsBox = el('div', { class: 'ag-stack' }, [tiles, chart, donut, topB.node, topQ.node, topC.node]);
    var nodata = el('section', { class: 'surface state ag-nodata', 'data-testid': 'adguard-nodata', hidden: true }, [
      icon('adguard', 28), el('h2', null, t('ag_nodata')), el('p', { class: 'help' }, t('ag_nodata_d'))
    ]);

    /* Recent activity: last 30, newest first */
    var recUl = el('ul', { class: 'surface list', 'data-testid': 'adguard-recent' });
    function fillRecent(items) {
      recUl.replaceChildren();
      var arr = (Array.isArray(items) ? items : []).filter(function (x) { return x && typeof x === 'object'; });
      arr = arr.slice().sort(function (a, b) { return listNum(b.time) - listNum(a.time); }).slice(0, 30);
      if (!arr.length) { recUl.appendChild(el('li', { class: 'ag-rec' }, el('span', { class: 'rb-meta' }, t('ag_no_recent')))); return; }
      arr.forEach(function (x) {
        var blocked = !!x.blocked;
        recUl.appendChild(el('li', { class: 'ag-rec' }, [
          el('div', { class: 'rb-main' }, [
            el('span', { class: 'rb-name ag-name' }, ltrText(x.domain)),
            el('span', { class: 'rb-meta ag-meta' }, [ltr(fmtClock(x.time)), ltr(x.client ? String(x.client) : '-')])
          ]),
          el('span', { class: 'chip ' + (blocked ? 'chip-bad' : 'chip-ok') }, t(blocked ? 'ag_blocked' : 'ag_allowed'))
        ]));
      });
    }

    var node = el('div', { class: 'ag-stack', 'data-testid': 'adguard-on' }, [
      head, notice, statsBox, nodata,
      el('section', null, [secTitle(t('ag_recent')), recUl])
    ]);

    function update(d) {
      var st = d.stats || {}, avail = !!st.available;
      notice.hidden = !!d.active;
      statsBox.hidden = !avail;
      nodata.hidden = avail;
      if (avail) {
        var qn = listNum(st.queries), bn = listNum(st.blocked);
        var pct = Number(st.blocked_pct);
        if (!isFinite(pct)) pct = qn > 0 ? bn / qn * 100 : 0;
        pct = Math.max(0, Math.min(100, pct));
        vQ.textContent = num(qn);
        vB.textContent = num(bn);
        uB.textContent = num(pct, 1) + '%';
        vA.textContent = num(listNum(st.avg_ms));
        drawChart(st.hourly);
        var len = pct / 100 * CIRC;
        dBlock.setAttribute('stroke-dasharray', len.toFixed(2) + ' ' + (CIRC - len).toFixed(2));
        dPct.textContent = num(pct, 1) + '%';
        dB.textContent = num(bn);
        dA.textContent = num(Math.max(0, qn - bn));
        topB.fill(st.top_blocked);
        topQ.fill(st.top_queried);
        topC.fill(st.top_clients);
      }
      fillRecent(d.recent);
    }
    return { mode: 'on', node: node, update: update };
  }

  function apply(d) {
    var mode = d.enabled ? 'on' : 'off';
    if (!G.ui || G.ui.mode !== mode) {
      G.ui = mode === 'on' ? buildOn() : buildOff();
      body.replaceChildren(G.ui.node);
    }
    G.ui.update(d);
  }
  function load() {
    G.ui = null;
    loadInto(body, c, fetchAg, apply);
  }
  function tick() {
    if (document.hidden || G.busy || !G.ui) return;
    fetchAg().then(function (d) { if (c.alive() && !G.busy) apply(d); }).catch(function () {});
  }
  function vis() { if (!document.hidden) tick(); }
  document.addEventListener('visibilitychange', vis);
  timer = setInterval(tick, 30000);
  c.cleanups.push(function () { clearInterval(timer); document.removeEventListener('visibilitychange', vis); });

  add(root, body);
  load();
}

/* ---------- Settings ---------- */

function viewSettings(root, c) {
  /* Protection */
  var ksBox = el('div');
  function paintKs(k) {
    var enabled = !!k.enabled;
    var mode = k.mode === 'strict' ? 'strict' : 'smart';
    var modeSel = el('select', { class: 'input', id: 'ks-mode', 'data-testid': 'killswitch-mode' }, [
      el('option', { value: 'smart', selected: mode === 'smart' }, t('ks_smart')),
      el('option', { value: 'strict', selected: mode === 'strict' }, t('ks_strict'))
    ]);
    var sw = el('button', { type: 'button', class: 'switch', role: 'switch', 'data-testid': 'killswitch-toggle', 'aria-checked': enabled ? 'true' : 'false', 'aria-labelledby': 'ks-lbl' }, el('span', { class: 'knob' }));
    async function save(en) {
      sw.disabled = true;
      modeSel.disabled = true;
      try {
        var r = await api('api-killswitch', { method: 'POST', body: { enabled: en, mode: modeSel.value } });
        if (!c.alive()) return;
        paintKs(r);
        toast(t('saved'), 'ok');
      } catch (e) {
        toast(errMsg(e), 'bad');
        if (c.alive()) { sw.disabled = false; modeSel.disabled = false; }
      }
    }
    sw.addEventListener('click', function () { save(!enabled); });
    modeSel.addEventListener('change', function () { save(enabled); });
    ksBox.replaceChildren(el('div', { class: 'surface list' }, [
      el('div', { class: 'srow' }, [
        el('div', { class: 'rb-main' }, [el('span', { class: 'rb-name', id: 'ks-lbl' }, t('ks_title')), el('span', { class: 'rb-meta' }, t(k.armed ? 'ks_armed' : enabled ? 'ks_idle' : 'ks_off'))]),
        sw
      ]),
      el('div', { class: 'srow col' }, [
        el('label', { class: 'fld', 'for': 'ks-mode' }, t('ks_mode')),
        modeSel,
        el('p', { class: 'help' }, t('ks_help'))
      ])
    ]));
  }
  function loadKs() { loadInto(ksBox, c, function () { return api('api-killswitch'); }, paintKs); }
  var agLink = el('div', { class: 'surface list ab-settings' }, el('a', { href: '#adguard', class: 'rowb', 'data-testid': 'settings-adguard' }, [
    icon('adguard'),
    el('span', { class: 'rb-main' }, [el('span', { class: 'rb-name' }, t('ab_link_t')), el('span', { class: 'rb-meta' }, t('ab_link_d'))]),
    el('span', { class: 'chev', 'aria-hidden': 'true' })
  ]));

  /* Wi-Fi */
  var wfBox = el('div');
  var wfNote = el('p', { class: 'note', role: 'status', hidden: true });
  var nets = [];
  function bandLabel(b) { return b === '2g' ? t('wf_24') : b === '5g' ? t('wf_5') : (b || ''); }
  function paintWifi() {
    wfBox.replaceChildren();
    if (!nets.length) { wfBox.appendChild(emptyEl(t('wf_empty'))); return; }
    wfBox.appendChild(el('ul', { class: 'surface list' }, nets.map(function (n) {
      var meta = [bandLabel(n.band), n.enabled === false ? t('wf_off') : null].filter(Boolean).join(' · ');
      return el('li', null, el('button', { type: 'button', class: 'rowb', 'data-testid': 'wifi-row', onclick: function () { wifiDialog(n); } }, [
        el('span', { class: 'rb-main' }, [el('span', { class: 'rb-name' }, bdi(n.ssid || n.id)), el('span', { class: 'rb-meta' }, meta)]),
        el('span', { class: 'chev', 'aria-hidden': 'true' })
      ]));
    })));
  }
  function loadWifi() { loadInto(wfBox, c, function () { return api('api-wifi'); }, function (d) { nets = d.networks || []; paintWifi(); }); }

  function wifiDialog(net) {
    var ssid = el('input', { type: 'text', class: 'input', id: 'wf-ssid', maxlength: '32', value: net.ssid || '', autocomplete: 'off', dir: 'auto', 'data-testid': 'wifi-ssid' });
    var key = el('input', { type: 'password', class: 'input', id: 'wf-key', maxlength: '63', autocomplete: 'new-password', spellcheck: 'false', dir: 'ltr', 'data-testid': 'wifi-key' });
    var allBox = el('input', { type: 'checkbox' });
    var fail = el('p', { class: 'err-text', role: 'alert', hidden: true });
    var cancel = el('button', { type: 'button', class: 'btn btn-secondary' }, t('cancel'));
    var save = el('button', { type: 'button', class: 'btn btn-primary', 'data-testid': 'wifi-save' }, t('save'));
    var others = nets.filter(function (o) { return o.id !== net.id; });
    var dlg = modal(t('wf_edit'), [
      el('div', { class: 'field' }, [el('label', { class: 'fld', 'for': 'wf-ssid' }, t('wf_name')), ssid]),
      el('div', { class: 'field' }, [el('label', { class: 'fld', 'for': 'wf-key' }, t('wf_key')), el('div', { class: 'inline-form' }, [key, showToggle([key])]), el('p', { class: 'help' }, t('wf_key_help'))]),
      others.length ? el('label', { class: 'check' }, [allBox, el('span', null, t('wf_all'))]) : null,
      fail,
      el('div', { class: 'dlg-actions' }, [cancel, save])
    ]);
    cancel.addEventListener('click', function () { dlg.close(); });
    save.addEventListener('click', dlgRun(save, fail, async function () {
      var s = ssid.value.trim(), k = key.value;
      if (!s || s.length > 32) throw { msg: t('err_bad_ssid') };
      if (k && (k.length < 8 || k.length > 63)) throw { msg: t('err_bad_key') };
      if (allBox.checked && !k) throw { msg: t('wf_all_need_key') };
      var ok = await confirmBox(t('wf_cf_t'), t('wf_cf_d'), t('save'), true);
      if (!ok) return;
      await api('api-wifi', { method: 'POST', body: { id: net.id, ssid: s, key: k }, timeout: 30000 });
      net.ssid = s;
      if (allBox.checked) {
        for (var i = 0; i < others.length; i++) {
          await api('api-wifi', { method: 'POST', body: { id: others[i].id, ssid: others[i].ssid, key: k }, timeout: 30000 });
        }
      }
      dlg.close();
      wfNote.textContent = t('wf_after');
      wfNote.hidden = false;
      if (c.alive()) paintWifi();
    }));
    ssid.focus();
  }

  /* Router */
  var rtBox = el('div');
  function passDialog() {
    var cur = pwField('pw-cur', t('pw_cur'), 'current-password', 'password-current');
    var nw = pwField('pw-new', t('pw_new'), 'new-password', 'password-new');
    var rep = pwField('pw-rep', t('pw_rep'), 'new-password', 'password-repeat');
    var fail = el('p', { class: 'err-text', role: 'alert', hidden: true });
    var cancel = el('button', { type: 'button', class: 'btn btn-secondary' }, t('cancel'));
    var save = el('button', { type: 'button', class: 'btn btn-primary', 'data-testid': 'password-save' }, t('save'));
    var dlg = modal(t('pw_title'), [
      el('p', { class: 'warn-text' }, t('pw_warn')),
      cur.node, nw.node, rep.node,
      el('div', { class: 'field' }, showToggle([cur.input, nw.input, rep.input])),
      fail,
      el('div', { class: 'dlg-actions' }, [cancel, save])
    ]);
    cancel.addEventListener('click', function () { dlg.close(); });
    save.addEventListener('click', dlgRun(save, fail, async function () {
      if (!cur.input.value) throw { msg: t('pw_need_cur') };
      if (nw.input.value.length < 8) throw { msg: t('err_bad_password') };
      if (nw.input.value !== rep.input.value) throw { msg: t('pw_mismatch') };
      await api('api-password', { method: 'POST', body: { current: cur.input.value, 'new': nw.input.value } });
      dlg.close();
      toast(t('pw_done'), 'ok');
    }));
    cur.input.focus();
  }
  function loadRouter() {
    loadInto(rtBox, c, function () { return api('api-status', { auth: false, timeout: 10000 }); }, function (s) {
      var sys = s.system || {}, memTxt = '-';
      if (sys.mem_total_kb > 0) memTxt = num(Math.round((sys.mem_total_kb - sys.mem_available_kb) / sys.mem_total_kb * 100)) + '%';
      function kv(k, v) { return el('div', { class: 'srow' }, [el('span', { class: 'rb-name' }, k), el('span', { class: 'kv-v' }, v)]); }
      rtBox.replaceChildren(el('div', { class: 'surface list' }, [
        kv(t('rt_mem'), memTxt),
        kv(t('rt_uptime'), fmtDur(sys.uptime_s || 0)),
        kv(t('rt_load'), num(parseFloat(sys.load1), 2)),
        kv(t('rt_adguard'), t(s.adguard && s.adguard.running ? 'rt_adg_on' : 'rt_adg_off')),
        el('button', { type: 'button', class: 'rowb', 'data-testid': 'password-row', onclick: passDialog }, [el('span', { class: 'rb-main' }, el('span', { class: 'rb-name' }, t('pw_title'))), el('span', { class: 'chev', 'aria-hidden': 'true' })])
      ]));
    });
  }

  var logoutBtn = mkBtn(t('logout'), 'secondary', 'logout', function () { logout(false); });
  logoutBtn.setAttribute('data-testid', 'logout');
  add(root, [
    viewTitle(t('nav_settings')),
    el('div', { class: 'stack' }, [
      el('section', null, [secTitle(t('st_protect')), ksBox, agLink]),
      el('section', null, [secTitle(t('st_wifi')), wfBox, wfNote]),
      el('section', null, [secTitle(t('st_router')), rtBox]),
      el('section', null, [secTitle(t('st_app')), el('div', { class: 'surface list' }, [
        el('div', { class: 'srow col' }, [el('span', { class: 'rb-name' }, t('st_theme')), themeSeg()]),
        installRow(),
        el('div', { class: 'srow' }, [el('span', { class: 'rb-name' }, t('st_lang')), langButton('secondary')]),
        el('div', { class: 'srow' }, [el('span', { class: 'rb-name' }, t('logout')), logoutBtn]),
        el('div', { class: 'srow' }, [el('span', { class: 'rb-name' }, t('st_version')), ltr('1.0')])
      ])])
    ])
  ]);
  loadKs();
  loadWifi();
  loadRouter();
}

/* ---------- Start ---------- */

applyTheme();
if (themeMq) {
  var onScheme = function () { if (theme === 'system') applyTheme(); };
  if (themeMq.addEventListener) themeMq.addEventListener('change', onScheme);
  else if (themeMq.addListener) themeMq.addListener(onScheme);
}
window.addEventListener('hashchange', route);
render();

})();
