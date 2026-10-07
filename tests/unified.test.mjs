import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildSeed } from '../server/src/seed.js';

test('one server serves both frontends and completes the driver pickup/sign-off workflow', async () => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'flowdepot-test-'));
  process.env.DB_PATH=path.join(temp,'db.json');process.env.UPLOADS_PATH=path.join(temp,'uploads');
  process.env.SERVE_FRONTENDS='true';process.env.FLOWDEPOT_NO_LISTEN='true';
  process.env.APP_MODE='production';process.env.JWT_SECRET='test-only-secret-with-at-least-32-characters';
  fs.writeFileSync(process.env.DB_PATH,JSON.stringify(await buildSeed()));
  const {server}=await import('../server/src/index.js');
  server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  const request=async(route,token,body)=>{
    const response=await fetch(url+route,{method:body?'POST':'GET',headers:{Origin:url,...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    assert.ok(response.ok,`${route}: ${response.status} ${response.ok?'':await response.text()}`);return response;
  };
  try {
    for(const route of ['/login','/driver/login','/driver/app/today','/driver/app/schedule']){
      const html=await(await request(route)).text();assert.match(html,/id="app"/);
      const asset=html.match(/src="([^"]+\.js)"/)[1];
      assert.ok(asset.startsWith('/assets/'));
      assert.match((await request(asset)).headers.get('Content-Type'),/javascript/);
    }
    assert.equal((await fetch(url+'/api/nonexistent')).status,404);
    assert.equal((await fetch(url+'/api/dashboard')).status,401);
    const owner=await(await request('/api/auth/login',null,{email:'owner@demo.com',password:'Owner123!'})).json();
    const driver=await(await request('/api/auth/login',null,{email:'driver@demo.com',password:'Driver123!'})).json();
    const before=await(await request('/api/dashboard',driver.token)).json();assert.equal(before.role,'DRIVER');
    const run=before.routeRuns[0];assert.ok(run);await request(`/api/route-runs/${run.id}/instructions/ack`,driver.token,{});
    await request(`/api/route-runs/${run.id}/start`,driver.token,{});
    const after=await(await request('/api/dashboard',driver.token)).json();assert.equal(after.routeRuns[0].status,'IN_PROGRESS');
    const stop=after.routeRuns[0].stops.find(s=>s.type==='DELIVERY');
    const signature='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jI1sAAAAASUVORK5CYII=';
    await request(`/api/route-runs/${run.id}/stops/${stop.id}/signoff`,driver.token,{receiverName:'Test Receiver',signatureDataUrl:signature});
    const deliveries=await(await request('/api/deliveries',owner.token)).json();
    const delivered=deliveries.find(d=>stop.deliveryIds.includes(d.id));assert.equal(delivered.status,'DELIVERED');
    assert.ok(delivered.receiverSignoff.signaturePath);await request(delivered.receiverSignoff.signaturePath);
    const pdf=await request(`/api/documents/delivery/${delivered.id}?type=POD`,owner.token);
    assert.match(pdf.headers.get('Content-Type'),/pdf/);assert.ok((await pdf.arrayBuffer()).byteLength>500);
    const live=await(await request('/api/live',driver.token)).json();assert.ok(Array.isArray(live.notifications));
  } finally {
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
