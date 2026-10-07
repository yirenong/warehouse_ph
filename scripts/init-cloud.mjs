import crypto from 'node:crypto';
import { buildSeed } from '../server/src/seed.js';
import { databasePool, createSchema } from '../server/src/cloud-store.js';
if(!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL first.');
const demo = process.argv.includes('--demo');
if(!demo && (!process.env.BOOTSTRAP_OWNER_EMAIL || (process.env.BOOTSTRAP_OWNER_PASSWORD||'').length<12))
  throw new Error('Set BOOTSTRAP_OWNER_EMAIL and BOOTSTRAP_OWNER_PASSWORD (minimum 12 characters).');
const db = await buildSeed();
if(!demo) {
  for(const key of Object.keys(db)) if(Array.isArray(db[key])) db[key]=[];
  const salt=crypto.randomBytes(16).toString('hex');
  const digest=crypto.scryptSync(process.env.BOOTSTRAP_OWNER_PASSWORD,salt,32).toString('hex');
  db.users=[{id:'USR-OWNER-001',name:process.env.BOOTSTRAP_OWNER_NAME||'FlowDepot Owner',
    email:process.env.BOOTSTRAP_OWNER_EMAIL.toLowerCase(),password:`scrypt$${salt}$${digest}`,
    role:'OWNER',tenantId:null,siteIds:[],createdAt:new Date().toISOString()}];
  db.organization={...db.organization,name:process.env.ORGANIZATION_NAME||'FlowDepot',email:process.env.BOOTSTRAP_OWNER_EMAIL};
}
db.simulationState={running:false,mode:'DISABLED',runId:null};
const pool=databasePool(),client=await pool.connect();
try {
  await client.query('BEGIN'); await createSchema(client);
  const result=await client.query('INSERT INTO flowdepot_state(id,data) VALUES (1,$1) ON CONFLICT(id) DO NOTHING RETURNING id',[JSON.stringify(db)]);
  await client.query('COMMIT');
  console.log(result.rows.length ? `Cloud database initialized (${demo?'demo accounts':'owner account'}).` : 'Existing cloud database preserved; initialization skipped.');
} catch(error) {await client.query('ROLLBACK');throw error;}
finally {client.release();await pool.end();}
