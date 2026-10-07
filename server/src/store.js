import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudContext, cloudEnabled } from './cloud-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const dataPath = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.resolve(__dirname, '../data/db.json');

export function loadDb() {
  const state = cloudContext.getStore();
  if (state) return structuredClone(state.db);
  if (cloudEnabled) throw new Error('Use the cloud initialization script outside HTTP requests');
  return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
}

export function saveDb(db) {
  const state = cloudContext.getStore();
  if (state) { state.db = structuredClone(db); state.dirty = true; return; }
  if (cloudEnabled) throw new Error('Use the cloud initialization script outside HTTP requests');
  fs.mkdirSync(path.dirname(dataPath),{recursive:true});
  const tmp=`${dataPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2),{mode:0o600});
  fs.renameSync(tmp,dataPath);
}

export function id(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}
