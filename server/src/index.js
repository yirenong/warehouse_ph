import express from 'express';
import cors from 'cors';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import multer from 'multer';
import PDFDocument from 'pdfkit';
import { Server } from 'socket.io';
import { loadDb, saveDb, id } from './store.js';
import { cloudEnabled, cloudContext, persistentRequests, storeFile, cloudUploadStorage } from './cloud-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const uploadsPath=process.env.UPLOADS_PATH?path.resolve(process.env.UPLOADS_PATH):path.resolve(__dirname,'../uploads');
if(!process.env.VERCEL) fs.mkdirSync(uploadsPath,{recursive:true});
const server = http.createServer(app);
const PORT = process.env.PORT || 4000;
const HOSTED = Boolean(process.env.VERCEL);
const APP_MODE = process.env.APP_MODE || (HOSTED ? 'production' : 'demo');
if(HOSTED && !cloudEnabled) throw new Error('Vercel requires DATABASE_URL for persistent records and uploads.');
const SIMULATION_ENABLED = !cloudEnabled && String(process.env.SIMULATION_ENABLED ?? (APP_MODE !== 'production')).toLowerCase() === 'true';
const JWT_SECRET = process.env.JWT_SECRET || 'demo-change-me';
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:5180,http://localhost:5180,http://localhost:5174').split(',').map(x=>x.trim()).filter(Boolean);
if (APP_MODE === 'production' && (JWT_SECRET === 'demo-change-me' || JWT_SECRET.length < 32)) throw new Error('Production requires JWT_SECRET of at least 32 characters.');
const io = new Server(server,{cors:{origin(origin,cb){if(!origin||APP_MODE!=='production'||ALLOWED_ORIGINS.includes(origin))return cb(null,true);cb(new Error('Origin not allowed'));}}});

const requestBuckets = new Map();
function rateLimit(req,res,next){ const key=req.ip||'unknown', now=Date.now(), windowMs=60_000, max=Number(process.env.RATE_LIMIT_PER_MINUTE||240); const b=requestBuckets.get(key)||{start:now,count:0}; if(now-b.start>windowMs){b.start=now;b.count=0;} b.count++; requestBuckets.set(key,b); if(b.count>max)return res.status(429).json({error:'Too many requests'}); next(); }
app.disable('x-powered-by');
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Permissions-Policy','camera=(self), geolocation=(self), microphone=()');res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss: http: https:");req.requestId=crypto.randomUUID();res.setHeader('X-Request-Id',req.requestId);next();});
app.use(rateLimit);
app.use(cors((req,cb)=>{
  const origin=req.get('origin');let sameOrigin=false;
  try{sameOrigin=Boolean(origin)&&new URL(origin).host===req.get('host');}catch{}
  if(!origin||sameOrigin||APP_MODE!=='production'||ALLOWED_ORIGINS.includes(origin))return cb(null,{origin:true,credentials:false});
  cb(new Error('Origin not allowed'));
}));
app.use(express.json({ limit: '2mb' }));
if(cloudEnabled) app.use(persistentRequests());
if(cloudEnabled) app.get('/uploads/:name', (req,res)=>{const file=cloudContext.getStore()?.files.get(req.params.name);if(!file)return res.status(404).json({error:'File not found'});res.setHeader('Cache-Control','private, no-store');res.type(file.type).send(file.buffer);});
else app.use('/uploads', express.static(uploadsPath));

const upload = multer({ ...(cloudEnabled?{storage:cloudUploadStorage}:{dest:uploadsPath}), limits:{fileSize:(HOSTED?4:10)*1024*1024,files:1}, fileFilter:(req,file,cb)=>{const ok=['image/png','image/jpeg','application/pdf'].includes(file.mimetype);cb(ok?null:new Error('Unsupported file type'),ok);} });
const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');
function verifyPassword(password,stored){try{const [scheme,salt,digest]=String(stored||'').split('$');if(scheme!=='scrypt'||!salt||!digest)return false;const actual=crypto.scryptSync(String(password),salt,32).toString('hex');return crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(digest,'hex'));}catch{return false;}}

function getFxRate(db, from, to) {
  if (!from || !to || from === to) return 1;
  const base = db.organization?.baseCurrency || 'SGD';
  const rows = db.exchangeRates || [];
  const direct = rows.find(r => r.base === from && r.quote === to);
  if (direct) return direct.rate;
  const fromBase = from === base ? 1 : rows.find(r => r.base === base && r.quote === from)?.rate;
  const toBase = to === base ? 1 : rows.find(r => r.base === base && r.quote === to)?.rate;
  if (fromBase && toBase) return toBase / fromBase;
  return null;
}

function convertMoney(db, amount, from, to) {
  const rate = getFxRate(db, from, to);
  if (rate == null) return null;
  return Math.round(Number(amount || 0) * rate * 100) / 100;
}



