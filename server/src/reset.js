import { buildSeed } from './seed.js';
import { saveDb } from './store.js';
saveDb(await buildSeed());
console.log('Demo data reset.');
