import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import { Pool } from 'pg';

export const cloudContext = new AsyncLocalStorage();
export const cloudEnabled = Boolean(process.env.DATABASE_URL);
let pool;
export function databasePool() {
  return pool ||= new Pool({ connectionString: process.env.DATABASE_URL, max: 3,
    connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000 });
}

export async function createSchema(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS flowdepot_state (
    id integer PRIMARY KEY CHECK (id = 1), data jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS flowdepot_files (
    name text PRIMARY KEY, content bytea NOT NULL,
    content_type text NOT NULL DEFAULT 'application/octet-stream'
  )`);
}

function referencedFiles(value, names = new Set()) {
  if (typeof value === 'string' && /^\/uploads\/[a-zA-Z0-9_.-]+$/.test(value)) names.add(value.slice(9));
  else if (Array.isArray(value)) value.forEach(x => referencedFiles(x, names));
  else if (value && typeof value === 'object') Object.values(value).forEach(x => referencedFiles(x, names));
  return names;
}

// Existing handlers use synchronous loadDb/saveDb. A request owns one locked
// PostgreSQL snapshot; its response is released only after the transaction commits.
export function persistentRequests(getPool = databasePool) {
  return async (req, res, next) => {
    let client, ending = false;
    const end = res.end.bind(res), write = res.write.bind(res);
    const chunks = [];
    try {
      client = await getPool().connect();
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '20000'");
      const result = await client.query('SELECT data FROM flowdepot_state WHERE id = 1 FOR UPDATE');
      if (!result.rows.length) throw new Error('Cloud database is not initialized');
      const state = { db: result.rows[0].data, dirty: false, files: new Map(), newFiles: new Map() };
      // JSON endpoints need only record metadata. Fetch image bytes when a
      // document or an attachment is requested, rather than on every poll.
      const names = req.path.startsWith('/api/documents/') || req.query?.format === 'pdf'
        ? referencedFiles(state.db) : new Set();
      if (req.path.startsWith('/uploads/')) names.add(req.path.slice(9));
      if (names.size) {
        const files = await client.query('SELECT name, content, content_type FROM flowdepot_files WHERE name = ANY($1::text[])', [[...names]]);
        files.rows.forEach(f => state.files.set(f.name, { buffer: f.content, type: f.content_type }));
      }
      res.write = (chunk, encoding, callback) => {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined));
        if (typeof encoding === 'function') encoding(); else callback?.();
        return true;
      };
      res.end = (chunk, encoding, callback) => {
        if (ending) return res;
        ending = true;
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined));
        (async () => {
          try {
            if (res.statusCode >= 400) await client.query('ROLLBACK');
            else {
              for (const [name, file] of state.newFiles) {
                await client.query('INSERT INTO flowdepot_files(name, content, content_type) VALUES ($1,$2,$3)', [name, file.buffer, file.type]);
              }
              if (state.dirty) await client.query('UPDATE flowdepot_state SET data=$1, updated_at=now() WHERE id=1', [JSON.stringify(state.db)]);
              await client.query('COMMIT');
            }
            if (!res.destroyed) { for (const part of chunks) write(part); end(undefined, undefined, typeof encoding === 'function' ? encoding : callback); }
          } catch {
            await client.query('ROLLBACK').catch(() => {});
            if (!res.headersSent && !res.destroyed) {
              res.statusCode = 503; res.removeHeader('Content-Length'); res.removeHeader('Content-Disposition');
              res.setHeader('Content-Type', 'application/json'); end(JSON.stringify({error:'Unable to save changes. Please try again.'}));
            } else res.destroy();
          } finally { client.release(); }
        })();
        return res;
      };
      res.once('close', () => {
        if (!ending) { ending = true; client.query('ROLLBACK').catch(() => {}).finally(() => client.release()); }
      });
      cloudContext.run(state, next);
    } catch (error) {
      if (client) { await client.query('ROLLBACK').catch(() => {}); client.release(); }
      console.error('Cloud storage unavailable:', error.message);
      res.status(503).json({error:'Cloud storage is unavailable. Configure DATABASE_URL and initialize the database.'});
    }
  };
}

export function storeFile(buffer, type = 'application/octet-stream', prefix = 'file') {
  const state = cloudContext.getStore();
  if (!state) throw new Error('Cloud uploads require a request context');
  const extension = type === 'image/png' ? '.png' : type === 'image/jpeg' ? '.jpg' : type === 'application/pdf' ? '.pdf' : '';
  const name = `${prefix.replace(/[^a-zA-Z0-9_-]/g, '-')}-${crypto.randomUUID()}${extension}`;
  const file = {buffer, type}; state.files.set(name, file); state.newFiles.set(name, file);
  return name;
}

export const cloudUploadStorage = {
  _handleFile(req, file, callback) {
    const chunks = []; file.stream.on('data', chunk => chunks.push(chunk));
    file.stream.on('error', callback);
    file.stream.on('end', () => {
      try { const buffer = Buffer.concat(chunks); const filename = storeFile(buffer, file.mimetype); callback(null, { filename, size: buffer.length }); }
      catch (error) { callback(error); }
    });
  },
  _removeFile(req, file, callback) {
    const state = cloudContext.getStore(); state?.files.delete(file.filename); state?.newFiles.delete(file.filename); callback(null);
  }
};