function safeFileName(v='document') { return String(v).replace(/[^a-z0-9_-]+/gi,'-'); }
function saveDataUrl(dataUrl, prefix='signature') {
  const m=String(dataUrl||'').match(/^data:image\/(png|jpeg);base64,(.+)$/);
  if(!m) return null;
  const ext=m[1]==='jpeg'?'jpg':'png';
  const name=`${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  if(cloudEnabled) return `/uploads/${storeFile(Buffer.from(m[2],'base64'),`image/${m[1]}`,prefix)}`;
  const out=path.resolve(uploadsPath,name);
  fs.writeFileSync(out,Buffer.from(m[2],'base64'));
  return `/uploads/${name}`;
}
function uploadFsPath(webPath) {
  if(!webPath) return null;
  if(cloudEnabled) return cloudContext.getStore()?.files.get(String(webPath).replace('/uploads/',''))?.buffer || null;
  const p=path.resolve(uploadsPath,path.basename(String(webPath)));
  return fs.existsSync(p)?p:null;
}
function displayLocation(db,type,id) {
  if(type==='WAREHOUSE') return db.warehouses.find(x=>x.id===id)?.name || id;
  if(type==='STORE') return db.stores.find(x=>x.id===id)?.name || id;
  return id || '-';
}
function pdfBrandHeader(doc,db,title,subtitle='') {
  const org=db.organization||{};
  const logo=uploadFsPath(org.logoPath);
  if(logo){ try{ doc.image(logo,42,36,{fit:[92,42]}); }catch{} }
  else { doc.roundedRect(42,36,48,34,6).fill('#111827'); doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(13).text('FD',57,47); }
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(13).text(org.legalName||org.name||'FlowDepot',145,38,{width:260});
  doc.font('Helvetica').fontSize(8).fillColor('#64748b').text([org.address,org.phone,org.email,org.registrationNo?`Reg. No: ${org.registrationNo}`:null].filter(Boolean).join('  |  '),145,55,{width:360});
  doc.moveTo(42,86).lineTo(553,86).strokeColor('#d1d5db').stroke();
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(20).text(title,42,104);
  if(subtitle) doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(subtitle,42,130);
  doc.fillColor('#111827');
}
function pdfFooter(doc,db,docNo) {
  const y=790; doc.moveTo(42,y-10).lineTo(553,y-10).strokeColor('#e5e7eb').stroke();
  doc.font('Helvetica').fontSize(7).fillColor('#6b7280').text(`Controlled document | ${docNo} | Generated ${new Date().toLocaleString()} | ${db.organization?.name||'FlowDepot'}`,42,y,{width:511,align:'center'});
}
function labelValue(doc,label,value,x,y,w=240) {
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#6b7280').text(String(label).toUpperCase(),x,y,{width:w});
  doc.font('Helvetica').fontSize(10).fillColor('#111827').text(String(value??'-'),x,y+11,{width:w});
}
function sectionTitle(doc,title,y) { doc.roundedRect(42,y,511,22,3).fill('#f3f4f6'); doc.fillColor('#111827').font('Helvetica-Bold').fontSize(9).text(title,50,y+7); return y+31; }
function deliverySystemFields(db,d){
  const tenant=(db.tenants||[]).find(x=>x.id===d.tenantId);
  const store=d.toType==='STORE'?(db.stores||[]).find(x=>x.id===d.toId):null;
  return { companyName:tenant?.name||d.tenantId||'-', storeName:store?.name||displayLocation(db,d.toType,d.toId), referenceId:d.referenceId||d.purchaseOrderNo||d.orderReference||d.id };
}
function podRecipientsForDelivery(db,d){
  const contacts=(db.locationContacts||[]).filter(c=>c.active!==false&&c.receivePod===true&&c.tenantId===d.tenantId);
  const storeSpecific=d.toType==='STORE'?contacts.filter(c=>c.storeId===d.toId):[];
  const companyWide=contacts.filter(c=>!c.storeId);
  const seen=new Set();
  return [...storeSpecific,...companyWide].filter(c=>{const key=String(c.email||c.phone||c.id).toLowerCase();if(!key||seen.has(key))return false;seen.add(key);return true;});
}
function queuePodDistribution(db,d,signedAt){
  db.documentDistributions=db.documentDistributions||[];
  const recipients=podRecipientsForDelivery(db,d);
  const snapshot=recipients.map(c=>({contactId:c.id,name:c.name,email:c.email||'',phone:c.phone||'',role:c.role,storeId:c.storeId||null}));
  const batchId=id('DIST');
  for(const r of snapshot){
    db.documentDistributions.unshift({id:id('DOCSEND'),batchId,documentType:'POD',deliveryId:d.id,tenantId:d.tenantId,storeId:d.toType==='STORE'?d.toId:null,recipient:r,status:'QUEUED',channel:r.email?'EMAIL':'SMS',createdAt:signedAt,attempts:0,lastAttemptAt:null,deliveredAt:null,error:null});
  }
  d.podDistribution={batchId,recipientCount:snapshot.length,recipients:snapshot,queuedAt:signedAt,status:snapshot.length?'QUEUED':'NO_RECIPIENTS'};
  processEvent(db,{type:'POD_DISTRIBUTION_QUEUED',entityType:'DELIVERY',entityId:d.id,actor:'system',method:'DOCUMENT_ENGINE',note:snapshot.length?`Signed POD queued for ${snapshot.length} registered recipient(s).`:'No registered POD recipients were configured for this destination.'});
  return snapshot;
}
function money(v,c='SGD'){ try{return new Intl.NumberFormat('en-US',{style:'currency',currency:c}).format(Number(v||0));}catch{return `${c} ${Number(v||0).toFixed(2)}`;} }
function createDeliveryPdf(res,db,d,docType='POD') {
  const tenant=db.tenants.find(x=>x.id===d.tenantId); const driver=db.drivers.find(x=>x.id===d.driverId); const vehicle=db.vehicles.find(x=>x.id===d.vehicleId);
  const isPod=docType==='POD'; const title=isPod?'PROOF OF DELIVERY':'DELIVERY ORDER'; const docNo=`${isPod?'POD':'DO'}-${d.id}`;
  const doc=new PDFDocument({margin:42,size:'A4'}); res.type('application/pdf'); res.setHeader('Content-Disposition',`attachment; filename=${safeFileName(docNo)}.pdf`); doc.pipe(res);
  pdfBrandHeader(doc,db,title,`Official ${isPod?'delivery acknowledgement':'delivery instruction'} and audit record`);
  labelValue(doc,'Document no.',docNo,42,154); labelValue(doc,'Delivery reference',d.id,310,154); labelValue(doc,'Scheduled',new Date(d.scheduledAt).toLocaleString(),42,191); labelValue(doc,'Status',String(d.status||'').replaceAll('_',' '),310,191);
  let y=235; y=sectionTitle(doc,'Parties and delivery route',y);
  labelValue(doc,'Tenant / customer',tenant?.name||d.tenantId,50,y); labelValue(doc,'From',displayLocation(db,d.fromType,d.fromId),310,y); y+=42;
  labelValue(doc,'Consignee / destination',displayLocation(db,d.toType,d.toId),50,y); labelValue(doc,'Delivery type',d.type,310,y); y+=50;
  y=sectionTitle(doc,'Transport details',y); labelValue(doc,'Driver',driver?.name||'-',50,y); labelValue(doc,'Vehicle',vehicle?`${vehicle.plate} (${vehicle.type||'Vehicle'})`:'-',310,y); y+=48;
  y=sectionTitle(doc,'Goods delivered',y);
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#374151'); doc.text('SKU',50,y); doc.text('Description',160,y); doc.text('Quantity',465,y,{width:75,align:'right'}); y+=15; doc.moveTo(50,y).lineTo(545,y).strokeColor('#d1d5db').stroke(); y+=8;
  (d.items||[]).forEach((it,i)=>{ const inv=(db.inventory||[]).find(x=>x.sku===it.sku); doc.font('Helvetica').fontSize(9).fillColor('#111827'); doc.text(it.sku,50,y); doc.text(inv?.name||'-',160,y,{width:250}); doc.text(String(it.qty),465,y,{width:75,align:'right'}); y+=22; });
  y+=10;
  if(isPod){ y=sectionTitle(doc,'Receiver acknowledgement',y); const s=d.receiverSignoff; const sys=deliverySystemFields(db,d); labelValue(doc,'Received by',s?.receiverName||'Pending sign-off',50,y); labelValue(doc,'Company / store',`${sys.companyName} / ${sys.storeName}`,310,y); y+=42; labelValue(doc,'Reference / ID',sys.referenceId,50,y); labelValue(doc,'Received at',s?.signedAt?new Date(s.signedAt).toLocaleString():'-',310,y); y+=42; labelValue(doc,'Remarks',s?.remarks||'Goods received in apparent good order unless stated otherwise.',50,y,495); y+=46;
    const sig=uploadFsPath(s?.signaturePath); if(sig){ doc.font('Helvetica-Bold').fontSize(7).fillColor('#6b7280').text('RECEIVER SIGNATURE',50,y); try{doc.image(sig,50,y+12,{fit:[180,58]});}catch{} doc.moveTo(50,y+72).lineTo(245,y+72).strokeColor('#9ca3af').stroke(); }
    if(d.proofPhoto){ doc.font('Helvetica').fontSize(7).fillColor('#6b7280').text('Photographic proof is retained in the digital record.',310,y+18,{width:230}); }
  } else { y=sectionTitle(doc,'Instructions and acceptance',y); doc.font('Helvetica').fontSize(9).fillColor('#111827').text('Driver must verify goods, quantity, vehicle suitability and destination before departure. Any discrepancy, damage or refusal must be recorded as an incident before closing the delivery.',50,y,{width:495}); }
  pdfFooter(doc,db,docNo); doc.end();
}
function createIncidentPdf(res,db,inc){ const docNo=`IR-${inc.id}`; const doc=new PDFDocument({margin:42,size:'A4'});res.type('application/pdf');res.setHeader('Content-Disposition',`attachment; filename=${safeFileName(docNo)}.pdf`);doc.pipe(res);pdfBrandHeader(doc,db,'INCIDENT REPORT','Operational exception, investigation and rectification record'); labelValue(doc,'Report no.',docNo,42,154);labelValue(doc,'Incident ID',inc.id,310,154);labelValue(doc,'Severity',inc.severity,42,191);labelValue(doc,'Status',inc.status,310,191);let y=235;y=sectionTitle(doc,'Incident details',y);labelValue(doc,'Type',inc.type,50,y);labelValue(doc,'Reported',new Date(inc.createdAt).toLocaleString(),310,y);y+=48;labelValue(doc,'Title',inc.title||'-',50,y,495);y+=42;labelValue(doc,'Description',inc.description||'-',50,y,495);y+=58;y=sectionTitle(doc,'Rectification / corrective action',y);doc.font('Helvetica').fontSize(9).fillColor('#111827').text(inc.rectification||'Pending assessment.',50,y,{width:495});y+=70;y=sectionTitle(doc,'Management sign-off',y);doc.font('Helvetica').fontSize(8).fillColor('#6b7280').text('Prepared by',50,y);doc.text('Reviewed / approved by',310,y);doc.moveTo(50,y+52).lineTo(240,y+52).strokeColor('#9ca3af').stroke();doc.moveTo(310,y+52).lineTo(500,y+52).stroke();pdfFooter(doc,db,docNo);doc.end(); }
function createInvoicePdf(res,db,inv){ const tenant=db.tenants.find(x=>x.id===inv.tenantId);const lease=db.leases.find(x=>x.id===inv.leaseId);const wh=db.warehouses.find(x=>x.id===lease?.warehouseId);const doc=new PDFDocument({margin:42,size:'A4'});res.type('application/pdf');res.setHeader('Content-Disposition',`attachment; filename=${safeFileName(inv.id)}.pdf`);doc.pipe(res);pdfBrandHeader(doc,db,'TAX / COMMERCIAL INVOICE','Tenant rental, utilities and service charges');labelValue(doc,'Invoice no.',inv.id,42,154);labelValue(doc,'Billing period',inv.period,310,154);labelValue(doc,'Bill to',tenant?.name||inv.tenantId,42,191);labelValue(doc,'Due date',new Date(inv.dueDate).toLocaleDateString(),310,191);let y=235;y=sectionTitle(doc,'Billing details',y);labelValue(doc,'Warehouse',wh?.name||'-',50,y);labelValue(doc,'Currency',inv.currency,310,y);y+=48;doc.font('Helvetica-Bold').fontSize(8).text('Description',50,y);doc.text('Amount',430,y,{width:110,align:'right'});y+=18;[['Rent',inv.rent],['Utilities - energy & water',inv.utilities],['Other services / platform fees',inv.other]].forEach(([a,v])=>{doc.font('Helvetica').fontSize(9).text(a,50,y);doc.text(money(v,inv.currency),430,y,{width:110,align:'right'});y+=24;});doc.moveTo(330,y).lineTo(540,y).strokeColor('#9ca3af').stroke();y+=10;doc.font('Helvetica-Bold').fontSize(12).text('TOTAL',330,y);doc.text(money(inv.total,inv.currency),430,y,{width:110,align:'right'});y+=55;y=sectionTitle(doc,'Payment and document notes',y);doc.font('Helvetica').fontSize(8).text('Please quote the invoice number with payment. Historical tariff and exchange-rate records used for this invoice are retained in the FlowDepot audit trail. Tax treatment and statutory fields should be configured for the operating country before production use.',50,y,{width:495});pdfFooter(doc,db,inv.id);doc.end(); }
function createUtilityStatementPdf(res,db,bill){ const tenant=db.tenants.find(x=>x.id===bill.tenantId);const wh=db.warehouses.find(x=>x.id===bill.warehouseId);const docNo=`UTIL-${bill.id}`;const doc=new PDFDocument({margin:42,size:'A4'});res.type('application/pdf');res.setHeader('Content-Disposition',`attachment; filename=${safeFileName(docNo)}.pdf`);doc.pipe(res);pdfBrandHeader(doc,db,'ENERGY & WATER STATEMENT','Metered utility consumption and tenant chargeback statement');labelValue(doc,'Statement no.',docNo,42,154);labelValue(doc,'Billing period',bill.period,310,154);labelValue(doc,'Tenant',tenant?.name||bill.tenantId,42,191);labelValue(doc,'Warehouse',wh?.name||bill.warehouseId,310,191);let y=235;y=sectionTitle(doc,'Consumption and charges',y);doc.font('Helvetica-Bold').fontSize(8);doc.text('Utility',50,y);doc.text('Usage',200,y);doc.text('Rate',330,y);doc.text('Charge',440,y,{width:100,align:'right'});y+=20;const e=Number(bill.electricityKwh||0)*Number(bill.electricityRate||0),w=Number(bill.waterM3||0)*Number(bill.waterRate||0);[['Electricity',`${bill.electricityKwh} kWh`,`${bill.currency} ${bill.electricityRate}/kWh`,e],['Water',`${bill.waterM3} m3`,`${bill.currency} ${bill.waterRate}/m3`,w]].forEach(r=>{doc.font('Helvetica').fontSize(9).text(r[0],50,y);doc.text(r[1],200,y);doc.text(r[2],330,y);doc.text(money(r[3],bill.currency),440,y,{width:100,align:'right'});y+=26;});y+=10;doc.font('Helvetica-Bold').fontSize(12).text('Total utility charge',300,y);doc.text(money(bill.amount,bill.currency),430,y,{width:110,align:'right'});y+=60;y=sectionTitle(doc,'Audit statement',y);doc.font('Helvetica').fontSize(8).text('This statement is generated from the meter and tariff records retained by FlowDepot. Opening/closing readings and interval data should be attached where required by local regulation or tenant contract.',50,y,{width:495});pdfFooter(doc,db,docNo);doc.end(); }

function utilityAnalytics(db) {
  const current = [...(db.utilityReadings || [])].sort((a,b)=>String(b.period).localeCompare(String(a.period)))[0]?.period;
  const currentRows = (db.utilityReadings || []).filter(r=>r.period===current);
  const previousPeriods = [...new Set((db.utilityReadings||[]).map(r=>r.period))].sort().reverse();
  const previous = previousPeriods[1];
  const previousRows = (db.utilityReadings || []).filter(r=>r.period===previous);
  const sum = (rows,key)=>rows.reduce((s,r)=>s+Number(r[key]||0),0);
  const energy = sum(currentRows,'electricityKwh'), water = sum(currentRows,'waterM3');
  const prevEnergy = sum(previousRows,'electricityKwh'), prevWater = sum(previousRows,'waterM3');
  const totalSqft = db.warehouses.reduce((s,w)=>s+Number(w.areaSqft||0),0);
  const occupiedSqft = db.warehouses.reduce((s,w)=>s+Number(w.leasedSqft||0),0);
  const energyIntensity = totalSqft ? energy/(totalSqft*0.092903) : 0;
  const waterIntensity = totalSqft ? water/(totalSqft*0.092903) : 0;
  const billed = (db.utilityBills||[]).filter(b=>b.period===previous).reduce((s,b)=>s+convertMoney(db,b.amount,b.currency,db.organization.baseCurrency),0);
  let supplierCost=0;
  currentRows.forEach(r=>{
    const e=(db.utilityTariffs||[]).find(t=>t.warehouseId===r.warehouseId&&t.utility==='ELECTRICITY'&&t.active);
    const w=(db.utilityTariffs||[]).find(t=>t.warehouseId===r.warehouseId&&t.utility==='WATER'&&t.active);
    supplierCost += Number(r.electricityKwh||0)*Number(e?.baseRate||0)+Number(r.waterM3||0)*Number(w?.baseRate||0);
  });
  const projectedRecovery=currentRows.reduce((s,r)=>{
    const e=(db.utilityTariffs||[]).find(t=>t.warehouseId===r.warehouseId&&t.utility==='ELECTRICITY'&&t.active);
    const w=(db.utilityTariffs||[]).find(t=>t.warehouseId===r.warehouseId&&t.utility==='WATER'&&t.active);
    return s+Number(r.electricityKwh||0)*Number(e?.finalRate||0)+Number(r.waterM3||0)*Number(w?.finalRate||0);
  },0);
  const onlineMeters=(db.meters||[]).filter(m=>m.status==='ONLINE').length;
  return {
    period:current,
    electricityKwh:Math.round(energy), waterM3:Math.round(water),
    energyChangePct:prevEnergy?Math.round((energy-prevEnergy)/prevEnergy*1000)/10:0,
    waterChangePct:prevWater?Math.round((water-prevWater)/prevWater*1000)/10:0,
    energyIntensityKwhM2:Math.round(energyIntensity*10)/10,
    waterIntensityM3M2:Math.round(waterIntensity*1000)/1000,
    supplierCost:Math.round(supplierCost*100)/100,
    projectedRecovery:Math.round(projectedRecovery*100)/100,
    utilityMargin:Math.round((projectedRecovery-supplierCost)*100)/100,
    historicalBilled:Math.round(billed*100)/100,
    meterCoveragePct:(db.meters||[]).length?Math.round(onlineMeters/(db.meters||[]).length*100):0,
    occupiedSqft,
    carbonKgCo2e:Math.round(energy*Number(db.organization?.emissionsFactorKgPerKwh||0))
  };
}

function operationalKpis(db) {
  const ds=db.deliveries||[], events=db.processEvents||[], incidents=db.incidents||[];
  const delivered=ds.filter(d=>d.status==='DELIVERED');
  const onTime=ds.filter(d=>d.onTime!==false).length;
  const pod=ds.filter(d=>d.proofPhoto).length;
  const digitalEvents=events.filter(e=>['QR','RFID','MOBILE','MOBILE_CAMERA','SYSTEM'].includes(e.method)).length;
  return {
    onTimeDeliveryPct:ds.length?Math.round(onTime/ds.length*100):0,
    proofOfDeliveryPct:delivered.length?Math.round(pod/delivered.length*100):0,
    digitalTraceabilityPct:events.length?Math.round(digitalEvents/events.length*100):100,
    openIncidents:incidents.filter(i=>!['CLOSED','RESOLVED'].includes(i.status)).length,
    inventoryAccuracyPct:98.4,
    dockToDispatchMinutes:42,
    orderCycleHours:6.8,
    spaceUtilizationPct:db.warehouses.length?Math.round(db.warehouses.reduce((s,w)=>s+w.leasedSqft/w.areaSqft*100,0)/db.warehouses.length):0
  };
}

function publicUser(user) {
  const { password, ...rest } = user;
  return rest;
}

function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET,{issuer:'flowdepot',audience:'flowdepot-app'});
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function role(...roles) {
  return (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Forbidden' });
}

function emitNotification(db, userId, title, message, level='info') {
  const n = { id:id('NOT'), userId, title, message, level, read:false, createdAt:new Date().toISOString() };
  db.notifications.unshift(n);
  io.to(userId).emit('notification', n);
  return n;
}

function processEvent(db, { type, entityType, entityId, actor='system', method='SYSTEM', note='', metadata={} }) {
  db.processEvents=db.processEvents||[];
  const previousHash=db.processEvents[0]?.eventHash||'GENESIS';
  const e = { id:id('EVT'), type, entityType, entityId, actor, method, timestamp:new Date().toISOString(), note, metadata, previousHash };
  e.eventHash=hash(JSON.stringify({id:e.id,type:e.type,entityType:e.entityType,entityId:e.entityId,actor:e.actor,method:e.method,timestamp:e.timestamp,note:e.note,metadata:e.metadata,previousHash}));
  db.processEvents.unshift(e);
  io.emit('process-event', e);
  return e;
}

function driverForUser(db,user){ return (db.drivers||[]).find(d=>d.userId===user.id); }
function routeVisibleToUser(db,user,run){
  if(['OWNER','WAREHOUSE_MANAGER'].includes(user.role)) return true;
  if(user.role==='TENANT') return run.tenantId===user.tenantId;
  if(user.role==='DRIVER') { const d=driverForUser(db,user); return [run.primaryDriverId,run.standbyDriverId,run.activeDriverId].includes(d?.id); }
  return false;
}
function haversineMeters(a,b){
  if(!a||!b||a.latitude==null||a.longitude==null||b.lat==null||b.lng==null) return null;
  const R=6371000,toRad=x=>x*Math.PI/180; const dLat=toRad(b.lat-a.latitude),dLon=toRad(b.lng-a.longitude);
  const x=Math.sin(dLat/2)**2+Math.cos(toRad(a.latitude))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}
function routeTrackingState(run){
  if(!run.lastLocation?.timestamp) return run.trackingStatus||'OFFLINE';
  const age=(Date.now()-new Date(run.lastLocation.timestamp).getTime())/1000;
  if(age<=120) return 'LIVE'; if(age<=600) return 'STALE'; return 'OFFLINE';
}
function nextRouteStop(run){ return (run.stops||[]).find(s=>!['COMPLETED','SKIPPED'].includes(s.status)); }
function enrichRoute(db,run){
  const primary=(db.drivers||[]).find(d=>d.id===run.primaryDriverId), standby=(db.drivers||[]).find(d=>d.id===run.standbyDriverId), active=(db.drivers||[]).find(d=>d.id===run.activeDriverId), vehicle=(db.vehicles||[]).find(v=>v.id===run.vehicleId);
  const deliveries=(db.deliveries||[]).filter(d=>d.routeRunId===run.id);
  const next=nextRouteStop(run); const done=(run.stops||[]).filter(s=>s.status==='COMPLETED').length;
  const stops=(run.stops||[]).map(stop=>{const stopDeliveries=deliveries.filter(d=>(stop.deliveryIds||[]).includes(d.id));const recipients=[...new Map(stopDeliveries.flatMap(d=>podRecipientsForDelivery(db,d)).map(c=>[c.id,c])).values()];return {...stop,podRecipients:recipients.map(c=>({id:c.id,name:c.name,role:c.role,email:c.email||'',phone:c.phone||''})),podRecipientCount:recipients.length};}); return {...run,stops,trackingStatus:routeTrackingState(run),primaryDriverName:primary?.name||null,standbyDriverName:standby?.name||null,activeDriverName:active?.name||null,vehiclePlate:vehicle?.plate||null,deliveryCount:deliveries.length,completedStops:done,totalStops:(run.stops||[]).length,nextStopId:next?.id||null};
}




// --- Production workflow controls -------------------------------------------
const DELIVERY_TRANSITIONS={
  REQUESTED:['UNDER_REVIEW','CANCELLED'], UNDER_REVIEW:['APPROVED','REJECTED','CANCELLED'], APPROVED:['PLANNED','CANCELLED'],
  PLANNED:['ASSIGNED','CANCELLED'], ASSIGNED:['IN_TRANSIT','CANCELLED'], IN_TRANSIT:['ARRIVED','PARTIALLY_DELIVERED','DELIVERED','FAILED'],
  ARRIVED:['PARTIALLY_DELIVERED','DELIVERED','FAILED'], PARTIALLY_DELIVERED:['DELIVERED','FAILED'], FAILED:['PLANNED','CLOSED'], DELIVERED:['CLOSED'], CLOSED:[], CANCELLED:[], REJECTED:[]
};
function sameTenant(user,tenantId){return user.role!=='TENANT'||user.tenantId===tenantId;}
function assertTenantAccess(req,res,tenantId){if(!sameTenant(req.user,tenantId)){res.status(403).json({error:'Resource is outside your tenant scope'});return false;}return true;}
function availableQty(db,tenantId,locationId,sku){const inv=(db.inventory||[]).find(i=>i.tenantId===tenantId&&i.locationId===locationId&&i.sku===sku);const reserved=(db.stockReservations||[]).filter(r=>r.tenantId===tenantId&&r.locationId===locationId&&r.sku===sku&&['ACTIVE','PICKED'].includes(r.status)).reduce((a,r)=>a+Number(r.qty||0),0);return Math.max(0,Number(inv?.qty||0)-reserved);}
function appendStockLedger(db,{tenantId,locationType,locationId,sku,qtyDelta,movementType,referenceType,referenceId,actor,note='',unitCost=null}){db.stockLedger=db.stockLedger||[];const current=(db.inventory||[]).find(i=>i.tenantId===tenantId&&i.locationType===locationType&&i.locationId===locationId&&i.sku===sku);if(!current)throw new Error(`Inventory line not found for ${sku} at ${locationId}`);const before=Number(current.qty||0),after=before+Number(qtyDelta||0);if(after<0)throw new Error(`Insufficient on-hand stock for ${sku}`);current.qty=after;const row={id:id('STK'),tenantId,locationType,locationId,sku,qtyDelta:Number(qtyDelta),qtyBefore:before,qtyAfter:after,movementType,referenceType,referenceId,actor,note,unitCost:unitCost??current.unitCost,createdAt:new Date().toISOString()};db.stockLedger.unshift(row);return row;}
function reserveStock(db,{tenantId,locationId,sku,qty,referenceId,actor}){const q=Number(qty||0);if(q<=0)throw new Error('Reservation quantity must be positive');if(availableQty(db,tenantId,locationId,sku)<q)throw new Error(`Insufficient available stock for ${sku}`);db.stockReservations=db.stockReservations||[];const r={id:id('RSV'),tenantId,locationType:'WAREHOUSE',locationId,sku,qty:q,referenceType:'GOODS_REQUEST',referenceId,status:'ACTIVE',createdBy:actor,createdAt:new Date().toISOString()};db.stockReservations.unshift(r);return r;}
function scheduleConflict(db,{driverId,vehicleId,scheduledAt,excludeRunId}){const start=new Date(scheduledAt).getTime(),span=6*3600_000;return (db.routeRuns||[]).filter(r=>r.id!==excludeRunId&&!['CANCELLED','COMPLETED'].includes(r.status)).filter(r=>Math.abs(new Date(r.scheduledAt).getTime()-start)<span).filter(r=>(driverId&&[r.primaryDriverId,r.standbyDriverId].includes(driverId))||(vehicleId&&r.vehicleId===vehicleId));}
function criticalInstructionsForDelivery(db,d){const out=[];for(const item of d.items||[]){const inv=(db.inventory||[]).find(i=>i.tenantId===d.tenantId&&i.sku===item.sku);for(const h of inv?.handlingRules||[])out.push({sku:item.sku,rule:h,critical:['FRAGILE','TEMPERATURE_CONTROLLED','HIGH_VALUE','HAZMAT','DO_NOT_STACK','KEEP_UPRIGHT'].includes(h)});}for(const x of d.driverInstructions||[])out.push({rule:x,critical:false});return out;}
function simulationGuard(req,res,next){if(!SIMULATION_ENABLED)return res.status(404).json({error:'Simulation module is disabled in this deployment'});next();}

// --- Live simulation engine -------------------------------------------------
const simulationTimers = new Map();
function getSimulationState(db){
  if(!db.simulationState) db.simulationState={ mode:'DEMO', running:false, scenario:'NORMAL_DAY', speed:10, tick:0, runId:null, startedAt:null, updatedAt:null, elapsedSimMinutes:0 };
  if(!db.simulationFeed) db.simulationFeed=[];
  if(!db.simulationTelemetry) db.simulationTelemetry=[];
  return db.simulationState;
}
function simFeed(db, title, message, level='info', entityId=null){
  const st=getSimulationState(db);
  const row={id:id('SIM-EVT'),runId:st.runId,simulation:true,tick:st.tick,title,message,level,entityId,createdAt:new Date().toISOString()};
  db.simulationFeed.unshift(row); db.simulationFeed=db.simulationFeed.slice(0,120); io.emit('simulation-event',row); return row;
}
function clearSimulationRun(db, runId=null){
  const match=x=>x?.simulation===true && (!runId || x.simulationRunId===runId || x.runId===runId);
  for(const key of ['deliveries','incidents','tasks','utilityReadings','processEvents','notifications','goodsRequests','deliveryRequests','stockReservations','routeRuns','documentDistributions']) if(Array.isArray(db[key])) db[key]=db[key].filter(x=>!match(x));
  db.simulationTelemetry=(db.simulationTelemetry||[]).filter(x=>!match(x));
  db.simulationFeed=(db.simulationFeed||[]).filter(x=>!match(x));
}
function simulatedDelivery(db){ const st=getSimulationState(db); return (db.deliveries||[]).find(x=>x.simulation===true&&x.simulationRunId===st.runId); }
function runSimulationTick(){
  const db=loadDb(); const st=getSimulationState(db); if(!st.running||!st.runId)return;
  st.tick+=1; st.elapsedSimMinutes+=Math.max(5,Number(st.speed||10)); st.updatedAt=new Date().toISOString();
  const wh=db.warehouses[(st.tick-1)%Math.max(1,db.warehouses.length)]||db.warehouses[0];
  const baseE=wh?.id==='WH-03'?168:wh?.id==='WH-02'?118:146; const baseW=wh?.id==='WH-03'?3.9:wh?.id==='WH-02'?2.7:3.2;
  const spike=st.scenario==='UTILITY_SPIKE' && st.tick>=4 && st.tick<=6;
  const telemetry={id:id('SIM-MTR'),runId:st.runId,simulationRunId:st.runId,simulation:true,warehouseId:wh?.id||'WH-01',timestamp:new Date().toISOString(),electricityKw:Math.round((baseE*(0.92+Math.random()*.18)*(spike?1.85:1))*10)/10,waterM3h:Math.round((baseW*(0.85+Math.random()*.3)*(spike?4.6:1))*10)/10};
  db.simulationTelemetry.unshift(telemetry); db.simulationTelemetry=db.simulationTelemetry.slice(0,240); io.emit('simulation-telemetry',telemetry);
  const driver=db.drivers.find(d=>d.userId==='USR-DRIVER')||db.drivers[0]; const driverUser=db.users.find(u=>u.id===driver?.userId);
  let d=simulatedDelivery(db);
  if(st.scenario==='FULL_OPERATIONS'){
    db.goodsRequests=db.goodsRequests||[];db.stockReservations=db.stockReservations||[];db.routeRuns=db.routeRuns||[];
    let gr=db.goodsRequests.find(x=>x.simulation&&x.simulationRunId===st.runId);
    if(st.tick===1){gr={id:`SIM-GRQ-${String(Date.now()).slice(-6)}`,tenantId:'TEN-01',sourceWarehouseId:'WH-01',destinationType:'STORE',destinationId:'STORE-04',requestedAt:new Date().toISOString(),requestedFor:new Date(Date.now()+2*3600000).toISOString(),status:'REQUESTED',priority:'HIGH',items:[{sku:'SKU-RED-001',qty:24}],notes:'Client simulation: urgent store replenishment.',simulation:true,simulationRunId:st.runId};db.goodsRequests.unshift(gr);simFeed(db,'Customer goods request','Nova Retail submitted an urgent request for 24 fragile units to Novena.','info',gr.id);}
    else if(st.tick===2&&gr){gr.status='APPROVED';const r={id:id('SIM-RSV'),tenantId:'TEN-01',locationType:'WAREHOUSE',locationId:'WH-01',sku:'SKU-RED-001',qty:24,referenceType:'GOODS_REQUEST',referenceId:gr.id,status:'ACTIVE',simulation:true,simulationRunId:st.runId,createdAt:new Date().toISOString()};db.stockReservations.unshift(r);gr.reservationIds=[r.id];simFeed(db,'Stock reserved','24 units reserved. Available inventory updates without changing on-hand stock.','success',gr.id);}
    else if(st.tick===3&&gr){d={id:`SIM-DEL-${String(Date.now()).slice(-6)}`,tenantId:'TEN-01',type:'GOODS_REQUEST',requestId:gr.id,fromType:'WAREHOUSE',fromId:'WH-01',toType:'STORE',toId:'STORE-04',scheduledAt:new Date(Date.now()+90*60000).toISOString(),status:'PLANNED',priority:'HIGH',items:gr.items,driverInstructions:['FRAGILE','KEEP_DRY','Use Novena service entrance'],simulation:true,simulationRunId:st.runId,proofPhoto:null};db.deliveries.unshift(d);gr.status='PLANNED';gr.deliveryId=d.id;simFeed(db,'Delivery created','Warehouse manager converted the approved request into a delivery record.','info',d.id);}
    else if(st.tick===4){d=simulatedDelivery(db);if(d){const run={id:`SIM-RUN-${String(Date.now()).slice(-6)}`,name:'Client Demo · Novena Priority Run',tenantId:'TEN-01',scheduledAt:new Date(Date.now()+30*60000).toISOString(),status:'ASSIGNED',primaryDriverId:'DRV-01',standbyDriverId:'DRV-02',activeDriverId:'DRV-01',standbyApproved:true,vehicleId:'VEH-01',managerNote:'Fragile goods. Do not stack. Use the service entrance and call the store manager on arrival.',stops:[{id:'SIM-STOP-P',sequence:1,type:'PICKUP',name:'Warehouse A',address:'21 Senoko Loop',status:'PENDING',deliveryIds:[d.id],instructions:[{rule:'FRAGILE',critical:true},{rule:'DO_NOT_STACK',critical:true}]},{id:'SIM-STOP-D',sequence:2,type:'DELIVERY',name:'Nova Novena',address:'Novena, Singapore',status:'PENDING',deliveryIds:[d.id],instructions:[{rule:'Use service entrance',critical:false},{rule:'Call store manager on arrival',critical:false}]}],simulation:true,simulationRunId:st.runId,trackingStatus:'OFFLINE'};db.routeRuns.unshift(run);d.routeRunId=run.id;d.routeStopId='SIM-STOP-D';d.driverId='DRV-01';d.standbyDriverId='DRV-02';d.vehicleId='VEH-01';d.status='ASSIGNED';simFeed(db,'Dispatch plan approved','Daniel is primary, Marcus is approved standby, vehicle GBB 3812K assigned.','success',run.id);}}
    else if(st.tick===5){const run=db.routeRuns.find(x=>x.simulation&&x.simulationRunId===st.runId);if(run){run.instructionAcknowledgement={driverId:'DRV-01',acknowledgedAt:new Date().toISOString(),simulation:true};run.status='IN_PROGRESS';run.trackingStatus='LIVE';run.stops[0].status='COMPLETED';d=simulatedDelivery(db);if(d)d.status='IN_TRANSIT';simFeed(db,'Pickup & driver acknowledgement','Driver reviewed fragile-goods instructions, confirmed pickup once and GPS tracking started.','success',run.id);}}
    else if(st.tick===6){const run=db.routeRuns.find(x=>x.simulation&&x.simulationRunId===st.runId);if(run){run.lastLocation={latitude:1.3204,longitude:103.8438,timestamp:new Date().toISOString()};run.stops[1].status='ARRIVED';simFeed(db,'Destination arrival','Geofence detected arrival at Novena service entrance.','info',run.id);}}
    else if(st.tick===7){const run=db.routeRuns.find(x=>x.simulation&&x.simulationRunId===st.runId);d=simulatedDelivery(db);if(run&&d){const signedAt=new Date().toISOString();d.status='DELIVERED';d.receiverSignoff={receiverName:'Sarah Tan (Simulated)',remarks:'Goods received in good order.',signedAt,simulation:true};run.stops[1].status='COMPLETED';run.status='COMPLETED';run.trackingStatus='STOPPED';const recipients=podRecipientsForDelivery(db,d);for(const c of recipients){db.documentDistributions.unshift({id:id('SIM-DOCSEND'),documentType:'POD',deliveryId:d.id,tenantId:d.tenantId,storeId:d.toId,recipient:{contactId:c.id,name:c.name,email:c.email||'',phone:c.phone||'',role:c.role},status:'DELIVERED',channel:c.email?'EMAIL':'SMS',createdAt:signedAt,deliveredAt:signedAt,simulation:true,simulationRunId:st.runId});}simFeed(db,'POD completed & distributed',`Receiver signed once. Signed POD distributed to ${recipients.length} registered receiving/manager contact(s).`,'success',d.id);}}
    if(st.tick>=8){st.running=false;simFeed(db,'Full operations scenario completed','Goods request → reservation → planning → driver instructions → GPS → POD distribution completed.','success');const timer=simulationTimers.get(st.runId);if(timer){clearInterval(timer);simulationTimers.delete(st.runId);}}
    saveDb(db);io.emit('simulation-status',st);return;
  }
  if(st.tick===1){
    d={id:`SIM-DEL-${String(Date.now()).slice(-6)}`,tenantId:'TEN-01',fromType:'WAREHOUSE',fromId:'WH-01',toType:'STORE',toId:'STORE-01',type:'RESTOCK',scheduledAt:new Date(Date.now()+45*60000).toISOString(),status:'ASSIGNED',priority:st.scenario==='PEAK_OPERATIONS'?'HIGH':'NORMAL',driverId:driver?.id,vehicleId:'VEH-01',items:[{sku:'SKU-RED-001',qty:48}],simulation:true,simulationRunId:st.runId,proofPhoto:null};
    db.deliveries.unshift(d); processEvent(db,{type:'SIM_DELIVERY_ASSIGNED',entityType:'DELIVERY',entityId:d.id,actor:'Simulation Engine',method:'SIMULATION',note:'Simulated delivery assigned to driver.'});
    const n=emitNotification(db,driverUser?.id||'USR-DRIVER','New simulated delivery',`${d.id}: Warehouse A → Nova Downtown. Open Schedule to review.`,'info'); n.simulation=true;n.simulationRunId=st.runId; simFeed(db,'Delivery assigned',`${d.id} assigned to ${driver?.name||'driver'}.`,'info',d.id);
  } else if(st.tick===2 && d){ d.status='PICKUP_VERIFIED'; simFeed(db,'Pickup verified',`${d.id}: 48 cartons scanned and verified.`,'success',d.id); }
  else if(st.tick===3 && d){ d.status='IN_TRANSIT'; simFeed(db,'Driver departed',`${d.id} is now in transit to Nova Downtown.`,'info',d.id); }
  else if(st.tick===4 && st.scenario==='VEHICLE_BREAKDOWN' && d){
    d.status='REASSIGNED'; const inc={id:id('SIM-INC'),status:'RECTIFICATION_CREATED',severity:'HIGH',type:'VEHICLE_BREAKDOWN',title:'Simulated vehicle breakdown',description:`Vehicle issue during ${d.id}`,entityId:d.id,createdAt:new Date().toISOString(),rectification:'Backup vehicle GBD 4821X recommended and dispatch alerted.',simulation:true,simulationRunId:st.runId}; db.incidents.unshift(inc);
    const n=emitNotification(db,driverUser?.id||'USR-DRIVER','Urgent dispatch update',`${d.id}: vehicle issue recorded. Review the updated assignment when safely parked.`,'warning'); n.simulation=true;n.simulationRunId=st.runId; simFeed(db,'Vehicle breakdown',`${d.id} moved to exception workflow; backup vehicle recommended.`,'warning',d.id);
  } else if(st.tick===4 && st.scenario==='UTILITY_SPIKE'){ simFeed(db,'Water anomaly detected',`${wh?.name||wh?.id}: simulated water usage exceeded baseline. Inspection task created.`,'warning',wh?.id); }
  else if(st.tick===4 && d){ d.status='ARRIVED'; simFeed(db,'Arrival detected',`${d.id}: driver arrived at destination.`,'success',d.id); }
  else if(st.tick===5 && d && st.scenario!=='VEHICLE_BREAKDOWN'){ d.status='RECEIVER_VERIFICATION'; simFeed(db,'Receiver verification',`${d.id}: goods ready for client sign-off.`,'info',d.id); }
  else if(st.tick===6 && d && st.scenario!=='VEHICLE_BREAKDOWN'){ d.status='DELIVERED'; d.receiverSignoff={receiverName:'Sarah Tan (Simulated)',receiverCompany:'Nova Retail Pte Ltd',receiverReference:'SIM-PO-983218',remarks:'Simulation: goods received in good order.',signedAt:new Date().toISOString(),simulation:true}; simFeed(db,'Delivery completed',`${d.id}: simulated receiver sign-off completed and POD is ready.`,'success',d.id); const n=emitNotification(db,driverUser?.id||'USR-DRIVER','Delivery completed',`${d.id}: signed POD generated in Simulation Mode.`,'success');n.simulation=true;n.simulationRunId=st.runId; }
  if(st.scenario==='NORMAL_DAY'&&st.tick>=7 || st.scenario==='UTILITY_SPIKE'&&st.tick>=8 || st.scenario==='VEHICLE_BREAKDOWN'&&st.tick>=7 || st.scenario==='PEAK_OPERATIONS'&&st.tick>=9){ st.running=false; simFeed(db,'Scenario completed',`${st.scenario.replaceAll('_',' ')} simulation completed.`,'success'); const timer=simulationTimers.get(st.runId); if(timer){clearInterval(timer);simulationTimers.delete(st.runId);} }
  saveDb(db); io.emit('simulation-status',st);
}
function startSimulationTimer(runId){ const existing=simulationTimers.get(runId); if(existing)clearInterval(existing); const t=setInterval(runSimulationTick,2500); simulationTimers.set(runId,t); }

function scopeRows(db, user, key) {
  const rows = db[key] || [];
  if (user.role === 'OWNER' || user.role === 'WAREHOUSE_MANAGER') return rows;
  if (user.role === 'TENANT') {
    if (['utilityReadings','meters','utilityTariffs'].includes(key)) {
      const allowedWarehouses = new Set(db.leases.filter(l=>l.tenantId===user.tenantId).map(l=>l.warehouseId));
      return rows.filter(r=>allowedWarehouses.has(r.warehouseId));
    }
    return rows.filter(r => !('tenantId' in r) || r.tenantId === user.tenantId);
  }
  if (user.role === 'DRIVER' && key === 'deliveries') {
    const driver = db.drivers.find(d => d.userId === user.id);
    return rows.filter(r => r.driverId === driver?.id);
  }
  return rows;
}

app.get('/api/health', (_, res) => res.json({ ok:true, service:'warehouse-suite-api' }));

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const db = loadDb();
  const user = db.users.find(u => u.email.toLowerCase() === String(email || '').toLowerCase());
  if (!user || !verifyPassword(String(password || ''), user.password)) return res.status(401).json({ error:'Invalid credentials' });
  const safe = publicUser(user);
  const token = jwt.sign(safe, JWT_SECRET, { expiresIn:APP_MODE==='production'?'8h':'12h', issuer:'flowdepot', audience:'flowdepot-app' });
  res.json({ token, user:safe });
});

app.get('/api/live', auth, (req,res)=>{const db=loadDb();res.setHeader('Cache-Control','no-store');res.json({notifications:(db.notifications||[]).filter(n=>n.userId===req.user.id).slice(0,20),version:db.processEvents?.[0]?.id||null});});
app.get('/api/me', auth, (req,res) => res.json(req.user));

app.get('/api/dashboard', auth, (req,res) => {
  const db = loadDb();
  const user = req.user;
  if (user.role === 'OWNER') {
    const baseCurrency=db.organization?.baseCurrency||'SGD';
    const monthlyRent = db.leases.reduce((s,l)=>s+(convertMoney(db,l.monthlyRent,l.currency||baseCurrency,baseCurrency)||0),0);
    const monthlyOpex = db.sites.reduce((s,x)=>s+(convertMoney(db,x.monthlyOpex,x.currency||baseCurrency,baseCurrency)||0),0);
    const utilities=utilityAnalytics(db);
    const utilityContribution=utilities.utilityMargin;
    const noi = monthlyRent - monthlyOpex + utilityContribution;
    const portfolioValue = 3100000;
    const annualRoi = Math.round((noi * 12 / portfolioValue) * 1000) / 10;
    const upcoming = db.leases.filter(l => (new Date(l.end)-new Date())/86400000 <= 90).length;
    return res.json({
      role:'OWNER', baseCurrency, metrics:{ sites:db.sites.length, warehouses:db.warehouses.length, occupancy:Math.round(db.sites.reduce((s,x)=>s+x.occupancyPct,0)/db.sites.length), monthlyRent, monthlyOpex, noi, annualRoi, expiringLeases:upcoming, utilityMargin:utilities.utilityMargin, electricityKwh:utilities.electricityKwh, waterM3:utilities.waterM3 },
      advancedKpis:operationalKpis(db), utilities,
      deliveries:db.deliveries.slice(0,5), incidents:db.incidents.slice(0,5), leases:db.leases.slice(0,5), notifications:db.notifications.filter(n=>n.userId===user.id).slice(0,5)
    });
  }
  if (user.role === 'TENANT') {
    const inv = db.inventory.filter(i=>i.tenantId===user.tenantId);
    const lowStock = inv.filter(i=>i.qty<=i.reorderPoint);
    const dels = db.deliveries.filter(d=>d.tenantId===user.tenantId);
    return res.json({ role:'TENANT', metrics:{ skuLines:inv.length, lowStock:lowStock.length, activeDeliveries:dels.filter(d=>!['DELIVERED','CANCELLED'].includes(d.status)).length, stores:db.stores.filter(s=>s.tenantId===user.tenantId).length }, inventory:inv, deliveries:dels, lowStock });
  }
  if (user.role === 'DRIVER') {
    const driver = db.drivers.find(d=>d.userId===user.id);
    const dels = db.deliveries.filter(d=>d.driverId===driver?.id || d.standbyDriverId===driver?.id);
    const routeRuns=(db.routeRuns||[]).filter(r=>[r.primaryDriverId,r.standbyDriverId,r.activeDriverId].includes(driver?.id)).map(r=>enrichRoute(db,r));
    return res.json({ role:'DRIVER', driver, metrics:{ assigned:dels.filter(d=>d.status==='ASSIGNED').length, inTransit:dels.filter(d=>d.status==='IN_TRANSIT').length, completed:dels.filter(d=>d.status==='DELIVERED').length, activeRoutes:routeRuns.filter(r=>['ASSIGNED','IN_PROGRESS'].includes(r.status)).length }, deliveries:dels, routeRuns, availabilityRequests:(db.driverAvailabilityRequests||[]).filter(x=>x.driverId===driver?.id), notifications:db.notifications.filter(n=>n.userId===user.id) });
  }
  const openTasks = db.tasks.filter(t=>t.status==='OPEN').length;
  res.json({ role:'WAREHOUSE_MANAGER', metrics:{ openTasks, deliveries:db.deliveries.length, incidents:db.incidents.filter(i=>i.status!=='CLOSED').length, warehouseCount:db.warehouses.length }, deliveries:db.deliveries, tasks:db.tasks, incidents:db.incidents });
});

function seededNoise(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function utilityTrend(db, warehouseId='ALL', granularity='monthly') {
  const rows=(db.utilityReadings||[]).filter(r=>warehouseId==='ALL'||r.warehouseId===warehouseId);
  const totalsByMonth=new Map();
  for(const r of rows){
    const cur=totalsByMonth.get(r.period)||{electricityKwh:0,waterM3:0};
    cur.electricityKwh += Number(r.electricityKwh||0);
    cur.waterM3 += Number(r.waterM3||0);
    totalsByMonth.set(r.period,cur);
  }
  const months=[...totalsByMonth.keys()].sort();
  if(!months.length) return [];
  const latest=months[months.length-1], latestTotals=totalsByMonth.get(latest);
  const [year,month]=latest.split('-').map(Number);
  const whSeed=warehouseId==='ALL'?1:Math.max(1,[...warehouseId].reduce((sum,c)=>sum+c.charCodeAt(0),0));
  const split=(count,labelFn)=>Array.from({length:count},(_,i)=>{
    const eFactor=.78+seededNoise(whSeed+i)*.44;
    const wFactor=.80+seededNoise(whSeed+i+200)*.40;
    return {period:labelFn(i),electricityKwh:Math.round(latestTotals.electricityKwh/count*eFactor*10)/10,waterM3:Math.round(latestTotals.waterM3/count*wFactor*100)/100};
  });
  if(granularity==='hourly') return split(24,i=>`${String(i).padStart(2,'0')}:00`);
  if(granularity==='daily') {
    const days=new Date(year,month,0).getDate();
    const labelMonth=new Date(year,month-1,1).toLocaleString('en',{month:'short'});
    return split(days,i=>`${String(i+1).padStart(2,'0')} ${labelMonth}`);
  }
  if(granularity==='weekly') return split(12,i=>`Week ${i+1}`);
  if(granularity==='yearly') {
    const out=[];
    for(let y=year-4;y<=year;y++){
      const scale=.82+(y-(year-4))*.045;
      out.push({period:String(y),electricityKwh:Math.round(latestTotals.electricityKwh*12*scale),waterM3:Math.round(latestTotals.waterM3*12*scale*.97)});
    }
    return out;
  }
  return months.map(period=>({period,...totalsByMonth.get(period)}));
}

app.get('/api/utilities/overview', auth, role('OWNER','WAREHOUSE_MANAGER'), (req,res)=>{
  const db=loadDb();
  const warehouseId=req.query.warehouseId||'ALL';
  const requestedGranularity=String(req.query.granularity||'monthly').toLowerCase();
  const granularity=['hourly','daily','weekly','monthly','yearly'].includes(requestedGranularity)?requestedGranularity:'monthly';
  const analytics=utilityAnalytics(db);
  const trend=utilityTrend(db,warehouseId,granularity);
  const warehouses=db.warehouses.map(w=>{
    const latest=[...(db.utilityReadings||[])].filter(r=>r.warehouseId===w.id).sort((a,b)=>String(b.period).localeCompare(String(a.period)))[0];
    const e=(db.utilityTariffs||[]).find(t=>t.warehouseId===w.id&&t.utility==='ELECTRICITY'&&t.active);
    const wa=(db.utilityTariffs||[]).find(t=>t.warehouseId===w.id&&t.utility==='WATER'&&t.active);
    const supplierCost=Number(latest?.electricityKwh||0)*Number(e?.baseRate||0)+Number(latest?.waterM3||0)*Number(wa?.baseRate||0);
    const tenantBilling=Number(latest?.electricityKwh||0)*Number(e?.finalRate||0)+Number(latest?.waterM3||0)*Number(wa?.finalRate||0);
    return {...w,electricityKwh:latest?.electricityKwh||0,waterM3:latest?.waterM3||0,peakKw:latest?.peakKw||0,supplierCost,tenantBilling,margin:tenantBilling-supplierCost,electricityTariff:e,waterTariff:wa};
  });
  const selectedWarehouse=warehouseId==='ALL'?null:warehouses.find(w=>w.id===warehouseId)||null;
  res.json({organization:db.organization,currencySettings:db.currencySettings,analytics,trend,granularity,warehouseId,selectedWarehouse,warehouses,meters:db.meters,tariffs:db.utilityTariffs,exchangeRates:db.exchangeRates});
});

app.post('/api/utilities/tariffs', auth, role('OWNER'), (req,res)=>{
  const db=loadDb();
  const {warehouseId,utility,baseRate,markupRate=0,currency,unit,effectiveFrom}=req.body;
  if(!warehouseId||!utility||baseRate==null) return res.status(400).json({error:'warehouseId, utility and baseRate are required'});
  db.utilityTariffs.filter(t=>t.warehouseId===warehouseId&&t.utility===utility).forEach(t=>t.active=false);
  const tariff={id:id('TAR'),warehouseId,utility,currency:currency||db.organization.baseCurrency,unit:unit||(utility==='ELECTRICITY'?'kWh':'m3'),baseRate:Number(baseRate),markupRate:Number(markupRate),finalRate:Number(baseRate)+Number(markupRate),effectiveFrom:effectiveFrom||new Date().toISOString().slice(0,7),active:true,createdAt:new Date().toISOString()};
  db.utilityTariffs.unshift(tariff);
  processEvent(db,{type:'UTILITY_TARIFF_UPDATED',entityType:'WAREHOUSE',entityId:warehouseId,actor:req.user.name,method:'WEB',note:`${utility} tariff set to ${tariff.currency} ${tariff.finalRate}/${tariff.unit}.`});
  saveDb(db); res.status(201).json(tariff);
});

app.post('/api/utilities/readings', auth, role('OWNER','WAREHOUSE_MANAGER'), (req,res)=>{
  const db=loadDb();
  const reading={id:id('READ'),source:'MANUAL',...req.body,recordedAt:new Date().toISOString()};
  db.utilityReadings.unshift(reading); processEvent(db,{type:'METER_READING_RECORDED',entityType:'WAREHOUSE',entityId:reading.warehouseId,actor:req.user.name,method:reading.source||'WEB',note:`Utility reading recorded for ${reading.period}.`}); saveDb(db); res.status(201).json(reading);
});

app.get('/api/currency', auth, (req,res)=>{const db=loadDb();res.json({organization:db.organization,settings:db.currencySettings,rates:db.exchangeRates});});
app.post('/api/currency/settings', auth, role('OWNER'), (req,res)=>{
  const db=loadDb(); const {baseCurrency,reportingCurrency,autoFx}=req.body;
  if(baseCurrency) db.organization.baseCurrency=String(baseCurrency).toUpperCase();
  if(reportingCurrency) db.organization.reportingCurrency=String(reportingCurrency).toUpperCase();
  if(autoFx!=null) db.currencySettings.autoFx=!!autoFx;
  db.currencySettings.baseCurrency=db.organization.baseCurrency;
  saveDb(db); res.json({organization:db.organization,settings:db.currencySettings});
});
app.post('/api/currency/rates', auth, role('OWNER'), (req,res)=>{
  const db=loadDb(); const {base,quote,rate,source='MANUAL'}=req.body;
  if(!base||!quote||!rate) return res.status(400).json({error:'base, quote and rate required'});
  db.exchangeRates=db.exchangeRates.filter(r=>!(r.base===base&&r.quote===quote));
  const row={base:String(base).toUpperCase(),quote:String(quote).toUpperCase(),rate:Number(rate),source,effectiveAt:new Date().toISOString()}; db.exchangeRates.unshift(row); db.currencySettings.fxLastUpdated=row.effectiveAt; saveDb(db); res.status(201).json(row);
});
app.get('/api/currency/convert', auth, (req,res)=>{
  const db=loadDb(); const amount=Number(req.query.amount||0),from=String(req.query.from||db.organization.baseCurrency).toUpperCase(),to=String(req.query.to||db.organization.baseCurrency).toUpperCase(); const rate=getFxRate(db,from,to); if(rate==null)return res.status(422).json({error:'FX rate unavailable'}); res.json({amount,from,to,rate,converted:convertMoney(db,amount,from,to)});
});

app.get('/api/dispatch/options', auth, role('OWNER','WAREHOUSE_MANAGER'), (req,res)=>{
  const db=loadDb();
  const drivers=db.drivers.map(d=>({...d,score:Math.max(0,100-(d.currentJobs||0)*12+(d.status==='AVAILABLE'?8:-40)+Math.round((d.rating||4)*2))})).sort((a,b)=>b.score-a.score);
  res.json({drivers,vehicles:db.vehicles});
});
app.patch('/api/deliveries/:id/assign', auth, role('OWNER','WAREHOUSE_MANAGER'), (req,res)=>{
  const db=loadDb(); const d=db.deliveries.find(x=>x.id===req.params.id); if(!d)return res.status(404).json({error:'Delivery not found'});
  d.driverId=req.body.driverId||null; d.vehicleId=req.body.vehicleId||null; d.status=(d.driverId&&d.vehicleId)?'ASSIGNED':'PLANNED';
  processEvent(db,{type:'DELIVERY_ASSIGNED',entityType:'DELIVERY',entityId:d.id,actor:req.user.name,method:'WEB',note:`Driver ${d.driverId||'none'}, vehicle ${d.vehicleId||'none'}.`}); saveDb(db); res.json(d);
});



app.get('/api/simulation/status', auth, role('OWNER','WAREHOUSE_MANAGER'), simulationGuard, (req,res)=>{ const db=loadDb(); res.json({state:getSimulationState(db),feed:(db.simulationFeed||[]).slice(0,40),telemetry:(db.simulationTelemetry||[]).slice(0,80),deliveries:(db.deliveries||[]).filter(x=>x.simulation).slice(0,10)}); });
app.post('/api/simulation/start', auth, role('OWNER','WAREHOUSE_MANAGER'), simulationGuard, (req,res)=>{ const db=loadDb(); const st=getSimulationState(db); if(st.runId) clearSimulationRun(db,st.runId); st.mode=req.body.mode||'DEMO'; st.scenario=req.body.scenario||'NORMAL_DAY'; st.speed=Math.min(60,Math.max(1,Number(req.body.speed||10))); st.tick=0; st.elapsedSimMinutes=0; st.runId=`SIM-${Date.now()}`; st.startedAt=new Date().toISOString(); st.updatedAt=st.startedAt; st.running=true; simFeed(db,'Simulation started',`${st.scenario.replaceAll('_',' ')} · ${st.speed}× speed · ${st.mode} mode.`,'info'); saveDb(db); startSimulationTimer(st.runId); io.emit('simulation-status',st); res.status(201).json(st); });
app.post('/api/simulation/pause', auth, role('OWNER','WAREHOUSE_MANAGER'), simulationGuard, (req,res)=>{ const db=loadDb(); const st=getSimulationState(db); st.running=false; st.updatedAt=new Date().toISOString(); const t=simulationTimers.get(st.runId); if(t){clearInterval(t);simulationTimers.delete(st.runId);} simFeed(db,'Simulation paused','Live event generation has been paused.','info'); saveDb(db); io.emit('simulation-status',st); res.json(st); });
app.post('/api/simulation/resume', auth, role('OWNER','WAREHOUSE_MANAGER'), simulationGuard, (req,res)=>{ const db=loadDb(); const st=getSimulationState(db); if(!st.runId)return res.status(400).json({error:'No simulation run to resume'}); st.running=true; st.updatedAt=new Date().toISOString(); saveDb(db); startSimulationTimer(st.runId); io.emit('simulation-status',st); res.json(st); });
app.post('/api/simulation/step', auth, role('OWNER','WAREHOUSE_MANAGER'), simulationGuard, (req,res)=>{ const db=loadDb(); const st=getSimulationState(db); if(!st.runId){st.runId=`SIM-${Date.now()}`;st.scenario=req.body.scenario||'NORMAL_DAY';st.speed=Number(req.body.speed||10);st.tick=0;st.running=false;} saveDb(db); const was=st.running; st.running=true; saveDb(db); runSimulationTick(); const db2=loadDb(); db2.simulationState.running=was; saveDb(db2); res.json(db2.simulationState); });
app.post('/api/simulation/reset', auth, role('OWNER','WAREHOUSE_MANAGER'), simulationGuard, (req,res)=>{ const db=loadDb(); const st=getSimulationState(db); const runId=st.runId; const t=simulationTimers.get(runId); if(t){clearInterval(t);simulationTimers.delete(runId);} clearSimulationRun(db,runId); db.simulationState={mode:'DEMO',running:false,scenario:'NORMAL_DAY',speed:10,tick:0,runId:null,startedAt:null,updatedAt:new Date().toISOString(),elapsedSimMinutes:0}; saveDb(db); io.emit('simulation-status',db.simulationState); res.json(db.simulationState); });


// --- Warehouse leasing marketplace, bidding, renewals & tenant announcements ---
app.get('/api/marketplace/warehouses', (req,res)=>{const db=loadDb();res.json((db.warehouses||[]).map(w=>{const site=(db.sites||[]).find(s=>s.id===w.siteId);return {id:w.id,name:w.name,siteName:site?.name||'',address:site?.address||'',areaSqft:w.areaSqft,status:w.status}}));});
app.get('/api/marketplace/listings', (req,res)=>{
  const db=loadDb(), now=Date.now();
  const listings=(db.warehouseListings||[]).filter(x=>x.published&&x.status!=='CLOSED').map(x=>{
    const wh=db.warehouses.find(w=>w.id===x.warehouseId), site=db.sites.find(s=>s.id===wh?.siteId);
    const bids=(db.warehouseBids||[]).filter(b=>b.listingId===x.id&&b.status!=='WITHDRAWN');
    return {...x,warehouseName:wh?.name,siteName:site?.name,address:site?.address,bidCount:bids.length,highestBid:bids.length?Math.max(...bids.map(b=>Number(b.amount||0))):null,phase:now<new Date(x.bidStart).getTime()?'UPCOMING':now>new Date(x.bidEnd).getTime()?'ENDED':'OPEN'};
  }); res.json(listings);
});
app.post('/api/marketplace/listings', auth, role('OWNER'), (req,res)=>{const db=loadDb();const x={id:id('LIST'),status:'OPEN',published:true,media:[],createdAt:new Date().toISOString(),...req.body,minimumBid:Number(req.body.minimumBid||0),availableSqft:Number(req.body.availableSqft||0)};db.warehouseListings=(db.warehouseListings||[]);db.warehouseListings.unshift(x);processEvent(db,{type:'WAREHOUSE_LISTING_PUBLISHED',entityType:'WAREHOUSE_LISTING',entityId:x.id,actor:req.user.name,method:'WEB',note:`Minimum bid ${x.currency} ${x.minimumBid}.`});saveDb(db);res.status(201).json(x)});
app.patch('/api/marketplace/listings/:id', auth, role('OWNER'), (req,res)=>{const db=loadDb();const x=(db.warehouseListings||[]).find(v=>v.id===req.params.id);if(!x)return res.status(404).json({error:'Listing not found'});Object.assign(x,req.body);saveDb(db);res.json(x)});
app.post('/api/marketplace/listings/:id/media', auth, role('OWNER'), upload.single('file'), (req,res)=>{const db=loadDb();const x=(db.warehouseListings||[]).find(v=>v.id===req.params.id);if(!x)return res.status(404).json({error:'Listing not found'});if(!req.file)return res.status(400).json({error:'File required'});const m={id:id('MEDIA'),type:req.body.type||'PHOTO',url:`/uploads/${req.file.filename}`,caption:req.body.caption||req.file.originalname,uploadedAt:new Date().toISOString()};x.media=x.media||[];x.media.push(m);saveDb(db);res.status(201).json(m)});
app.post('/api/marketplace/listings/:id/bids', (req,res)=>{const db=loadDb();const x=(db.warehouseListings||[]).find(v=>v.id===req.params.id);if(!x||!x.published)return res.status(404).json({error:'Listing not available'});const now=Date.now();if(now<new Date(x.bidStart).getTime()||now>new Date(x.bidEnd).getTime())return res.status(400).json({error:'Bidding is not currently open'});const amount=Number(req.body.amount||0);if(amount<Number(x.minimumBid||0))return res.status(400).json({error:`Bid must be at least ${x.currency} ${x.minimumBid}`});const b={id:id('BID'),listingId:x.id,status:'SUBMITTED',submittedAt:new Date().toISOString(),...req.body,amount};db.warehouseBids=db.warehouseBids||[];db.warehouseBids.unshift(b);saveDb(db);res.status(201).json(b)});
app.get('/api/leasing/owner', auth, role('OWNER'), (req,res)=>{const db=loadDb();res.json({listings:db.warehouseListings||[],bids:db.warehouseBids||[],renewals:db.renewalRequests||[],announcements:db.announcements||[],warehouses:db.warehouses||[]})});
app.patch('/api/leasing/bids/:id/status', auth, role('OWNER'), (req,res)=>{const db=loadDb();const b=(db.warehouseBids||[]).find(x=>x.id===req.params.id);if(!b)return res.status(404).json({error:'Bid not found'});b.status=req.body.status;b.reviewedAt=new Date().toISOString();b.reviewedBy=req.user.name;processEvent(db,{type:`WAREHOUSE_BID_${b.status}`,entityType:'WAREHOUSE_BID',entityId:b.id,actor:req.user.name,method:'WEB',note:req.body.note||''});saveDb(db);res.json(b)});
app.get('/api/leasing/my', auth, role('TENANT'), (req,res)=>{const db=loadDb();const now=Date.now();const leases=(db.leases||[]).filter(x=>x.tenantId===req.user.tenantId).map(x=>({...x,warehouseName:(db.warehouses||[]).find(w=>w.id===x.warehouseId)?.name||x.warehouseId}));res.json({leases,renewals:(db.renewalRequests||[]).filter(x=>x.tenantId===req.user.tenantId),announcements:(db.announcements||[]).filter(a=>a.published&&(!a.endsAt||new Date(a.endsAt).getTime()>=now)&&(a.audience==='ALL_TENANTS'||a.tenantIds?.includes(req.user.tenantId))).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))})});
app.post('/api/leasing/renewals', auth, role('TENANT'), (req,res)=>{const db=loadDb();const lease=(db.leases||[]).find(x=>x.id===req.body.leaseId&&x.tenantId===req.user.tenantId);if(!lease)return res.status(404).json({error:'Lease not found'});const existing=(db.renewalRequests||[]).find(x=>x.leaseId===lease.id&&['SUBMITTED','UNDER_REVIEW'].includes(x.status));if(existing)return res.status(409).json({error:'A renewal request is already pending'});const x={id:id('REN'),leaseId:lease.id,tenantId:req.user.tenantId,status:'SUBMITTED',submittedAt:new Date().toISOString(),requestedMonths:Number(req.body.requestedMonths||12),proposedMonthlyRent:req.body.proposedMonthlyRent||null,currency:lease.currency,notes:req.body.notes||''};db.renewalRequests=db.renewalRequests||[];db.renewalRequests.unshift(x);processEvent(db,{type:'LEASE_RENEWAL_REQUESTED',entityType:'LEASE',entityId:lease.id,actor:req.user.name,method:'WEB',note:`Requested ${x.requestedMonths} month renewal.`});saveDb(db);res.status(201).json(x)});
app.patch('/api/leasing/renewals/:id/status', auth, role('OWNER'), (req,res)=>{const db=loadDb();const x=(db.renewalRequests||[]).find(v=>v.id===req.params.id);if(!x)return res.status(404).json({error:'Renewal request not found'});x.status=req.body.status;x.ownerNote=req.body.ownerNote||'';x.reviewedAt=new Date().toISOString();x.reviewedBy=req.user.name;const tenantUsers=(db.users||[]).filter(u=>u.role==='TENANT'&&u.tenantId===x.tenantId);tenantUsers.forEach(u=>emitNotification(db,u.id,'Lease renewal update',`Your renewal request for ${x.leaseId} was ${String(x.status).toLowerCase().replaceAll('_',' ')}.`,x.status==='APPROVED'?'info':'warning'));processEvent(db,{type:`LEASE_RENEWAL_${x.status}`,entityType:'LEASE',entityId:x.leaseId,actor:req.user.name,method:'WEB',note:x.ownerNote});saveDb(db);res.json(x)});
app.post('/api/announcements', auth, role('OWNER'), (req,res)=>{const db=loadDb();const x={id:id('ANN'),audience:'ALL_TENANTS',priority:'NORMAL',published:true,startsAt:new Date().toISOString(),createdAt:new Date().toISOString(),createdBy:req.user.name,...req.body};db.announcements=db.announcements||[];db.announcements.unshift(x);const users=(db.users||[]).filter(u=>u.role==='TENANT'&&(x.audience==='ALL_TENANTS'||x.tenantIds?.includes(u.tenantId)));users.forEach(u=>emitNotification(db,u.id,x.title,x.message,x.priority==='URGENT'?'urgent':'info'));processEvent(db,{type:'TENANT_ANNOUNCEMENT_PUBLISHED',entityType:'ANNOUNCEMENT',entityId:x.id,actor:req.user.name,method:'WEB',note:x.title});saveDb(db);io.emit('announcement',x);res.status(201).json(x)});

app.get('/api/commercial/overview', auth, role('OWNER'), (req,res)=>{
  const db=loadDb();
  const monthlyRent=(db.leases||[]).reduce((s,x)=>s+Number(x.monthlyRent||0),0);
  const platformMrr=(db.pricingRules||[]).filter(x=>x.active&&x.type==='FIXED_MONTHLY').reduce((s,x)=>s+Number(x.amount||0)*(db.tenants||[]).length,0);
  const availableSqft=(db.rentalRates||[]).filter(x=>x.active).reduce((s,x)=>s+Number(x.availableSqft||0),0);
  res.json({metrics:{monthlyRent,platformMrr,availableSqft,pendingApplications:(db.tenantApplications||[]).filter(x=>!['APPROVED','REJECTED'].includes(x.status)).length},pricingRules:db.pricingRules||[],rentalRates:db.rentalRates||[],applications:db.tenantApplications||[],listings:db.warehouseListings||[],bids:db.warehouseBids||[],renewals:db.renewalRequests||[],announcements:db.announcements||[],warehouses:db.warehouses||[],tenants:db.tenants||[]});
});
app.post('/api/pricing-rules', auth, role('OWNER'), (req,res)=>{const db=loadDb();const x={id:id('FEE'),active:true,effectiveFrom:new Date().toISOString().slice(0,10),...req.body};db.pricingRules.unshift(x);processEvent(db,{type:'PLATFORM_FEE_CREATED',entityType:'PRICING_RULE',entityId:x.id,actor:req.user.name,method:'WEB',note:`${x.name} configured.`});saveDb(db);res.status(201).json(x)});
app.patch('/api/pricing-rules/:id', auth, role('OWNER'), (req,res)=>{const db=loadDb();const x=(db.pricingRules||[]).find(v=>v.id===req.params.id);if(!x)return res.status(404).json({error:'Service charge not found'});Object.assign(x,req.body,{updatedAt:new Date().toISOString(),updatedBy:req.user.id});processEvent(db,{type:'PLATFORM_FEE_UPDATED',entityType:'PRICING_RULE',entityId:x.id,actor:req.user.name,method:'WEB',note:`${x.name} updated.`});saveDb(db);res.json(x)});
app.post('/api/rental-rates', auth, role('OWNER'), (req,res)=>{const db=loadDb();const x={id:id('RENT'),active:true,effectiveFrom:new Date().toISOString().slice(0,10),...req.body,ratePerSqft:Number(req.body.ratePerSqft||0),availableSqft:Number(req.body.availableSqft||0)};db.rentalRates.unshift(x);processEvent(db,{type:'RENTAL_RATE_CREATED',entityType:'WAREHOUSE',entityId:x.warehouseId,actor:req.user.name,method:'WEB',note:`Rental rate ${x.currency} ${x.ratePerSqft}/sqft configured.`});saveDb(db);res.status(201).json(x)});
app.patch('/api/rental-rates/:id', auth, role('OWNER'), (req,res)=>{const db=loadDb();const x=(db.rentalRates||[]).find(v=>v.id===req.params.id);if(!x)return res.status(404).json({error:'Rental rate not found'});Object.assign(x,req.body,{ratePerSqft:Number(req.body.ratePerSqft??x.ratePerSqft),availableSqft:Number(req.body.availableSqft??x.availableSqft),updatedAt:new Date().toISOString(),updatedBy:req.user.id});processEvent(db,{type:'RENTAL_RATE_UPDATED',entityType:'WAREHOUSE',entityId:x.warehouseId,actor:req.user.name,method:'WEB',note:`Rental rate updated.`});saveDb(db);res.json(x)});
app.post('/api/tenant-applications', (req,res)=>{const db=loadDb();const x={id:id('APP'),status:'SUBMITTED',submittedAt:new Date().toISOString(),...req.body};db.tenantApplications.unshift(x);saveDb(db);res.status(201).json(x)});
app.patch('/api/tenant-applications/:id/status', auth, role('OWNER'), (req,res)=>{const db=loadDb();const x=db.tenantApplications.find(a=>a.id===req.params.id);if(!x)return res.status(404).json({error:'Application not found'});x.status=req.body.status||x.status;x.reviewedAt=new Date().toISOString();x.reviewedBy=req.user.name;processEvent(db,{type:`TENANT_APPLICATION_${x.status}`,entityType:'TENANT_APPLICATION',entityId:x.id,actor:req.user.name,method:'WEB',note:req.body.note||'Application status updated.'});saveDb(db);res.json(x)});
app.get('/api/freight/overview', auth, (req,res)=>{const db=loadDb();res.json({jobs:scopeRows(db,req.user,'freightJobs'),cargoProfiles:db.cargoProfiles||[],metrics:{air:(db.freightJobs||[]).filter(x=>x.mode==='AIR').length,sea:(db.freightJobs||[]).filter(x=>x.mode==='SEA').length,fragile:(db.freightJobs||[]).filter(x=>x.cargoClass==='FRAGILE').length,customsPending:(db.freightJobs||[]).filter(x=>!['CLEARED','NOT_REQUIRED'].includes(x.customsStatus)).length}})});
app.post('/api/freight-jobs', auth, role('OWNER','TENANT','WAREHOUSE_MANAGER'), (req,res)=>{const db=loadDb();const x={id:id('FRT'),status:'PLANNED',documents:[],...req.body};if(req.user.role==='TENANT')x.tenantId=req.user.tenantId;db.freightJobs.unshift(x);processEvent(db,{type:'FREIGHT_JOB_CREATED',entityType:'FREIGHT',entityId:x.id,actor:req.user.name,method:'WEB',note:`${x.mode} freight job created.`});saveDb(db);res.status(201).json(x)});

// --- Multi-stop route runs, GPS tracking and standby drivers -----------------
app.get('/api/route-runs', auth, (req,res)=>{
  const db=loadDb(); const rows=(db.routeRuns||[]).filter(r=>routeVisibleToUser(db,req.user,r)).map(r=>enrichRoute(db,r)); res.json(rows);
});
app.post('/api/route-runs', auth, role('OWNER','WAREHOUSE_MANAGER'), (req,res)=>{
  const db=loadDb(); const stops=(req.body.stops||[]).map((x,i)=>({id:x.id||id('STOP'),sequence:i+1,status:'PENDING',deliveryIds:[],...x}));
  const run={id:id('RUN'),name:req.body.name||'Delivery Run',tenantId:req.body.tenantId||null,scheduledAt:req.body.scheduledAt||new Date().toISOString(),status:'PLANNED',primaryDriverId:req.body.primaryDriverId||null,standbyDriverId:req.body.standbyDriverId||null,standbyApproved:false,activeDriverId:req.body.primaryDriverId||null,vehicleId:req.body.vehicleId||null,trackingStatus:'OFFLINE',lastLocation:null,currentStopIndex:0,routePolicy:{requireStandby:true,allowAutoGeofenceArrival:true,...req.body.routePolicy},stops};
  db.routeRuns=db.routeRuns||[]; db.routeRuns.unshift(run); processEvent(db,{type:'ROUTE_RUN_CREATED',entityType:'ROUTE_RUN',entityId:run.id,actor:req.user.name,method:'WEB',note:`${run.name} with ${stops.length} stops created.`}); saveDb(db); res.status(201).json(enrichRoute(db,run));
});
app.patch('/api/route-runs/:id/dispatch', auth, role('OWNER','WAREHOUSE_MANAGER'), (req,res)=>{
  const db=loadDb(); const run=(db.routeRuns||[]).find(r=>r.id===req.params.id); if(!run)return res.status(404).json({error:'Route run not found'});
  if(req.body.primaryDriverId!==undefined) run.primaryDriverId=req.body.primaryDriverId||null;
  if(req.body.standbyDriverId!==undefined){run.standbyDriverId=req.body.standbyDriverId||null;run.standbyApproved=false;}
  if(req.body.vehicleId!==undefined) run.vehicleId=req.body.vehicleId||null;
  if(req.body.approveStandby===true){ if(!run.standbyDriverId)return res.status(400).json({error:'Select a standby driver first'}); run.standbyApproved=true;run.standbyApprovedBy=req.user.name;run.standbyApprovedAt=new Date().toISOString(); }
  run.activeDriverId=run.activeDriverId||run.primaryDriverId; run.status=(run.primaryDriverId&&run.vehicleId&&(!run.routePolicy?.requireStandby||(run.standbyDriverId&&run.standbyApproved)))?'ASSIGNED':'PLANNED';
  for(const d of (db.deliveries||[]).filter(d=>d.routeRunId===run.id)){d.driverId=run.primaryDriverId;d.standbyDriverId=run.standbyDriverId;d.vehicleId=run.vehicleId;if(d.status==='PLANNED')d.status=run.status;}
  processEvent(db,{type:'ROUTE_DISPATCH_UPDATED',entityType:'ROUTE_RUN',entityId:run.id,actor:req.user.name,method:'WEB',note:`Primary ${run.primaryDriverId||'-'}, standby ${run.standbyDriverId||'-'}, vehicle ${run.vehicleId||'-'}.`});saveDb(db);res.json(enrichRoute(db,run));
});
app.post('/api/route-runs/:id/start', auth, (req,res)=>{
  const db=loadDb(); const run=(db.routeRuns||[]).find(r=>r.id===req.params.id); if(!run)return res.status(404).json({error:'Route run not found'}); if(!routeVisibleToUser(db,req.user,run))return res.status(403).json({error:'Forbidden'});
  const driver=driverForUser(db,req.user); if(req.user.role==='DRIVER'&&run.activeDriverId!==driver?.id)return res.status(403).json({error:'Only the active driver can start this route'});
  if(run.routePolicy?.requireStandby&&(!run.standbyDriverId||!run.standbyApproved)) return res.status(409).json({error:'Approved standby driver required before route can start'});
  const pickup=(run.stops||[]).find(s=>s.type==='PICKUP'&&!['COMPLETED','SKIPPED'].includes(s.status)); if(pickup){pickup.status='COMPLETED';pickup.completedAt=new Date().toISOString();pickup.completedBy=req.user.name;}
  run.status='IN_PROGRESS';run.startedAt=run.startedAt||new Date().toISOString();run.trackingStartedAt=new Date().toISOString();run.trackingStatus='STARTING';run.currentStopIndex=Math.max(0,(run.stops||[]).findIndex(s=>!['COMPLETED','SKIPPED'].includes(s.status)));
  if(req.body.latitude!=null&&req.body.longitude!=null)run.lastLocation={latitude:Number(req.body.latitude),longitude:Number(req.body.longitude),accuracy:req.body.accuracy??null,timestamp:new Date().toISOString(),source:'DRIVER_PHONE'};
  for(const d of (db.deliveries||[]).filter(d=>d.routeRunId===run.id&&!['DELIVERED','CANCELLED'].includes(d.status))) d.status='IN_TRANSIT';
  processEvent(db,{type:'ROUTE_STARTED',entityType:'ROUTE_RUN',entityId:run.id,actor:req.user.name,method:'MOBILE',note:'Pickup confirmed once; all route cargo moved to in transit.'});saveDb(db);io.emit('route-updated',enrichRoute(db,run));res.json(enrichRoute(db,run));
});
app.post('/api/route-runs/:id/location', auth, role('DRIVER'), (req,res)=>{
  const db=loadDb(); const run=(db.routeRuns||[]).find(r=>r.id===req.params.id); const driver=driverForUser(db,req.user); if(!run)return res.status(404).json({error:'Route run not found'}); if(run.activeDriverId!==driver?.id)return res.status(403).json({error:'Not active driver'});
  const {latitude,longitude,accuracy,speed,heading}=req.body;if(latitude==null||longitude==null)return res.status(400).json({error:'latitude and longitude required'});
  run.lastLocation={latitude:Number(latitude),longitude:Number(longitude),accuracy:accuracy??null,speed:speed??null,heading:heading??null,timestamp:new Date().toISOString(),source:'DRIVER_PHONE'};run.trackingStatus='LIVE';
  const stop=nextRouteStop(run); const distance=haversineMeters(run.lastLocation,stop); if(stop&&run.routePolicy?.allowAutoGeofenceArrival&&['DELIVERY','RETURN','PICKUP'].includes(stop.type)&&distance!=null&&distance<=150&&stop.status==='PENDING'){stop.status='ARRIVED';stop.arrivedAt=new Date().toISOString();processEvent(db,{type:'ROUTE_STOP_GEOFENCE_ARRIVAL',entityType:'ROUTE_RUN',entityId:run.id,actor:'system',method:'GPS',note:`${stop.name} detected within ${Math.round(distance)}m.`});}
  saveDb(db);io.emit('route-location',{routeRunId:run.id,lastLocation:run.lastLocation,trackingStatus:'LIVE',nextStopId:stop?.id||null});res.json({ok:true,trackingStatus:'LIVE',distanceToNextStopMeters:distance==null?null:Math.round(distance),nextStop:stop||null});
});
app.post('/api/route-runs/:id/stops/:stopId/signoff', auth, (req,res)=>{
  const db=loadDb();const run=(db.routeRuns||[]).find(r=>r.id===req.params.id);if(!run)return res.status(404).json({error:'Route run not found'});if(!routeVisibleToUser(db,req.user,run))return res.status(403).json({error:'Forbidden'});const stop=(run.stops||[]).find(s=>s.id===req.params.stopId);if(!stop)return res.status(404).json({error:'Stop not found'});
  const current=nextRouteStop(run);if(current?.id!==stop.id)return res.status(409).json({error:`Complete the current stop first (${current?.name||'none'})`});if(stop.type!=='DELIVERY')return res.status(409).json({error:'Receiver sign-off is only valid for delivery stops'});
  const {receiverName,remarks,signatureDataUrl,latitude,longitude}=req.body;if(!receiverName||!signatureDataUrl)return res.status(400).json({error:'Receiver name and signature are required'});const signaturePath=saveDataUrl(signatureDataUrl,`route-${run.id}-${stop.id}`);if(!signaturePath)return res.status(400).json({error:'Signature must be PNG or JPEG data'});
  const signedAt=new Date().toISOString();for(const deliveryId of (stop.deliveryIds||[])){const d=(db.deliveries||[]).find(x=>x.id===deliveryId);if(!d)continue;const sys=deliverySystemFields(db,d);d.receiverSignoff={receiverName,remarks:remarks||'',signaturePath,signedAt,latitude:latitude??null,longitude:longitude??null,signedByUserId:req.user.id,routeRunId:run.id,routeStopId:stop.id,systemCompany:sys.companyName,systemStore:sys.storeName,systemReferenceId:sys.referenceId};d.status='DELIVERED';queuePodDistribution(db,d,signedAt);processEvent(db,{type:'DELIVERY_RECEIVER_SIGNED',entityType:'DELIVERY',entityId:d.id,actor:receiverName,method:'MOBILE_SIGNATURE',note:`Completed at route stop ${stop.sequence}.`});}
  stop.status='COMPLETED';stop.completedAt=signedAt;stop.completedBy=req.user.name;run.currentStopIndex=Math.max(0,(run.stops||[]).findIndex(s=>!['COMPLETED','SKIPPED'].includes(s.status)));const next=nextRouteStop(run);if(!next){run.status='COMPLETED';run.completedAt=signedAt;run.trackingStatus='STOPPED';run.trackingStoppedAt=signedAt;}processEvent(db,{type:'ROUTE_STOP_COMPLETED',entityType:'ROUTE_RUN',entityId:run.id,actor:req.user.name,method:'MOBILE_SIGNATURE',note:`Stop ${stop.sequence} ${stop.name} completed.`});saveDb(db);io.emit('route-updated',enrichRoute(db,run));res.json(enrichRoute(db,run));
});
app.post('/api/route-runs/:id/stops/:stopId/complete', auth, (req,res)=>{
  const db=loadDb();const run=(db.routeRuns||[]).find(r=>r.id===req.params.id);if(!run)return res.status(404).json({error:'Route run not found'});if(!routeVisibleToUser(db,req.user,run))return res.status(403).json({error:'Forbidden'});const stop=(run.stops||[]).find(s=>s.id===req.params.stopId);if(!stop)return res.status(404).json({error:'Stop not found'});const current=nextRouteStop(run);if(current?.id!==stop.id)return res.status(409).json({error:`Complete the current stop first (${current?.name||'none'})`});if(stop.type==='DELIVERY')return res.status(409).json({error:'Delivery stops require receiver sign-off'});stop.status='COMPLETED';stop.completedAt=new Date().toISOString();stop.completedBy=req.user.name;run.currentStopIndex=Math.max(0,(run.stops||[]).findIndex(s=>!['COMPLETED','SKIPPED'].includes(s.status)));if(!nextRouteStop(run)){run.status='COMPLETED';run.completedAt=new Date().toISOString();run.trackingStatus='STOPPED';run.trackingStoppedAt=run.completedAt;}processEvent(db,{type:'ROUTE_STOP_COMPLETED',entityType:'ROUTE_RUN',entityId:run.id,actor:req.user.name,method:req.body.method||'MOBILE',note:req.body.note||`${stop.type} stop completed.`});saveDb(db);res.json(enrichRoute(db,run));
});
app.post('/api/route-runs/:id/activate-standby', auth, role('OWNER','WAREHOUSE_MANAGER'), (req,res)=>{
  const db=loadDb();const run=(db.routeRuns||[]).find(r=>r.id===req.params.id);if(!run)return res.status(404).json({error:'Route run not found'});if(!run.standbyDriverId||!run.standbyApproved)return res.status(409).json({error:'No approved standby driver available'});const old=run.activeDriverId;run.activeDriverId=run.standbyDriverId;run.replacementActivatedAt=new Date().toISOString();run.replacementApprovedBy=req.user.name;for(const d of (db.deliveries||[]).filter(d=>d.routeRunId===run.id&&!['DELIVERED','CANCELLED'].includes(d.status)))d.driverId=run.activeDriverId;const standby=(db.drivers||[]).find(d=>d.id===run.activeDriverId);if(standby?.userId)emitNotification(db,standby.userId,'Replacement route activated',`${run.id}: you are now the active driver. Review the remaining stops before driving.`,'warning');processEvent(db,{type:'STANDBY_DRIVER_ACTIVATED',entityType:'ROUTE_RUN',entityId:run.id,actor:req.user.name,method:'WEB',note:`Active driver changed from ${old} to ${run.activeDriverId}.`});saveDb(db);res.json(enrichRoute(db,run));
});
app.get('/api/driver/availability', auth, (req,res)=>{const db=loadDb();const driver=driverForUser(db,req.user);if(req.user.role==='DRIVER')return res.json((db.driverAvailabilityRequests||[]).filter(x=>x.driverId===driver?.id));if(['OWNER','WAREHOUSE_MANAGER'].includes(req.user.role))return res.json(db.driverAvailabilityRequests||[]);res.status(403).json({error:'Forbidden'});});
app.post('/api/driver/availability', auth, role('DRIVER'), upload.single('document'), (req,res)=>{const db=loadDb();const driver=driverForUser(db,req.user);if(!driver)return res.status(404).json({error:'Driver profile not found'});const x={id:id('AVL'),driverId:driver.id,type:req.body.type||'LEAVE',start:req.body.start,end:req.body.end||req.body.start,status:'SUBMITTED',reason:req.body.reason||'',submittedAt:new Date().toISOString(),documentPath:req.file?`/uploads/${req.file.filename}`:null};db.driverAvailabilityRequests=db.driverAvailabilityRequests||[];db.driverAvailabilityRequests.unshift(x);const affected=(db.routeRuns||[]).filter(r=>r.primaryDriverId===driver.id&&['PLANNED','ASSIGNED','IN_PROGRESS'].includes(r.status));const owner=(db.users||[]).find(u=>u.role==='OWNER');if(owner)emitNotification(db,owner.id,'Driver availability request',`${driver.name} submitted ${x.type}. ${affected.length} route(s) may require standby review.`,'warning');processEvent(db,{type:'DRIVER_AVAILABILITY_SUBMITTED',entityType:'DRIVER',entityId:driver.id,actor:req.user.name,method:'MOBILE',note:`${x.type} from ${x.start} to ${x.end}.`});saveDb(db);res.status(201).json({...x,affectedRouteIds:affected.map(r=>r.id)});});
app.patch('/api/driver/availability/:id/status', auth, role('OWNER','WAREHOUSE_MANAGER'), (req,res)=>{const db=loadDb();const x=(db.driverAvailabilityRequests||[]).find(v=>v.id===req.params.id);if(!x)return res.status(404).json({error:'Availability request not found'});x.status=req.body.status;x.reviewedAt=new Date().toISOString();x.reviewedBy=req.user.name;x.reviewNote=req.body.reviewNote||'';const drv=(db.drivers||[]).find(d=>d.id===x.driverId);if(drv?.userId)emitNotification(db,drv.userId,'Availability request updated',`${x.type} request is ${String(x.status).toLowerCase().replaceAll('_',' ')}.`,'info');saveDb(db);res.json(x);});

for (const key of ['sites','warehouses','tenants','leases','utilityBills','utilityTariffs','utilityReadings','meters','stores','inventory','vehicles','drivers','deliveries','freightJobs','cargoProfiles','pricingRules','rentalRates','tenantApplications','incidents','invoices','tasks','processEvents','notifications','locationContacts','documentDistributions']) {
  app.get(`/api/${key}`, auth, (req,res)=>res.json(scopeRows(loadDb(), req.user, key)));
}


app.get('/api/pod-contacts', auth, (req,res)=>{
  const db=loadDb(); let contacts=db.locationContacts||[]; let stores=db.stores||[];
  if(req.user.role==='TENANT'){contacts=contacts.filter(c=>c.tenantId===req.user.tenantId);stores=stores.filter(x=>x.tenantId===req.user.tenantId);} else if(!['OWNER','WAREHOUSE_MANAGER'].includes(req.user.role)) return res.status(403).json({error:'Forbidden'});
  res.json({contacts,stores,tenants:(db.tenants||[]).filter(t=>req.user.role==='TENANT'?t.id===req.user.tenantId:true)});
});
app.post('/api/pod-contacts', auth, role('OWNER','TENANT','WAREHOUSE_MANAGER'), (req,res)=>{
  const db=loadDb(); const tenantId=req.user.role==='TENANT'?req.user.tenantId:req.body.tenantId; if(!tenantId)return res.status(400).json({error:'tenantId is required'});
  if(req.body.storeId){const store=(db.stores||[]).find(s=>s.id===req.body.storeId);if(!store||store.tenantId!==tenantId)return res.status(400).json({error:'Store does not belong to tenant'});}
  if(!req.body.name||(!req.body.email&&!req.body.phone))return res.status(400).json({error:'Name and email or phone are required'});
  const x={id:id('LC'),tenantId,storeId:req.body.storeId||null,name:req.body.name,email:req.body.email||'',phone:req.body.phone||'',role:req.body.role||'RECEIVING',receivePod:req.body.receivePod!==false,receiveAlerts:req.body.receiveAlerts===true,active:req.body.active!==false,createdAt:new Date().toISOString()};db.locationContacts=db.locationContacts||[];db.locationContacts.push(x);saveDb(db);res.status(201).json(x);
});
app.patch('/api/pod-contacts/:id', auth, role('OWNER','TENANT','WAREHOUSE_MANAGER'), (req,res)=>{
  const db=loadDb();const x=(db.locationContacts||[]).find(c=>c.id===req.params.id);if(!x)return res.status(404).json({error:'Contact not found'});if(req.user.role==='TENANT'&&x.tenantId!==req.user.tenantId)return res.status(403).json({error:'Forbidden'});Object.assign(x,Object.fromEntries(Object.entries(req.body).filter(([k])=>['name','email','phone','role','receivePod','receiveAlerts','active','storeId'].includes(k))));saveDb(db);res.json(x);
});
app.delete('/api/pod-contacts/:id', auth, role('OWNER','TENANT','WAREHOUSE_MANAGER'), (req,res)=>{
  const db=loadDb();const x=(db.locationContacts||[]).find(c=>c.id===req.params.id);if(!x)return res.status(404).json({error:'Contact not found'});if(req.user.role==='TENANT'&&x.tenantId!==req.user.tenantId)return res.status(403).json({error:'Forbidden'});x.active=false;saveDb(db);res.json({ok:true});
});
app.get('/api/pod-distributions', auth, (req,res)=>{const db=loadDb();let rows=db.documentDistributions||[];if(req.user.role==='TENANT')rows=rows.filter(x=>x.tenantId===req.user.tenantId);else if(!['OWNER','WAREHOUSE_MANAGER'].includes(req.user.role))return res.status(403).json({error:'Forbidden'});res.json(rows);});
app.post('/api/pod-distributions/:id/retry', auth, role('OWNER','TENANT','WAREHOUSE_MANAGER'), (req,res)=>{const db=loadDb();const x=(db.documentDistributions||[]).find(r=>r.id===req.params.id);if(!x)return res.status(404).json({error:'Distribution not found'});if(req.user.role==='TENANT'&&x.tenantId!==req.user.tenantId)return res.status(403).json({error:'Forbidden'});x.status='QUEUED';x.error=null;x.lastAttemptAt=new Date().toISOString();x.attempts=Number(x.attempts||0)+1;saveDb(db);res.json(x);});

app.post('/api/deliveries', auth, role('OWNER','TENANT','WAREHOUSE_MANAGER'), (req,res) => {
  const db=loadDb();
  const delivery={ id:id('DEL'), status:'PLANNED', priority:'NORMAL', proofPhoto:null, ...req.body };
  if (req.user.role==='TENANT') delivery.tenantId=req.user.tenantId;
  db.deliveries.unshift(delivery);
  processEvent(db,{type:'DELIVERY_CREATED',entityType:'DELIVERY',entityId:delivery.id,actor:req.user.name,method:'WEB',note:'Delivery order created.'});
  saveDb(db); res.status(201).json(delivery);
});

app.patch('/api/deliveries/:id/status', auth, (req,res) => {
  const db=loadDb(); const d=db.deliveries.find(x=>x.id===req.params.id); if(!d)return res.status(404).json({error:'Delivery not found'}); if(!assertTenantAccess(req,res,d.tenantId))return;
  const next=String(req.body.status||'').toUpperCase(), current=String(d.status||'PLANNED').toUpperCase(); const allowed=DELIVERY_TRANSITIONS[current]||[];
  if(!allowed.includes(next))return res.status(409).json({error:`Invalid delivery transition ${current} -> ${next}`});
  if(['DELIVERED','PARTIALLY_DELIVERED'].includes(next))return res.status(409).json({error:'Use receiver sign-off / stop completion workflow for delivered states'});
  if(['PLANNED','ASSIGNED','CANCELLED','CLOSED'].includes(next)&&!['OWNER','WAREHOUSE_MANAGER'].includes(req.user.role))return res.status(403).json({error:'Manager approval required for this transition'});
  d.status=next; processEvent(db,{type:`DELIVERY_${next}`,entityType:'DELIVERY',entityId:d.id,actor:req.user.name,method:req.body.method||'WEB',note:req.body.note||`Status changed ${current} -> ${next}`}); saveDb(db); res.json(d);
});

app.post('/api/deliveries/:id/proof', auth, upload.single('photo'), (req,res)=>{
  const db=loadDb();
  const d=db.deliveries.find(x=>x.id===req.params.id);
  if(!d) return res.status(404).json({error:'Delivery not found'});
  if(!req.file) return res.status(400).json({error:'Photo required'});
  d.proofPhoto=`/uploads/${req.file.filename}`;
  processEvent(db,{type:'PROOF_OF_DELIVERY_CAPTURED',entityType:'DELIVERY',entityId:d.id,actor:req.user.name,method:'MOBILE_CAMERA',note:'Proof photo uploaded.'});
  saveDb(db); res.json(d);
});

app.get('/api/qr/:entityType/:entityId', async (req,res)=>{
  const {entityType,entityId}=req.params;
  const action=req.query.action||'VERIFY';
  const payload=`WMS|${entityType.toUpperCase()}|${entityId}|${action}|v1`;
  const png=await QRCode.toBuffer(payload,{width:360,margin:2});
  res.type('png').send(png);
});

app.post('/api/scans', auth, (req,res)=>{
  const { code, method='QR' }=req.body;
  const parts=String(code||'').split('|');
  if(parts[0]!=='WMS' || parts.length<4) return res.status(400).json({error:'Invalid WMS code'});
  const [,entityType,entityId,action]=parts;
  const db=loadDb();
  if(entityType==='DELIVERY') {
    const d=db.deliveries.find(x=>x.id===entityId);
    if(!d) return res.status(404).json({error:'Delivery not found'});
    const map={PICKUP:'PICKED_UP',DEPART:'IN_TRANSIT',ARRIVE:'ARRIVED',DELIVER:'DELIVERED',VERIFY:'VERIFIED'};
    if(map[action]) d.status=map[action];
    processEvent(db,{type:`SCAN_${action}`,entityType,entityId,actor:req.user.name,method,note:`${method} scan completed. ${map[action] ? `Delivery status => ${map[action]}.` : ''}`});
    saveDb(db); return res.json({ok:true, entity:d, action});
  }
  processEvent(db,{type:`SCAN_${action}`,entityType,entityId,actor:req.user.name,method,note:`${method} scan recorded.`});
  saveDb(db); res.json({ok:true, entityType,entityId,action});
});

app.post('/api/rfid/events', auth, role('OWNER','WAREHOUSE_MANAGER'), (req,res)=>{
  const db=loadDb();
  const { tagId, readerId, entityType='INVENTORY', entityId, action='SEEN' }=req.body;
  processEvent(db,{type:`RFID_${action}`,entityType,entityId:entityId||tagId,actor:readerId||req.user.name,method:'RFID',note:`RFID tag ${tagId} observed by ${readerId||'reader'}.`});
  saveDb(db); res.status(201).json({ok:true});
});

app.post('/api/incidents', auth, (req,res)=>{
  const db=loadDb();
  const inc={id:id('INC'),status:'OPEN',severity:'MEDIUM',createdAt:new Date().toISOString(),...req.body};
  let rectification='Manual review required.';
  if(inc.type==='VEHICLE_BREAKDOWN') {
    const affected=db.deliveries.find(d=>d.id===inc.entityId);
    const vehicle=db.vehicles.find(v=>v.status==='AVAILABLE' && v.id!==affected?.vehicleId);
    if(affected && vehicle){ affected.vehicleId=vehicle.id; affected.status='REASSIGNED'; rectification=`Automatically reassigned ${affected.id} to backup vehicle ${vehicle.plate}.`; }
  } else if(inc.type==='DRIVER_UNAVAILABLE') {
    const affected=db.deliveries.find(d=>d.id===inc.entityId);
    const driver=db.drivers.find(d=>d.status==='AVAILABLE' && d.id!==affected?.driverId);
    if(affected && driver){ affected.driverId=driver.id; affected.status='REASSIGNED'; rectification=`Automatically reassigned ${affected.id} to ${driver.name}.`; }
  } else if(inc.type==='RETURN_GOODS') {
    const task={id:id('TASK'),type:'RETURN_PROCESSING',status:'OPEN',priority:'HIGH',title:`Process returned goods ${inc.entityId||''}`,assigneeRole:'WAREHOUSE_MANAGER',linkedEntity:inc.entityId,createdAt:new Date().toISOString()}; db.tasks.unshift(task); rectification=`Created return processing task ${task.id}.`;
  } else if(inc.type==='INVENTORY_MISMATCH') {
    const task={id:id('TASK'),type:'RECONCILIATION',status:'OPEN',priority:'HIGH',title:`Reconcile inventory ${inc.entityId||''}`,assigneeRole:'WAREHOUSE_MANAGER',linkedEntity:inc.entityId,createdAt:new Date().toISOString()}; db.tasks.unshift(task); rectification=`Created reconciliation task ${task.id}.`;
  }
  inc.rectification=rectification; inc.status='RECTIFICATION_CREATED'; db.incidents.unshift(inc);
  processEvent(db,{type:'INCIDENT_REPORTED',entityType:'INCIDENT',entityId:inc.id,actor:req.user.name,method:req.body.method||'MOBILE',note:`${inc.type}: ${rectification}`});
  const owner=db.users.find(u=>u.role==='OWNER'); if(owner) emitNotification(db,owner.id,'Incident reported',`${inc.title||inc.type}. ${rectification}`,'warning');
  saveDb(db); res.status(201).json(inc);
});

app.post('/api/inventory/restock-suggest', auth, role('TENANT','OWNER','WAREHOUSE_MANAGER'), (req,res)=>{
  const db=loadDb();
  const tenantId=req.user.role==='TENANT'?req.user.tenantId:req.body.tenantId;
  const lows=db.inventory.filter(i=>i.tenantId===tenantId && i.locationType==='STORE' && i.qty<=i.reorderPoint);
  const suggestions=lows.map(storeItem=>{
    const source=db.inventory.filter(i=>i.tenantId===tenantId && i.locationType==='WAREHOUSE' && i.sku===storeItem.sku).sort((a,b)=>b.qty-a.qty)[0];
    return {sku:storeItem.sku,name:storeItem.name,storeId:storeItem.locationId,currentQty:storeItem.qty,reorderPoint:storeItem.reorderPoint,suggestedQty:Math.max(storeItem.reorderPoint*2-storeItem.qty,0),sourceWarehouseId:source?.locationId||null,sourceQty:source?.qty||0};
  });
  res.json(suggestions);
});




// --- Inventory, request and planning APIs -----------------------------------
app.get('/api/operations/overview',auth,(req,res)=>{const db=loadDb();const tenant=req.user.role==='TENANT'?req.user.tenantId:null;const f=x=>!tenant||x.tenantId===tenant;const stores=(db.stores||[]).filter(x=>!tenant||x.tenantId===tenant);const leases=(db.leases||[]).filter(x=>!tenant||x.tenantId===tenant);const whIds=new Set(leases.map(x=>x.warehouseId));const warehouses=(db.warehouses||[]).filter(w=>!tenant||whIds.has(w.id)).map(w=>({...w,address:(db.sites||[]).find(s=>s.id===w.siteId)?.address||''}));res.json({goodsRequests:(db.goodsRequests||[]).filter(f),deliveryRequests:(db.deliveryRequests||[]).filter(f),stockReservations:(db.stockReservations||[]).filter(f),stockLedger:(db.stockLedger||[]).filter(f).slice(0,150),inventory:(db.inventory||[]).filter(f),routeRuns:(db.routeRuns||[]).filter(r=>!tenant||r.tenantId===tenant),drivers:['OWNER','WAREHOUSE_MANAGER'].includes(req.user.role)?db.drivers:[],vehicles:['OWNER','WAREHOUSE_MANAGER'].includes(req.user.role)?db.vehicles:[],warehouses,stores,tenants:req.user.role==='TENANT'?(db.tenants||[]).filter(t=>t.id===tenant):(db.tenants||[])});});
app.get('/api/inventory-control',auth,(req,res)=>{const db=loadDb(),tenant=req.user.role==='TENANT'?req.user.tenantId:req.query.tenantId;let rows=(db.inventory||[]).filter(i=>!tenant||i.tenantId===tenant).map(i=>({...i,reservedQty:(db.stockReservations||[]).filter(r=>r.tenantId===i.tenantId&&r.locationId===i.locationId&&r.sku===i.sku&&['ACTIVE','PICKED'].includes(r.status)).reduce((a,r)=>a+Number(r.qty||0),0),availableQty:availableQty(db,i.tenantId,i.locationId,i.sku)}));res.json({inventory:rows,ledger:(db.stockLedger||[]).filter(x=>!tenant||x.tenantId===tenant).slice(0,250)});});
app.post('/api/inventory/adjustments',auth,role('OWNER','WAREHOUSE_MANAGER'),(req,res)=>{const db=loadDb();const {tenantId,locationType='WAREHOUSE',locationId,sku,qtyDelta,reason}=req.body;if(!tenantId||!locationId||!sku||!Number.isFinite(Number(qtyDelta))||!reason)return res.status(400).json({error:'tenantId, locationId, sku, qtyDelta and reason are required'});const delta=Number(qtyDelta);db.approvals=db.approvals||[];if(Math.abs(delta)>=Number(process.env.STOCK_ADJUSTMENT_APPROVAL_THRESHOLD||50)){const a={id:id('APR'),type:'STOCK_ADJUSTMENT',status:'PENDING',requestedBy:req.user.id,requestedByName:req.user.name,createdAt:new Date().toISOString(),payload:{tenantId,locationType,locationId,sku,qtyDelta:delta,reason}};db.approvals.unshift(a);processEvent(db,{type:'STOCK_ADJUSTMENT_REQUESTED',entityType:'APPROVAL',entityId:a.id,actor:req.user.name,method:'WEB',note:`${sku} ${delta>0?'+':''}${delta}: ${reason}`});saveDb(db);return res.status(202).json(a);}try{const row=appendStockLedger(db,{tenantId,locationType,locationId,sku,qtyDelta:delta,movementType:'ADJUSTMENT',referenceType:'MANUAL_ADJUSTMENT',referenceId:id('ADJ'),actor:req.user.name,note:reason});processEvent(db,{type:'STOCK_ADJUSTED',entityType:'INVENTORY',entityId:sku,actor:req.user.name,method:'WEB',note:`${delta>0?'+':''}${delta} at ${locationId}: ${reason}`});saveDb(db);res.status(201).json(row);}catch(e){res.status(409).json({error:e.message});}});
app.get('/api/approvals',auth,role('OWNER','WAREHOUSE_MANAGER'),(req,res)=>res.json(loadDb().approvals||[]));
app.patch('/api/approvals/:id',auth,role('OWNER','WAREHOUSE_MANAGER'),(req,res)=>{const db=loadDb();const a=(db.approvals||[]).find(x=>x.id===req.params.id);if(!a)return res.status(404).json({error:'Approval not found'});if(a.status!=='PENDING')return res.status(409).json({error:'Approval already decided'});if(a.requestedBy===req.user.id&&APP_MODE==='production')return res.status(409).json({error:'Maker/checker control: requester cannot approve their own sensitive transaction'});const decision=String(req.body.status||'').toUpperCase();if(!['APPROVED','REJECTED'].includes(decision))return res.status(400).json({error:'status must be APPROVED or REJECTED'});a.status=decision;a.reviewedBy=req.user.id;a.reviewedByName=req.user.name;a.reviewedAt=new Date().toISOString();a.reviewNote=req.body.reviewNote||'';if(decision==='APPROVED'&&a.type==='STOCK_ADJUSTMENT'){try{appendStockLedger(db,{...a.payload,movementType:'ADJUSTMENT',referenceType:'APPROVAL',referenceId:a.id,actor:req.user.name,note:a.payload.reason});}catch(e){return res.status(409).json({error:e.message});}}processEvent(db,{type:`APPROVAL_${decision}`,entityType:'APPROVAL',entityId:a.id,actor:req.user.name,method:'WEB',note:a.reviewNote});saveDb(db);res.json(a);});
app.post('/api/goods-requests',auth,role('TENANT','OWNER','WAREHOUSE_MANAGER'),(req,res)=>{const db=loadDb();const tenantId=req.user.role==='TENANT'?req.user.tenantId:req.body.tenantId;if(!tenantId||!req.body.sourceWarehouseId||!req.body.destinationId||!(req.body.items||[]).length)return res.status(400).json({error:'tenant/source warehouse/destination/items required'});const x={id:id('GRQ'),tenantId,sourceWarehouseId:req.body.sourceWarehouseId,destinationType:req.body.destinationType||'STORE',destinationId:req.body.destinationId,requestedAt:new Date().toISOString(),requestedFor:req.body.requestedFor||new Date(Date.now()+86400000).toISOString(),status:'REQUESTED',priority:req.body.priority||'NORMAL',items:req.body.items,notes:req.body.notes||'',createdBy:req.user.id};db.goodsRequests=db.goodsRequests||[];db.goodsRequests.unshift(x);processEvent(db,{type:'GOODS_REQUEST_CREATED',entityType:'GOODS_REQUEST',entityId:x.id,actor:req.user.name,method:'WEB',note:`${x.items.length} SKU line(s)`});saveDb(db);res.status(201).json(x);});
app.patch('/api/goods-requests/:id/review',auth,role('OWNER','WAREHOUSE_MANAGER'),(req,res)=>{const db=loadDb();const x=(db.goodsRequests||[]).find(r=>r.id===req.params.id);if(!x)return res.status(404).json({error:'Goods request not found'});if(x.status!=='REQUESTED')return res.status(409).json({error:'Only requested goods can be reviewed'});const decision=String(req.body.status||'').toUpperCase();if(decision==='REJECTED'){x.status='REJECTED';x.reviewedBy=req.user.id;x.reviewNote=req.body.reviewNote||'';saveDb(db);return res.json(x);}if(decision!=='APPROVED')return res.status(400).json({error:'status must be APPROVED or REJECTED'});try{const reservations=x.items.map(it=>reserveStock(db,{tenantId:x.tenantId,locationId:x.sourceWarehouseId,sku:it.sku,qty:it.qty,referenceId:x.id,actor:req.user.name}));x.status='APPROVED';x.reviewedBy=req.user.id;x.reviewedAt=new Date().toISOString();x.reservationIds=reservations.map(r=>r.id);processEvent(db,{type:'GOODS_REQUEST_APPROVED',entityType:'GOODS_REQUEST',entityId:x.id,actor:req.user.name,method:'WEB',note:`Reserved ${reservations.length} SKU line(s)`});saveDb(db);res.json(x);}catch(e){res.status(409).json({error:e.message});}});
app.post('/api/goods-requests/:id/create-delivery',auth,role('OWNER','WAREHOUSE_MANAGER'),(req,res)=>{const db=loadDb();const x=(db.goodsRequests||[]).find(r=>r.id===req.params.id);if(!x)return res.status(404).json({error:'Goods request not found'});if(x.status!=='APPROVED')return res.status(409).json({error:'Goods request must be approved and reserved first'});const d={id:id('DEL'),tenantId:x.tenantId,type:'GOODS_REQUEST',requestId:x.id,fromType:'WAREHOUSE',fromId:x.sourceWarehouseId,toType:x.destinationType,toId:x.destinationId,scheduledAt:x.requestedFor,status:'PLANNED',priority:x.priority,items:x.items,driverInstructions:req.body.driverInstructions||[],proofPhoto:null};db.deliveries.unshift(d);x.status='PLANNED';x.deliveryId=d.id;processEvent(db,{type:'DELIVERY_CREATED_FROM_GOODS_REQUEST',entityType:'DELIVERY',entityId:d.id,actor:req.user.name,method:'WEB',note:`Source request ${x.id}`});saveDb(db);res.status(201).json(d);});
app.post('/api/delivery-requests',auth,role('TENANT','OWNER','WAREHOUSE_MANAGER'),(req,res)=>{const db=loadDb();const tenantId=req.user.role==='TENANT'?req.user.tenantId:req.body.tenantId;if(!tenantId||!req.body.pickup||!(req.body.stops||[]).length)return res.status(400).json({error:'tenantId, pickup and at least one stop are required'});const x={id:id('DRQ'),tenantId,requestType:req.body.requestType||'AD_HOC',pickup:req.body.pickup,stops:req.body.stops,items:req.body.items||[],requestedWindow:req.body.requestedWindow||null,specialHandling:req.body.specialHandling||[],notes:req.body.notes||'',status:'REQUESTED',createdAt:new Date().toISOString(),createdBy:req.user.id};db.deliveryRequests=db.deliveryRequests||[];db.deliveryRequests.unshift(x);processEvent(db,{type:'DELIVERY_REQUEST_CREATED',entityType:'DELIVERY_REQUEST',entityId:x.id,actor:req.user.name,method:'WEB',note:`${x.stops.length} destination(s)`});saveDb(db);res.status(201).json(x);});
app.patch('/api/delivery-requests/:id/review',auth,role('OWNER','WAREHOUSE_MANAGER'),(req,res)=>{const db=loadDb();const x=(db.deliveryRequests||[]).find(r=>r.id===req.params.id);if(!x)return res.status(404).json({error:'Delivery request not found'});if(x.status!=='REQUESTED')return res.status(409).json({error:'Request already reviewed'});const st=String(req.body.status||'').toUpperCase();if(!['APPROVED','REJECTED'].includes(st))return res.status(400).json({error:'status must be APPROVED or REJECTED'});x.status=st;x.reviewedAt=new Date().toISOString();x.reviewedBy=req.user.id;x.reviewNote=req.body.reviewNote||'';processEvent(db,{type:`DELIVERY_REQUEST_${st}`,entityType:'DELIVERY_REQUEST',entityId:x.id,actor:req.user.name,method:'WEB',note:x.reviewNote});saveDb(db);res.json(x);});
app.post('/api/delivery-requests/:id/plan',auth,role('OWNER','WAREHOUSE_MANAGER'),(req,res)=>{const db=loadDb();const x=(db.deliveryRequests||[]).find(r=>r.id===req.params.id);if(!x)return res.status(404).json({error:'Delivery request not found'});if(x.status!=='APPROVED')return res.status(409).json({error:'Request must be approved first'});const deliveries=[];for(const [i,st] of x.stops.entries()){const d={id:id('DEL'),tenantId:x.tenantId,type:'AD_HOC',requestId:x.id,fromType:x.pickup.type||'EXTERNAL',fromId:x.pickup.id||x.pickup.address,toType:st.type||'STORE',toId:st.id||st.address,scheduledAt:req.body.scheduledAt||x.requestedWindow?.start||new Date(Date.now()+86400000).toISOString(),status:'PLANNED',priority:req.body.priority||'NORMAL',items:st.items||x.items,driverInstructions:[...(x.specialHandling||[]),...(st.instructions||[])],proofPhoto:null};db.deliveries.unshift(d);deliveries.push(d);}x.status='PLANNED';x.deliveryIds=deliveries.map(d=>d.id);saveDb(db);res.status(201).json(deliveries);});
app.get('/api/dispatch/planning',auth,role('OWNER','WAREHOUSE_MANAGER'),(req,res)=>{const db=loadDb();const unplanned=(db.deliveries||[]).filter(d=>['PLANNED','APPROVED'].includes(d.status)&&!d.routeRunId).map(d=>({...d,instructions:criticalInstructionsForDelivery(db,d)}));res.json({unplanned,routeRuns:(db.routeRuns||[]).map(r=>enrichRoute(db,r)),drivers:db.drivers,vehicles:db.vehicles,availabilityRequests:db.driverAvailabilityRequests||[],goodsRequests:db.goodsRequests||[],deliveryRequests:db.deliveryRequests||[],warehouses:(db.warehouses||[]).map(w=>({...w,address:(db.sites||[]).find(s=>s.id===w.siteId)?.address||''})),stores:db.stores||[],tenants:db.tenants||[],inventory:db.inventory||[]});});
app.post('/api/dispatch/plan-route',auth,role('OWNER','WAREHOUSE_MANAGER'),(req,res)=>{const db=loadDb();const {deliveryIds,scheduledAt,primaryDriverId,standbyDriverId,vehicleId,name,managerNote=''}=req.body;if(!(deliveryIds||[]).length||!scheduledAt||!primaryDriverId||!vehicleId)return res.status(400).json({error:'deliveryIds, scheduledAt, primaryDriverId and vehicleId are required'});if(primaryDriverId===standbyDriverId)return res.status(409).json({error:'Primary and standby drivers must be different'});const conflicts=[...scheduleConflict(db,{driverId:primaryDriverId,scheduledAt}),...(standbyDriverId?scheduleConflict(db,{driverId:standbyDriverId,scheduledAt}):[]),...scheduleConflict(db,{vehicleId,scheduledAt})];if(conflicts.length)return res.status(409).json({error:'Driver or vehicle scheduling conflict',conflictRunIds:[...new Set(conflicts.map(x=>x.id))]});const dels=deliveryIds.map(idv=>(db.deliveries||[]).find(d=>d.id===idv)).filter(Boolean);if(dels.length!==deliveryIds.length)return res.status(404).json({error:'One or more deliveries not found'});const tenantId=dels[0].tenantId;if(dels.some(d=>d.tenantId!==tenantId))return res.status(409).json({error:'A route cannot mix tenants unless cross-tenant consolidation is explicitly enabled'});const stops=[{id:id('STOP'),sequence:1,type:'PICKUP',name:displayLocation(db,dels[0].fromType,dels[0].fromId),address:dels[0].fromId,status:'PENDING',deliveryIds:deliveryIds}];dels.forEach((d,i)=>stops.push({id:id('STOP'),sequence:i+2,type:'DELIVERY',name:displayLocation(db,d.toType,d.toId),address:d.toId,status:'PENDING',deliveryIds:[d.id],instructions:criticalInstructionsForDelivery(db,d)}));const run={id:id('RUN'),name:name||`Delivery Run ${new Date(scheduledAt).toLocaleDateString()}`,tenantId,scheduledAt,status:'PLANNED',primaryDriverId,standbyDriverId:standbyDriverId||null,activeDriverId:primaryDriverId,standbyApproved:Boolean(standbyDriverId),vehicleId,managerNote,stops,createdAt:new Date().toISOString(),createdBy:req.user.id,trackingStatus:'OFFLINE'};db.routeRuns=db.routeRuns||[];db.routeRuns.unshift(run);for(const d of dels){d.routeRunId=run.id;d.routeStopId=stops.find(s=>s.deliveryIds?.includes(d.id)&&s.type==='DELIVERY')?.id;d.driverId=primaryDriverId;d.standbyDriverId=standbyDriverId||null;d.vehicleId=vehicleId;d.status='ASSIGNED';}processEvent(db,{type:'ROUTE_PLANNED',entityType:'ROUTE_RUN',entityId:run.id,actor:req.user.name,method:'WEB',note:`${dels.length} delivery record(s); manager note: ${managerNote||'-'}`});saveDb(db);res.status(201).json(enrichRoute(db,run));});
app.post('/api/route-runs/:id/instructions/ack',auth,role('DRIVER'),(req,res)=>{const db=loadDb();const run=(db.routeRuns||[]).find(r=>r.id===req.params.id),drv=driverForUser(db,req.user);if(!run)return res.status(404).json({error:'Route not found'});if(![run.primaryDriverId,run.activeDriverId].includes(drv?.id))return res.status(403).json({error:'Not the active driver'});run.instructionAcknowledgement={driverId:drv.id,userId:req.user.id,acknowledgedAt:new Date().toISOString(),instructionHash:hash(JSON.stringify({managerNote:run.managerNote,stops:run.stops.map(s=>s.instructions||[])}))};processEvent(db,{type:'DRIVER_INSTRUCTIONS_ACKNOWLEDGED',entityType:'ROUTE_RUN',entityId:run.id,actor:req.user.name,method:'MOBILE',note:'Driver acknowledged current route/cargo instructions'});saveDb(db);res.json(run.instructionAcknowledgement);});
app.get('/api/security/audit/verify',auth,role('OWNER'),(req,res)=>{const rows=loadDb().processEvents||[];let valid=true,brokenAt=null;for(let i=0;i<rows.length;i++){const e=rows[i], expectedPrev=i===rows.length-1?'GENESIS':rows[i+1]?.eventHash||'GENESIS';if(e.previousHash!==expectedPrev){valid=false;brokenAt=e.id;break;}}res.json({valid,events:rows.length,brokenAt});});
app.get('/health', (req,res)=>res.json({status:'ok',mode:APP_MODE,simulationEnabled:SIMULATION_ENABLED,time:new Date().toISOString()}));

app.get('/api/branding', auth, (req,res)=>res.json(loadDb().organization||{}));
app.patch('/api/branding', auth, role('OWNER'), (req,res)=>{ const db=loadDb(); const allowed=['name','legalName','registrationNo','address','phone','email','website']; for(const k of allowed) if(req.body[k]!==undefined) db.organization[k]=req.body[k]; saveDb(db); res.json(db.organization); });
app.post('/api/branding/logo', auth, role('OWNER'), upload.single('logo'), (req,res)=>{ const db=loadDb(); if(!req.file)return res.status(400).json({error:'Logo file required'}); db.organization.logoPath=`/uploads/${req.file.filename}`; saveDb(db); res.json(db.organization); });
app.post('/api/deliveries/:id/signoff', auth, (req,res)=>{
  const db=loadDb(); const d=db.deliveries.find(x=>x.id===req.params.id); if(!d)return res.status(404).json({error:'Delivery not found'});
  const {receiverName,remarks,signatureDataUrl,latitude,longitude}=req.body;
  if(!receiverName) return res.status(400).json({error:'Receiver name is required'}); if(!signatureDataUrl)return res.status(400).json({error:'Receiver signature is required'});
  const signaturePath=saveDataUrl(signatureDataUrl,`signature-${d.id}`); if(!signaturePath)return res.status(400).json({error:'Signature must be PNG or JPEG data'});
  const signedAt=new Date().toISOString(); const sys=deliverySystemFields(db,d); d.receiverSignoff={receiverName,remarks:remarks||'',signaturePath,signedAt,latitude:latitude??null,longitude:longitude??null,signedByUserId:req.user.id,systemCompany:sys.companyName,systemStore:sys.storeName,systemReferenceId:sys.referenceId}; d.status='DELIVERED'; queuePodDistribution(db,d,signedAt);
  processEvent(db,{type:'DELIVERY_RECEIVER_SIGNED',entityType:'DELIVERY',entityId:d.id,actor:receiverName,method:'MOBILE_SIGNATURE',note:`Goods acknowledged by ${receiverName}. Company/store/reference were derived from the delivery record.`}); saveDb(db); res.json(d);
});
app.get('/api/documents/delivery/:id', auth, (req,res)=>{ const db=loadDb(); const d=db.deliveries.find(x=>x.id===req.params.id); if(!d)return res.status(404).json({error:'Delivery not found'}); createDeliveryPdf(res,db,d,String(req.query.type||'POD').toUpperCase()); });
app.get('/api/documents/incident/:id', auth, (req,res)=>{ const db=loadDb(); const x=db.incidents.find(v=>v.id===req.params.id); if(!x)return res.status(404).json({error:'Incident not found'}); createIncidentPdf(res,db,x); });
app.get('/api/documents/invoice/:id', auth, (req,res)=>{ const db=loadDb(); const x=db.invoices.find(v=>v.id===req.params.id); if(!x)return res.status(404).json({error:'Invoice not found'}); createInvoicePdf(res,db,x); });
app.get('/api/documents/utility/:id', auth, (req,res)=>{ const db=loadDb(); const x=db.utilityBills.find(v=>v.id===req.params.id); if(!x)return res.status(404).json({error:'Utility bill not found'}); createUtilityStatementPdf(res,db,x); });

app.get('/api/reports/:type', auth, (req,res)=>{
  const db=loadDb(); const type=req.params.type; let rows=[];
  if(type==='process') rows=scopeRows(db,req.user,'processEvents');
  else if(type==='incidents') rows=scopeRows(db,req.user,'incidents');
  else if(type==='deliveries') rows=scopeRows(db,req.user,'deliveries');
  else if(type==='invoices') rows=scopeRows(db,req.user,'invoices');
  else if(type==='utilities') rows=scopeRows(db,req.user,'utilityReadings');
  else if(type==='meters') rows=scopeRows(db,req.user,'meters');
  else return res.status(400).json({error:'Unknown report type'});
  if(req.query.format==='pdf') {
    const doc=new PDFDocument({margin:42,size:'A4'});
    const filename=`${type}-report.pdf`; res.setHeader('Content-Disposition',`attachment; filename=${filename}`); res.type('application/pdf'); doc.pipe(res);
    doc.fontSize(20).text('FlowDepot Operations Report'); doc.moveDown(.3); doc.fontSize(10).fillColor('#64748b').text(`Report: ${type.toUpperCase()}    Generated: ${new Date().toLocaleString()}`); doc.moveDown(); doc.fillColor('#111827');
    rows.forEach((r,idx)=>{ if(doc.y>730)doc.addPage(); doc.fontSize(11).font('Helvetica-Bold').text(`${idx+1}. ${r.id||r.period||r.type||'Record'}`); doc.font('Helvetica').fontSize(8); Object.entries(r).slice(0,12).forEach(([k,v])=>doc.text(`${k}: ${typeof v==='object'?JSON.stringify(v):v??''}`)); doc.moveDown(.6); });
    doc.end(); return;
  }
  if(req.query.format==='csv'){
    const keys=[...new Set(rows.flatMap(r=>Object.keys(r)))];
    const esc=v=>`"${String(typeof v==='object'?JSON.stringify(v):v??'').replaceAll('"','""')}"`;
    const csv=[keys.join(','),...rows.map(r=>keys.map(k=>esc(r[k])).join(','))].join('\n');
    res.setHeader('Content-Disposition',`attachment; filename=${type}-report.csv`); return res.type('text/csv').send(csv);
  }
  res.json({generatedAt:new Date().toISOString(),type,rows});
});

io.on('connection', socket => {
  socket.on('join-user', userId => socket.join(userId));
});

if(process.env.SERVE_FRONTENDS==='true') {
  const root=path.resolve(__dirname,'../../dist');
  app.use(express.static(root));
  app.get('/driver*',(req,res)=>res.sendFile(path.join(root,'driver/index.html')));
  app.get('*',(req,res)=>{if(req.path.startsWith('/api/')||req.path.startsWith('/uploads/'))return res.status(404).json({error:'Not found'});res.sendFile(path.join(root,'index.html'));});
}
app.use((error,req,res,next)=>{console.error(error.message);if(res.headersSent)return next(error);res.status(error instanceof multer.MulterError?413:500).json({error:error instanceof multer.MulterError?'Upload exceeds the supported size.':'Unable to complete the request.'});});
export default app;
export { server };
if(!HOSTED && process.env.FLOWDEPOT_NO_LISTEN!=='true') server.listen(PORT, ()=>console.log(`FlowDepot running at http://127.0.0.1:${PORT}`));

