import { readFileSync, readdirSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import express from 'express';
import basicAuth from 'basic-auth';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, 'logs');

// --- Auth ---
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin';

function auth(req, res, next) {
  const creds = basicAuth(req);
  if (!creds || creds.name !== ADMIN_USER || creds.pass !== ADMIN_PASS) {
    res.set('WWW-Authenticate', 'Basic realm="Meta Pixel Check"');
    return res.status(401).send('Accesso negato');
  }
  next();
}

// --- Helpers ---
function readJsonlLogs() {
  if (!existsSync(LOG_DIR)) return [];
  const files = readdirSync(LOG_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .reverse()
    .slice(0, 30);
  const entries = [];
  for (const f of files) {
    const content = readFileSync(join(LOG_DIR, f), 'utf-8');
    for (const line of content.trim().split('\n').filter(Boolean)) {
      try { entries.push(JSON.parse(line)); } catch {}
    }
  }
  return entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
}

// --- Express ---
const app = express();
app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'server', 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(join(__dirname, 'server', 'public')));

// --- Routes ---
app.get('/', auth, (req, res) => {
  const logs = readJsonlLogs();
  const lastScan = logs[0] || null;
  const totalToday = logs.filter((l) => l.timestamp?.startsWith(new Date().toISOString().slice(0, 10))).length;
  const lastSites = logs.slice(0, 5).flatMap((l) => l.results || []).filter(Boolean);
  const present = lastSites.filter((r) => r.present).length;
  const absent = lastSites.filter((r) => !r.present).length;

  res.render('dashboard', {
    user: ADMIN_USER,
    lastScan: lastScan ? formatTime(lastScan.timestamp) : 'Mai',
    totalToday,
    present,
    absent,
    totalSites: lastSites.length,
    lastResults: lastSites.slice(0, 20),
    logs: logs.slice(0, 10).map((l) => ({
      time: formatTime(l.timestamp),
      sites: (l.results || []).length,
      found: (l.results || []).filter((r) => r.present).length,
      notFound: (l.results || []).filter((r) => !r.present).length,
    })),
  });
});

app.get('/history', auth, (req, res) => {
  const logs = readJsonlLogs();
  const scan = req.query.scan ? logs[parseInt(req.query.scan)] || null : (logs[0] || null);
  const scanIndex = logs.indexOf(scan);

  res.render('history', {
    user: ADMIN_USER,
    logs: logs.slice(0, 50).map((l, i) => ({
      index: i,
      time: formatTime(l.timestamp),
      count: (l.results || []).length,
      found: (l.results || []).filter((r) => r.present).length,
    })),
    scan: scan
      ? {
          time: formatTime(scan.timestamp),
          results: (scan.results || []).map((r) => ({
            url: r.url,
            present: r.present,
            pixelId: r.pixelId,
            events: r.events || [],
            note: r.note || (r.error ? `ERRORE: ${r.error}` : r.present ? '' : 'Non installato'),
            warnings: r.warnings || [],
          })),
        }
      : null,
    scanIndex,
  });
});

app.post('/scan', auth, async (req, res) => {
  res.redirect('/scanning');
  const child = fork(join(__dirname, 'check-pixel.js'), ['--timeout', '10000'], {
    stdio: 'pipe',
    env: { ...process.env },
  });
  child.stdout?.on('data', (d) => process.stdout.write(`[scan] ${d}`));
  child.stderr?.on('data', (d) => process.stderr.write(`[scan-err] ${d}`));
  child.on('exit', (code) => {
    process.stdout.write(`[scan] Completato con codice ${code}\n`);
  });
});

app.get('/scanning', auth, (req, res) => {
  const lastLog = readJsonlLogs()[0] || null;
  res.render('scanning', {
    user: ADMIN_USER,
    lastTime: lastLog ? formatTime(lastLog.timestamp) : null,
    lastResults: (lastLog?.results || []).slice(0, 20),
  });
});

const PORT = parseInt(process.env.PORT || '3000');
app.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT} (user: ${ADMIN_USER})`);
});
