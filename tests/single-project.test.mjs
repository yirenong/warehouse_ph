import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Vercel imports one root package with one Vite entry and a shared SPA fallback',()=>{
  const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
  assert.equal(pkg.workspaces,undefined);
  for(const path of ['apps/web/package.json','apps/mobile/package.json','server/package.json'])assert.equal(fs.existsSync(path),false);
  const config=JSON.parse(fs.readFileSync('vercel.json','utf8'));
  assert.equal(config.framework,'vite');
  assert.equal(config.outputDirectory,'dist');
  assert.equal(config.services,undefined);assert.equal(config.experimentalServices,undefined);
  assert.equal(config.rewrites.at(-1).destination,'/index.html');
  assert.match(fs.readFileSync('src/main.js','utf8'),/import\('\.\/driver\/main.js'\)/);
  assert.match(fs.readFileSync('src/main.js','utf8'),/import\('\.\/portal\/main.js'\)/);
  assert.equal(fs.existsSync('dist/driver/index.html'),false);
});
