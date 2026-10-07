import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, VITE_API_URL: '/api', VITE_DRIVER_MOBILE_URL: '/driver/login',
  VITE_REALTIME_MODE: 'poll', VITE_SIMULATION_ENABLED: 'false' };
// This project is a demo by default, including hosted previews. Production
// deployments can explicitly set VITE_DEMO_MODE=false to hide sample accounts.
env.VITE_DEMO_MODE ??= 'true';
const result = spawnSync(process.execPath, [path.join(root,'node_modules/vite/bin/vite.js'),'build'],
  { cwd: root, env, stdio:'inherit' });
if(result.status !== 0) process.exit(result.status || 1);
console.log('Single application ready: dist/ serves both the portal and /driver.');
