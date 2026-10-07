import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, VITE_API_URL: '/api', VITE_DRIVER_MOBILE_URL: '/driver/login',
  VITE_REALTIME_MODE: 'poll', VITE_SIMULATION_ENABLED: 'false' };
if (process.env.VERCEL) env.VITE_DEMO_MODE ||= 'false';
for (const app of ['web', 'mobile']) {
  const result = spawnSync(process.execPath, [path.join(root,'node_modules/vite/bin/vite.js'),'build'],
    { cwd: path.join(root,'apps',app), env, stdio:'inherit' });
  if(result.status !== 0) process.exit(result.status || 1);
}
// Only remove the fixed, generated dist directory inside this workspace.
const output = path.join(root,'dist');
fs.rmSync(output,{recursive:true,force:true});
fs.cpSync(path.join(root,'apps/web/dist'),output,{recursive:true});
fs.cpSync(path.join(root,'apps/mobile/dist'),path.join(output,'driver'),{recursive:true});
console.log('Combined deployment ready: dist/ (portal), dist/driver/ (driver app).');
