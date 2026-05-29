import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG = join(__dirname, 'config.json');

try {
  const cfg = JSON.parse(readFileSync(CONFIG, 'utf-8'));
  const now = new Date();
  const itTime = now.toLocaleString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false });
  const itDay = now.toLocaleString('en-US', { timeZone: 'Europe/Rome', weekday: 'short' });

  if (!cfg.days?.includes(itDay)) {
    console.log(`[scheduler] ${itDay} non in lista, skip`);
    process.exit(78);
  }

  if (cfg.time !== itTime) {
    console.log(`[scheduler] Sono le ${itTime}, attesa ${cfg.time}, skip`);
    process.exit(78);
  }

  console.log(`[scheduler] ✅ ${itDay} ${itTime} — esecuzione`);
  process.exit(0);
} catch (err) {
  console.error(`[scheduler] Errore: ${err.message}`);
  process.exit(1);
}
