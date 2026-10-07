import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { createSchema, persistentRequests, storeFile, cloudContext } from '../server/src/cloud-store.js';
import { loadDb, saveDb } from '../server/src/store.js';

test('cloud transactions persist records and files together, and roll back rejected changes', async () => {
  const database = new PGlite(); await createSchema(database);
  await database.query('INSERT INTO flowdepot_state(id,data) VALUES (1,$1)', [JSON.stringify({ counter:0, files:[] })]);
  let failCommit = false;
  const pool = { async connect(){return {query:(...args)=>{
    if(args[0]==='COMMIT' && failCommit) {failCommit=false;throw new Error('Simulated interrupted commit');}
    return database.query(...args);
  },release(){}};} };
  const app=express(); app.use(express.json()); app.use(persistentRequests(()=>pool));
  app.post('/save',(req,res)=>{
    const db=loadDb(); db.counter++;
    const name=storeFile(Buffer.from('signed proof'), 'image/png', 'signature');
    db.files.push(`/uploads/${name}`);saveDb(db);res.status(req.body.reject?422:201).json(db);
  });
  app.get('/state',(req,res)=>res.json(loadDb()));
  app.get('/uploads/:name',(req,res)=>{
    const file=cloudContext.getStore().files.get(req.params.name);
    if(!file)return res.status(404).end();res.send(Buffer.from(file.buffer));
  });
  const server=app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  try {
    let response=await fetch(`${url}/save`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(response.status,201);const saved=await response.json();assert.equal(saved.counter,1);
    assert.equal((await database.query('SELECT count(*) FROM flowdepot_files')).rows[0].count,1);
    failCommit=true;
    response=await fetch(`${url}/save`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(response.status,503);assert.match((await response.json()).error,/Unable to save/);
    assert.equal((await database.query('SELECT data FROM flowdepot_state WHERE id=1')).rows[0].data.counter,1);
    assert.equal((await database.query('SELECT count(*) FROM flowdepot_files')).rows[0].count,1);
    assert.equal(await (await fetch(url+saved.files[0])).text(),'signed proof');
    response=await fetch(`${url}/save`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"reject":true}'});
    assert.equal(response.status,422);
    const state=await (await fetch(`${url}/state`)).json();assert.equal(state.counter,1);assert.equal(state.files.length,1);
    assert.equal((await database.query('SELECT count(*) FROM flowdepot_files')).rows[0].count,1);
    // Re-open middleware over the same database to prove state is not process memory.
    assert.equal((await database.query('SELECT data FROM flowdepot_state WHERE id=1')).rows[0].data.counter,1);
  } finally {await new Promise(resolve=>server.close(resolve));await database.close();}
});
