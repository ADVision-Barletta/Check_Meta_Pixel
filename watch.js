import { watch } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const IGNORE = new Set(['node_modules', 'logs', '.git', 'package-lock.json']);
const DEBOUNCE = 2000;
let timer = null;

watch(DIR, { recursive: true }, (event, file) => {
  if (!file || file.split(/[\\/]/).some(p => IGNORE.has(p))) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    console.log(`[auto] ${event}: ${file}`);
    try {
      execSync('git add -A', { cwd: DIR, stdio: 'pipe' });
      const changed = execSync('git diff --name-only --cached', { cwd: DIR, encoding: 'utf-8' })
        .trim().split('\n').filter(Boolean).join(', ');
      const msg = changed ? `auto: ${changed}` : 'auto: update';
      execSync(`git commit -m "${msg}" --no-verify`, { cwd: DIR, stdio: 'pipe' });
      execSync('git push', { cwd: DIR, stdio: 'pipe' });
      console.log(`[auto] ✅ Pushato su GitHub (${changed || 'nessuna modifica'})`);
    } catch (e) {
      const msg = e.stderr?.toString() || e.message || '';
      if (!msg.includes('nothing to commit') && !msg.includes('Everything up-to-date')) {
        console.log(`[auto] ⚠️ ${msg.slice(0, 200)}`);
      }
    }
  }, DEBOUNCE);
});

console.log('[auto] 👀 Monitoraggio modifiche...');
