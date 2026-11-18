// Normalize preview-runner flags to Next.js flags; npm run dev still works normally.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const incoming = process.argv.slice(2);
const args = incoming.filter((value) => value !== '--strictPort').map((value) => value === '--host' ? '--hostname' : value);
if (!args.includes('--hostname')) args.push('--hostname', '0.0.0.0');
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', ...args], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => process.exit(code || 0));
