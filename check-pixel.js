import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve4 } from 'node:dns/promises';
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';

const KNOWN_EVENTS = new Set([
  'PageView', 'ViewContent', 'AddToCart', 'AddToWishlist',
  'InitiateCheckout', 'AddPaymentInfo', 'Purchase', 'Lead',
  'CompleteRegistration', 'Search', 'Contact', 'Donate',
  'FindLocation', 'Schedule', 'StartTrial', 'SubmitApplication',
  'Subscribe',
]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITES_FILE = join(__dirname, 'sites.txt');
const LOG_DIR = join(__dirname, 'logs');
let TIMEOUT_MS = 15_000;

function detectPixel(html) {
  const patterns = [
    { name: 'fbq init', re: /fbq\s*\(\s*['"]init['"]\s*,/i },
    { name: 'connect.facebook.net', re: /connect\.facebook\.net/i },
    { name: 'facebook.com/tr', re: /facebook\.com\/tr/i },
    { name: 'fbq call', re: /fbq\s*\(/i },
  ];

  const presence = patterns.map((p) => ({
    pattern: p.name,
    found: p.re.test(html),
    matchCount: (html.match(p.re) || []).length,
  }));

  const present = presence.some((r) => r.found);

  // --- Pixel ID extraction ---
  const idMatch = html.match(/fbq\s*\(\s*['"]init['"]\s*,\s*['"]([^'"]+)['"]/i);
  const pixelId = idMatch && /^\d{13,20}$/.test(idMatch[1]) ? idMatch[1] : null;

  // --- Multiple / duplicate pixel IDs ---
  const allIds = [...html.matchAll(/fbq\s*\(\s*['"]init['"]\s*,\s*['"]([^'"]+)['"]/ig)];
  const uniqueIds = [...new Set(allIds.map((m) => m[1]))];
  const duplicate = uniqueIds.some((id) => allIds.filter((m) => m[1] === id).length > 1);
  const multiplePixelIds = uniqueIds.length > 1;

  // --- Pixel position in HTML ---
  const initIndex = html.search(/fbq\s*\(\s*['"]init['"]\s*,/i);
  const headCloseIndex = html.search(/<\/head>/i);
  const inHead = initIndex !== -1 && headCloseIndex !== -1 && initIndex < headCloseIndex;

  // --- Events (PageView, Purchase, Lead, AddToCart, etc.) ---
  const eventMatches = [...html.matchAll(/fbq\s*\(\s*['"](?:track|trackSingle)['"]\s*,\s*['"]([^'"]+)['"]/ig)];
  const events = [...new Set(eventMatches.map((m) => m[1]).filter((e) => KNOWN_EVENTS.has(e) || !/^\d+$/.test(e)))];

  // --- Event parameters (content_name, value, currency, etc.) ---
  const eventDetails = {};
  const paramBlocks = [...html.matchAll(/fbq\s*\(\s*['"](track|trackSingle)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*(\{[^}]+\})\s*\)/ig)];
  for (const m of paramBlocks) {
    const [, callType, evName, raw] = m;
    if (!KNOWN_EVENTS.has(evName)) continue;
    try {
      const cleaned = raw.replace(/'/g, '"').replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
      eventDetails[evName] = JSON.parse(cleaned);
    } catch { /* skip parse errors */ }
  }

  // --- GTM detection ---
  const viaGTM = /googletagmanager\.com/i.test(html);
  const dynamicLoader = viaGTM
    || /tealiumiq\.com/i.test(html)
    || /assets\.adobedtm\.com/i.test(html)
    || /cdn\.ampproject\.org/i.test(html);

  // --- Conversions API (CAPI) references ---
  const hasCAPI = /graph\.facebook\.com/i.test(html);

  // --- Advanced Matching params ---
  const initBlock = html.match(/fbq\s*\(\s*['"]init['"]\s*,\s*['"][^'"]+['"]\s*,\s*(\{[\s\S]*?\})/i);
  let advancedMatching = false;
  if (initBlock) {
    try {
      const paramsStr = initBlock[1]
        .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?\s*:/g, '"$2":')
        .replace(/'/g, '"');
      const params = JSON.parse(paramsStr);
      const amKeys = ['em', 'ph', 'fn', 'ln', 'ct', 'st', 'zp', 'country', 'ct', 'db', 'ge'];
      advancedMatching = amKeys.some((k) => k in params);
    } catch { /* skip parse errors */ }
  }

  // --- HTTPS check ---
  const pixelUrls = [...html.matchAll(/https?:\/\/connect\.facebook\.net[^"'\s]*/g)];
  const usesHTTPS = pixelUrls.length === 0 ? null : pixelUrls.every((u) => u[0].startsWith('https://'));

  const warnings = [];
  if (present) {
    if (duplicate) warnings.push('Pixel ID duplicato');
    if (multiplePixelIds) warnings.push(`ID pixel multipli: ${uniqueIds.join(', ')}`);
    if (!inHead) warnings.push('Pixel dopo </head>');
    if (usesHTTPS === false) warnings.push('HTTP invece di HTTPS');
  }

  return {
    present,
    pixelId,
    pixelIds: uniqueIds,
    duplicate,
    multiplePixelIds,
    inHead,
    viaGTM,
    dynamicLoader,
    hasCAPI,
    advancedMatching,
    usesHTTPS,
    events,
    eventDetails: Object.keys(eventDetails).length > 0 ? eventDetails : null,
    warnings,
    details: presence,
  };
}

function formatSite(url) {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '');
}

function getChromePath() {
  try {
    const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe', '/ve'], { encoding: 'utf-8', timeout: 5000 });
    const match = out.match(/REG_SZ\s+(.+)/);
    if (match) return match[1].trim();
  } catch { /* fallback */ }
  return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
}

async function checkSiteBrowser(rawUrl, browser) {
  try {
    const page = await browser.newPage();

    // Intercept fbq calls before page loads
    await page.evaluateOnNewDocument(() => {
      window.__fbqCalls = [];
      const orig = window.fbq;
      window.fbq = function () {
        window.__fbqCalls.push(Array.from(arguments));
        if (typeof orig === 'function') orig.apply(window, arguments);
      };
      // Also intercept if fbq already exists as a queue
      if (window.fbq && window.fbq.queue && Array.isArray(window.fbq.queue)) {
        const q = window.fbq.queue;
        window.__fbqCalls.push(...q.map((a) => [].concat(a)));
        const origPush = q.push.bind(q);
        q.push = (...args) => {
          window.__fbqCalls.push(args[0]);
          return origPush(...args);
        };
      }
    });

    // Capture pixel-related network requests
    const pixelIds = new Set();
    const events = new Set();
    let hasFbq = false;
    let gtmDetected = false;

    page.on('request', (req) => {
      const u = req.url();
      if (u.includes('googletagmanager.com')) gtmDetected = true;

      // Pixel config URL: /signals/config/{ID}
      const configMatch = u.match(/\/signals\/config\/(\d+)/);
      if (configMatch) {
        pixelIds.add(configMatch[1]);
        hasFbq = true;
      }

      // Pixel event URL: facebook.com/tr with id= and ev= parameters
      if (u.includes('facebook.com/tr')) {
        hasFbq = true;
        const idMatch = u.match(/[?&]id=(\d+)/);
        if (idMatch) pixelIds.add(idMatch[1]);
        const evMatch = u.match(/[?&]ev=([^&]+)/);
        const ev = decodeURIComponent(evMatch[1]);
        if (KNOWN_EVENTS.has(ev) || !/^\d+$/.test(ev)) events.add(ev);
      }

      // fbevents.js loading
      if (u.includes('connect.facebook.net') && u.includes('fbevents')) hasFbq = true;

      // Error log with pixel ID
      const errMatch = u.match(/pixel_id%3A\s*(\d+)/i);
      if (errMatch) pixelIds.add(errMatch[1]);
    });

    await page.goto(rawUrl, { waitUntil: 'networkidle0', timeout: TIMEOUT_MS }).catch(() => {});
    // Wait for fbq to fire (up to 3s max), proceed as soon as it does
    await Promise.race([
      page.waitForFunction(() => window.__fbqCalls?.length > 0, { timeout: 3000 }),
      new Promise((r) => setTimeout(r, 3000)),
    ]).catch(() => {});

    // Extract intercepted fbq calls
    const fbqCalls = await page.evaluate(() => {
      const calls = window.__fbqCalls || [];
      let pixelId = null;
      const evts = [];
      const evtParams = {};
      for (const c of calls) {
        if (c[0] === 'init' && c[1]) pixelId = c[1];
        if (c[0] === 'track' && c[1]) {
          evts.push(c[1]);
          if (c[2] && typeof c[2] === 'object') evtParams[c[1]] = c[2];
        }
        if (c[0] === 'trackSingle' && c[2]) {
          evts.push(c[2]);
          if (c[3] && typeof c[3] === 'object') evtParams[c[2]] = c[3];
        }
      }
      return { pixelId, events: evts, callCount: calls.length, eventDetails: Object.keys(evtParams).length > 0 ? evtParams : null };
    }).catch(() => ({ pixelId: null, events: [], callCount: 0, eventDetails: null }));

    if (fbqCalls.pixelId) pixelIds.add(fbqCalls.pixelId);
    fbqCalls.events.forEach((e) => events.add(e));

    // Also check page context for fbq presence
    const pageInfo = await page.evaluate(() => {
      const r = { hasFbq: false, pixelId: null, events: [] };
      if (typeof fbq !== 'undefined') r.hasFbq = true;
      const scripts = document.querySelectorAll('script[src*="connect.facebook.net"]');
      if (scripts.length > 0) r.hasFbq = true;
      return r;
    }).catch(() => ({ hasFbq: false, pixelId: null, events: [] }));

    hasFbq = hasFbq || pageInfo.hasFbq || fbqCalls.callCount > 0;

    const ids = [...pixelIds];
    return {
      present: hasFbq && ids.length > 0,
      pixelId: ids[0] || null,
      pixelIds: ids,
      events: [...events],
      eventDetails: fbqCalls.eventDetails || null,
      viaGTM: gtmDetected,
      warnings: [],
      browserChecked: true,
    };
  } catch (err) {
    return { present: false, pixelId: null, pixelIds: [], events: [], eventDetails: null, viaGTM: false, warnings: [], error: err.message, browserChecked: true };
  }
}

async function checkSite(rawUrl) {
  // --- URL validation ---
  let parsed;
  try {
    parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol))
      return { url: rawUrl, status: 0, reachable: false, present: false, error: 'URL non valida: protocollo mancante o non supportato', warnings: [] };
  } catch {
    return { url: rawUrl, status: 0, reachable: false, present: false, error: 'URL non valida: formato errato', warnings: [] };
  }

  // --- DNS check ---
  try {
    await resolve4(parsed.hostname);
  } catch {
    return { url: rawUrl, status: 0, reachable: false, present: false, error: `Dominio irraggiungibile: ${parsed.hostname}`, warnings: [] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(rawUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MetaPixelChecker/1.0)' },
      redirect: 'follow',
    });
    const html = await res.text();
    const pixel = detectPixel(html);

    const base = {
      url: rawUrl, status: res.status, reachable: res.status < 400,
      ...pixel,
      note: null,
    };

    return base;
  } catch (err) {
    return {
      url: rawUrl, status: 0, reachable: false, present: false,
      error: err.message || 'Errore sconosciuto', warnings: [],
    };
  } finally {
    clearTimeout(timer);
  }
}

async function loadSites(sitesFile) {
  const raw = readFileSync(sitesFile || SITES_FILE, 'utf-8');
  return raw
    .split('\n')
    .map((l) => l.trim().replace(/['"]/g, ''))
    .filter((l) => l && !l.startsWith('#'));
}

function logReport(results, reportText, logDir) {
  const dir = logDir || LOG_DIR;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toISOString().slice(11, 19);

  // JSON (raw data)
  const jsonFile = join(dir, `${dateStr}.json`);
  const entry = { timestamp: now.toISOString(), results };
  let log = [];
  if (existsSync(jsonFile)) {
    try { log = JSON.parse(readFileSync(jsonFile, 'utf-8')); } catch { /* skip */ }
  }
  log.push(entry);
  writeFileSync(jsonFile, JSON.stringify(log, null, 2) + '\n');

  // TXT (human readable)
  const txtFile = join(dir, `${dateStr}.txt`);
  appendFileSync(txtFile, reportText + '\n');

  return { dateStr, timeStr };
}

function printReport(results, { dateStr, timeStr }) {
  const ok = results.filter((r) => r.present);
  const ko = results.filter((r) => !r.present);
  const l = [];
  const ln = (s = '') => l.push(s);

  ln(`\n━━━ Meta Pixel Check ─ ${dateStr} ${timeStr} ━━━`);
  ln(`Totale: ${results.length} siti`);

  if (ok.length) {
    ln(`\n✅ PIXEL TROVATO (${ok.length}):`);
    for (const r of ok) {
      const id = r.pixelId ? ` [ID: ${r.pixelId}]` : '';
      const ev = r.events?.length ? ` eventi: ${r.events.join(', ')}` : '';
      const warn = r.warnings?.length ? ` ⚠️ ${r.warnings.join(', ')}` : '';
      ln(`   ${formatSite(r.url)}${id}${ev}${warn}`);
    }
  }

  if (ko.length) {
    ln(`\n❌ PIXEL NON TROVATO (${ko.length}):`);
    for (const r of ko) {
      if (r.error) {
        ln(`   ${formatSite(r.url)}  ⚠️ ERRORE: ${r.error}`);
      } else if (r.note) {
        ln(`   ${formatSite(r.url)}  ⚠️ ${r.note}`);
      } else {
        ln(`   ${formatSite(r.url)}  Non installato`);
      }
    }
  }

  const withPixel = results.filter((r) => r.present);
  if (withPixel.length) {
    ln(`\n📋 DETTAGLI PIXEL:`);
    for (const r of withPixel) {
      const name = formatSite(r.url);
      const info = [];
      info.push(`ID: ${r.pixelId || '?'}`);
      info.push(`HTTP ${r.status}`);
      if (r.events?.length) info.push(`eventi: ${r.events.join(', ')}`);
      if (r.viaGTM) info.push('via GTM');
      if (r.advancedMatching) info.push('Advanced Matching');
      if (r.hasCAPI) info.push('CAPI');
      if (r.browserChecked) info.push('🔍 browser');
      info.push(r.inHead ? '<head>' : '<body>');
      if (r.warnings?.length) info.push(`⚠️ ${r.warnings.join(', ')}`);
      ln(`   ${name}`);
      ln(`     ${info.join(' | ')}`);
    }
  }

  const line = '─'.repeat(50);
  const reportDir = new URL('.', import.meta.url).pathname;
  ln(`\n${line}\nReport salvato in logs/${dateStr}.json e ${dateStr}.txt\n`);

  const text = l.join('\n');
  console.log(text);
  return text;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = { sitesFile: SITES_FILE, logDir: LOG_DIR };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--sites': flags.sitesFile = join(__dirname, args[++i] || ''); break;
      case '--timeout': TIMEOUT_MS = parseInt(args[++i]) || TIMEOUT_MS; break;
      case '--output': flags.logDir = args[++i] || flags.logDir; break;
      case '--help':
        console.log(`Usage: node check-pixel.js [options]

  --sites <file>    Lista siti (default: sites.txt)
  --timeout <ms>    Timeout fetch per sito (default: 15000)
  --output <dir>    Cartella report (default: logs/)
  --help            Mostra questo aiuto`);
        process.exit(0);
    }
  }
  return flags;
}

async function main() {
  const flags = parseArgs();
  const sites = await loadSites(flags.sitesFile);
  if (sites.length === 0) {
    console.log('Nessun sito da controllare. Aggiungi URL in sites.txt');
    return;
  }

  console.log(`Controllo ${sites.length} siti...`);

  // Phase 1: static check (parallel, fast)
  const results = await Promise.all(sites.map(checkSite));

  // Phase 2: browser check for sites with dynamic loaders (sequential, shared browser)
  const needBrowser = results.filter(
    (r) => !r.present && r.dynamicLoader && r.status < 400 && r.status > 0,
  );

  if (needBrowser.length > 0) {
    console.log(`\n🔍 Check browser per ${needBrowser.length} siti (GTM o altri loader dinamici)...`);
    let browser;
    try {
      browser = await puppeteer.launch({
        executablePath: getChromePath(),
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });

      for (const r of needBrowser) {
        process.stdout.write(`   ${formatSite(r.url)}...`);
        const b = await checkSiteBrowser(r.url, browser);
        Object.assign(r, b, { viaGTM: true });
        r.note = b.present
          ? `Rilevato via browser: Pixel ID ${b.pixelId || '?'}`
          : b.error
            ? `Browser check fallito: ${b.error}`
            : 'Caricamento dinamico confermato ma pixel non rilevato';
        console.log(b.present ? ' ✅' : ' ❌');
      }
    } finally {
      if (browser) await browser.close();
    }
  }

  // Set final notes for remaining sites
  for (const r of results) {
    if (!r.present && !r.note) {
      r.note = r.status >= 400
        ? `HTTP ${r.status} — risposta non valida, pixel non verificabile`
        : null;
    }
  }

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toISOString().slice(11, 19);
  const reportText = printReport(results, { dateStr, timeStr });
  logReport(results, reportText, flags.logDir);
}

main();
