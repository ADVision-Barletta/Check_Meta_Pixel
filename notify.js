import { createTransport } from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587');
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

function buildHtml(results, dateStr, timeStr) {
  const ok = results.filter((r) => r.present);
  const ko = results.filter((r) => !r.present);
  const rows = (items, icon) => items.map((r) => {
    const name = r.url.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    const id = r.pixelId || '-';
    const ev = (r.events || []).join(', ') || '-';
    const note = r.note || (r.warnings || []).join(', ') || '';
    return `<tr><td>${icon}</td><td>${name}</td><td>${id}</td><td>${ev}</td><td>${note}</td></tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2937;max-width:700px;margin:2rem auto;padding:0 1rem}
h1{font-size:1.3rem;margin-bottom:.5rem}
.summary{display:flex;gap:1rem;margin:1rem 0}
.summary div{background:#f3f4f6;padding:.75rem 1rem;border-radius:8px;flex:1}
.num{font-size:1.6rem;font-weight:700;color:#1e3a5f}
table{width:100%;border-collapse:collapse;font-size:.9rem;margin:1rem 0}
th,td{text-align:left;padding:.5rem;border-bottom:1px solid #e5e7eb}
th{background:#f9fafb;color:#6b7280;font-weight:600}
.ok{border-left:3px solid #22c55e}
.ko{border-left:3px solid #ef4444}
.footer{color:#9ca3af;font-size:.8rem;margin-top:2rem}
</style></head><body>
<h1>📊 Meta Pixel Check — ${dateStr} ${timeStr}</h1>
<div class="summary">
  <div><span class="num">${results.length}</span> Totale</div>
  <div><span class="num">${ok.length}</span> ✅ Pixel trovato</div>
  <div><span class="num">${ko.length}</span> ❌ Non trovato</div>
</div>
${ok.length ? `<h2>✅ Pixel trovato (${ok.length})</h2><table><tr><th></th><th>Sito</th><th>ID</th><th>Eventi</th><th>Note</th></tr>${rows(ok, '✅')}</table>` : ''}
${ko.length ? `<h2>❌ Pixel non trovato (${ko.length})</h2><table><tr><th></th><th>Sito</th><th>ID</th><th>Eventi</th><th>Note</th></tr>${rows(ko, '❌')}</table>` : ''}
<p class="footer">Report generato automaticamente da Meta Pixel Check</p>
</body></html>`;
}

function buildText(results, dateStr, timeStr) {
  const ok = results.filter((r) => r.present);
  const ko = results.filter((r) => !r.present);
  const lines = [`Meta Pixel Check — ${dateStr} ${timeStr}`, `=${'='.repeat(50)}`];
  lines.push(`Totale: ${results.length} siti`);
  lines.push(`✅ Pixel trovato: ${ok.length}`);
  lines.push(`❌ Non trovato: ${ko.length}\n`);
  if (ok.length) {
    lines.push('✅ PIXEL TROVATO:');
    for (const r of ok) {
      lines.push(`  ${r.url}  [ID: ${r.pixelId || '?'}]  eventi: ${(r.events || []).join(', ') || '-'}`);
    }
    lines.push('');
  }
  if (ko.length) {
    lines.push('❌ PIXEL NON TROVATO:');
    for (const r of ko) {
      lines.push(`  ${r.url}  ${r.note || (r.error ? `ERRORE: ${r.error}` : 'Non installato')}`);
    }
  }
  return lines.join('\n');
}

export async function sendEmailReport(results, dateStr, timeStr) {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP non configurato (servono SMTP_HOST, SMTP_USER, SMTP_PASS)');
  }
  let to = process.env.EMAIL_TO || '';
  if (!to) throw new Error('EMAIL_TO non impostato');
  to = to.split(';').map(s => s.trim()).filter(Boolean).join(',');

  const transporter = createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { rejectUnauthorized: false },
  });

  const ok = results.filter((r) => r.present).length;
  const ko = results.filter((r) => !r.present).length;

  await transporter.sendMail({
    from: `"Meta Pixel Check" <${SMTP_FROM}>`,
    to,
    subject: `📊 Meta Pixel — ${ok}✅ ${ko}❌ (${dateStr})`,
    text: buildText(results, dateStr, timeStr),
    html: buildHtml(results, dateStr, timeStr),
  });
}
