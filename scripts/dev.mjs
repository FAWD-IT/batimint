#!/usr/bin/env node
// pnpm dev : démarre Postgres, MinIO et Mailpit (docker compose), applique les migrations,
// puis lance api, worker et web en mode développement.
import { spawnSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts });
  if (r.status !== 0) {
    console.error(`\n✗ Échec : ${cmd} ${args.join(' ')}`);
    process.exit(r.status ?? 1);
  }
};

if (!existsSync('.env')) {
  copyFileSync('.env.example', '.env');
  console.info('.env créé à partir de .env.example');
}
if (process.env.SKIP_SERVICES !== '1') {
  console.info('▶ Services (Postgres, MinIO, Mailpit)…');
  run('docker', ['compose', '-f', 'docker-compose.dev.yml', 'up', '-d', '--wait']);
}
console.info('▶ Migrations…');
run('pnpm', ['db:migrate']);
console.info('▶ Applications : web http://localhost:3000 · api http://localhost:4000/docs · e-mails http://localhost:8025');
const child = spawn('pnpm', ['dev:apps'], { stdio: 'inherit' });
const stop = (sig) => child.kill(sig);
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));
