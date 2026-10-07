import crypto from 'node:crypto';
const passwordHash=(v)=>{const salt=crypto.randomBytes(16).toString('hex');const digest=crypto.scryptSync(String(v),salt,32).toString('hex');return `scrypt$${salt}$${digest}`;};

const now = new Date();
const plusDays = (d) => new Date(now.getTime() + d * 86400000).toISOString();
const minusDays = (d) => new Date(now.getTime() - d * 86400000).toISOString();
const monthKey = (offset=0) => {
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
};

export async function buildSeed() {
  const passwords = { OWNER: passwordHash('Owner123!'), TENANT: passwordHash('Tenant123!'), MANAGER: passwordHash('Manager123!'), DRIVER: passwordHash('Driver123!') };
  const utilityHistory = [];
  const profiles = [
    ['WH-01','ELEC-WH01','WATER-WH01',14950,285],
    ['WH-02','ELEC-WH02','WATER-WH02',10200,190],
    ['WH-03','ELEC-WH03','WATER-WH03',17600,340]
  ];
  for (let m=-5;m<=0;m++) {
    profiles.forEach(([warehouseId,energyMeterId,waterMeterId,eBase,wBase],i)=>{
      const season = 1 + (m+5)*0.018 + i*0.012;
      utilityHistory.push({ id:`READ-${warehouseId}-${monthKey(m)}`, warehouseId, period:monthKey(m), energyMeterId, waterMeterId, electricityKwh:Math.round(eBase*season), waterM3:Math.round(wBase*season), peakKw:Math.round((eBase/280)*(1.12+i*.04)*10)/10, source:'IOT' });
    });
  }
  return {
    organization: { id:'ORG-01', name:'FlowDepot Global Warehousing', legalName:'FlowDepot Global Warehousing Pte. Ltd.', registrationNo:'202600001A', address:'21 Senoko Loop, Singapore', phone:'+65 6000 0000', email:'operations@flowdepot.test', website:'www.flowdepot.example', baseCurrency:'SGD', reportingCurrency:'SGD', timezone:'Asia/Singapore', emissionsFactorKgPerKwh:0.4168, logoPath:null },
    currencySettings: { baseCurrency:'SGD', autoFx:true, rateProvider:'CONFIGURABLE', fxApiUrl:'', fxLastUpdated:new Date().toISOString() },
    exchangeRates: [
      { base:'SGD', quote:'SGD', rate:1, source:'SYSTEM', effectiveAt:new Date().toISOString() },
      { base:'SGD', quote:'USD', rate:0.78, source:'DEMO_FALLBACK', effectiveAt:new Date().toISOString() },
      { base:'SGD', quote:'EUR', rate:0.67, source:'DEMO_FALLBACK', effectiveAt:new Date().toISOString() },
      { base:'SGD', quote:'GBP', rate:0.58, source:'DEMO_FALLBACK', effectiveAt:new Date().toISOString() },
      { base:'SGD', quote:'MYR', rate:3.31, source:'DEMO_FALLBACK', effectiveAt:new Date().toISOString() },
      { base:'SGD', quote:'PHP', rate:45.0, source:'DEMO_FALLBACK', effectiveAt:new Date().toISOString() },
      { base:'SGD', quote:'JPY', rate:115.8, source:'DEMO_FALLBACK', effectiveAt:new Date().toISOString() },
      { base:'SGD', quote:'AUD', rate:1.18, source:'DEMO_FALLBACK', effectiveAt:new Date().toISOString() }
    ],
    users: [
      { id:'USR-OWNER', name:'Alex Tan', email:'owner@demo.com', password:passwords.OWNER, role:'OWNER', tenantId:null, siteIds:['SITE-01','SITE-02'] },
      { id:'USR-TENANT', name:'Jamie Lim', email:'tenant@demo.com', password:passwords.TENANT, role:'TENANT', tenantId:'TEN-01', siteIds:[] },
      { id:'USR-MANAGER', name:'Nur Aisyah', email:'manager@demo.com', password:passwords.MANAGER, role:'WAREHOUSE_MANAGER', tenantId:null, siteIds:['SITE-01'] },
      { id:'USR-DRIVER', name:'Daniel Cruz', email:'driver@demo.com', password:passwords.DRIVER, role:'DRIVER', tenantId:'TEN-01', siteIds:[] }
    ],
    sites: [
      { id:'SITE-01', name:'North Logistics Hub', country:'SG', currency:'SGD', address:'21 Senoko Loop, Singapore', occupancyPct:86, monthlyOpex:18400 },
      { id:'SITE-02', name:'East Distribution Campus', country:'SG', currency:'SGD', address:'8 Changi South Ave 2, Singapore', occupancyPct:71, monthlyOpex:13200 }
    ],
    warehouses: [
      { id:'WH-01', siteId:'SITE-01', name:'Warehouse A', areaSqft:18000, leasedSqft:16200, energyMeterId:'ELEC-WH01', waterMeterId:'WATER-WH01', status:'ACTIVE' },
      { id:'WH-02', siteId:'SITE-01', name:'Warehouse B', areaSqft:12000, leasedSqft:9400, energyMeterId:'ELEC-WH02', waterMeterId:'WATER-WH02', status:'ACTIVE' },
      { id:'WH-03', siteId:'SITE-02', name:'Warehouse C', areaSqft:22000, leasedSqft:14700, energyMeterId:'ELEC-WH03', waterMeterId:'WATER-WH03', status:'ACTIVE' }
    ],
    utilityTariffs: [
      { id:'TAR-E-WH01', warehouseId:'WH-01', utility:'ELECTRICITY', currency:'SGD', unit:'kWh', baseRate:0.285, markupRate:0.020, finalRate:0.305, effectiveFrom:monthKey(-6), active:true },
      { id:'TAR-W-WH01', warehouseId:'WH-01', utility:'WATER', currency:'SGD', unit:'m3', baseRate:2.74, markupRate:0.20, finalRate:2.94, effectiveFrom:monthKey(-6), active:true },
      { id:'TAR-E-WH02', warehouseId:'WH-02', utility:'ELECTRICITY', currency:'SGD', unit:'kWh', baseRate:0.290, markupRate:0.018, finalRate:0.308, effectiveFrom:monthKey(-6), active:true },
      { id:'TAR-W-WH02', warehouseId:'WH-02', utility:'WATER', currency:'SGD', unit:'m3', baseRate:2.74, markupRate:0.18, finalRate:2.92, effectiveFrom:monthKey(-6), active:true },
      { id:'TAR-E-WH03', warehouseId:'WH-03', utility:'ELECTRICITY', currency:'SGD', unit:'kWh', baseRate:0.282, markupRate:0.021, finalRate:0.303, effectiveFrom:monthKey(-6), active:true },
      { id:'TAR-W-WH03', warehouseId:'WH-03', utility:'WATER', currency:'SGD', unit:'m3', baseRate:2.74, markupRate:0.19, finalRate:2.93, effectiveFrom:monthKey(-6), active:true }
    ],
    utilityReadings: utilityHistory,
    meters: [
      { id:'ELEC-WH01', warehouseId:'WH-01', type:'ELECTRICITY', unit:'kWh', protocol:'MODBUS_TCP', status:'ONLINE', lastSeen:new Date().toISOString(), tenantId:null },
      { id:'WATER-WH01', warehouseId:'WH-01', type:'WATER', unit:'m3', protocol:'LORAWAN', status:'ONLINE', lastSeen:new Date().toISOString(), tenantId:null },
      { id:'ELEC-WH02', warehouseId:'WH-02', type:'ELECTRICITY', unit:'kWh', protocol:'BACNET', status:'ONLINE', lastSeen:new Date().toISOString(), tenantId:null },
      { id:'WATER-WH02', warehouseId:'WH-02', type:'WATER', unit:'m3', protocol:'MANUAL', status:'ONLINE', lastSeen:minusDays(.4), tenantId:null },
      { id:'ELEC-WH03', warehouseId:'WH-03', type:'ELECTRICITY', unit:'kWh', protocol:'MQTT', status:'ONLINE', lastSeen:new Date().toISOString(), tenantId:null },
      { id:'WATER-WH03', warehouseId:'WH-03', type:'WATER', unit:'m3', protocol:'LORAWAN', status:'ONLINE', lastSeen:new Date().toISOString(), tenantId:null }
    ],
    pricingRules: [
      { id:'FEE-PLATFORM', name:'Platform subscription', type:'FIXED_MONTHLY', amount:299, currency:'SGD', scope:'TENANT', active:true, effectiveFrom:monthKey(-2) },
      { id:'FEE-DELIVERY', name:'Delivery processing', type:'PER_DELIVERY', amount:1.5, currency:'SGD', scope:'TENANT', active:true, effectiveFrom:monthKey(-2) },
      { id:'FEE-RFID', name:'RFID event processing', type:'PER_EVENT', amount:0.002, currency:'SGD', scope:'TENANT', active:true, effectiveFrom:monthKey(-2) }
    ],
    rentalRates: [
      { id:'RENT-WH01-A', warehouseId:'WH-01', spaceType:'GENERAL', ratePerSqft:2.0, currency:'SGD', billingCycle:'MONTHLY', minTermMonths:12, depositMonths:2, availableSqft:1800, effectiveFrom:monthKey(-1), active:true },
      { id:'RENT-WH02-A', warehouseId:'WH-02', spaceType:'GENERAL', ratePerSqft:1.85, currency:'SGD', billingCycle:'MONTHLY', minTermMonths:6, depositMonths:2, availableSqft:2600, effectiveFrom:monthKey(-1), active:true },
      { id:'RENT-WH03-COLD', warehouseId:'WH-03', spaceType:'COLD_STORAGE', ratePerSqft:3.5, currency:'SGD', billingCycle:'MONTHLY', minTermMonths:12, depositMonths:3, availableSqft:7300, effectiveFrom:monthKey(-1), active:true }
    ],
    warehouseListings: [
      { id:'LIST-1001', warehouseId:'WH-02', title:'Warehouse B - General Storage Space', description:'Flexible general storage with loading-bay access, security and utility metering.', availableSqft:2600, spaceType:'GENERAL', currency:'SGD', minimumBid:5200, bidStart:minusDays(1), bidEnd:plusDays(14), availableFrom:plusDays(30), minTermMonths:12, status:'OPEN', published:true, media:[{type:'PHOTO',url:'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=1200&q=80',caption:'Illustrative warehouse interior'}], createdAt:minusDays(1) },
      { id:'LIST-1002', warehouseId:'WH-03', title:'Warehouse C - Cold Storage Zone', description:'Temperature-controlled warehouse space suitable for food and cold-chain operations.', availableSqft:5000, spaceType:'COLD_STORAGE', currency:'SGD', minimumBid:17500, bidStart:plusDays(2), bidEnd:plusDays(21), availableFrom:plusDays(45), minTermMonths:24, status:'SCHEDULED', published:true, media:[], createdAt:minusDays(1) }
    ],
    warehouseBids: [],
    renewalRequests: [
      { id:'REN-1001', leaseId:'LEASE-01', tenantId:'TEN-01', requestedMonths:12, proposedMonthlyRent:18500, currency:'SGD', notes:'Requesting a further 12-month term.', status:'SUBMITTED', submittedAt:minusDays(1) }
    ],
    announcements: [
      { id:'ANN-1001', title:'Loading bay maintenance', message:'Loading Bay 2 at North Logistics Hub will undergo maintenance this Saturday from 09:00 to 13:00.', audience:'ALL_TENANTS', priority:'IMPORTANT', published:true, startsAt:minusDays(1), endsAt:plusDays(7), createdAt:minusDays(1), createdBy:'Alex Tan' }
    ],
    tenantApplications: [
      { id:'APP-1001', companyName:'Orion Medical Supplies', contactName:'Priya Nair', email:'ops@orionmedical.test', requestedWarehouseId:'WH-02', requestedSqft:1800, spaceType:'GENERAL', requestedStart:plusDays(30), termMonths:24, cargoProfile:['MEDICAL','FRAGILE'], status:'UNDER_REVIEW', submittedAt:minusDays(2), notes:'Requires controlled access and audit trail.' }
    ],
    tenants: [
      { id:'TEN-01', name:'Nova Retail Pte Ltd', contact:'Jamie Lim', email:'ops@novaretail.test', invoiceCurrency:'SGD' },
      { id:'TEN-02', name:'FreshBox Foods', contact:'Mei Chen', email:'supply@freshbox.test', invoiceCurrency:'SGD' },
      { id:'TEN-03', name:'Arc Components', contact:'Raj Kumar', email:'warehouse@arc.test', invoiceCurrency:'USD' }
    ],
    leases: [
      { id:'LEASE-01', tenantId:'TEN-01', warehouseId:'WH-01', start:minusDays(310), end:plusDays(55), monthlyRent:18000, currency:'SGD', deposit:36000, areaSqft:9000 },
      { id:'LEASE-02', tenantId:'TEN-02', warehouseId:'WH-01', start:minusDays(180), end:plusDays(185), monthlyRent:14200, currency:'SGD', deposit:28400, areaSqft:7200 },
      { id:'LEASE-03', tenantId:'TEN-03', warehouseId:'WH-02', start:minusDays(40), end:plusDays(325), monthlyRent:16100, currency:'USD', deposit:32200, areaSqft:9400 },
      { id:'LEASE-04', tenantId:'TEN-01', warehouseId:'WH-03', start:minusDays(220), end:plusDays(145), monthlyRent:21000, currency:'SGD', deposit:42000, areaSqft:14700 }
    ],
    utilityBills: [
      { id:'UTIL-01', leaseId:'LEASE-01', warehouseId:'WH-01', tenantId:'TEN-01', period:monthKey(-1), electricityKwh:7820, waterM3:91, electricityRate:0.305, waterRate:2.94, currency:'SGD', amount:2653.94, status:'BILLED' },
      { id:'UTIL-02', leaseId:'LEASE-02', warehouseId:'WH-01', tenantId:'TEN-02', period:monthKey(-1), electricityKwh:6210, waterM3:136, electricityRate:0.305, waterRate:2.94, currency:'SGD', amount:2293.29, status:'BILLED' },
      { id:'UTIL-03', leaseId:'LEASE-03', warehouseId:'WH-02', tenantId:'TEN-03', period:monthKey(-1), electricityKwh:5150, waterM3:47, electricityRate:0.308, waterRate:2.92, currency:'USD', amount:1723.84, status:'DRAFT' }
    ],
    stores: [
      { id:'STORE-01', tenantId:'TEN-01', name:'Nova Downtown', address:'Orchard Road, Singapore', lat:1.3048, lng:103.8318 },
      { id:'STORE-02', tenantId:'TEN-01', name:'Nova Tampines', address:'Tampines Central, Singapore', lat:1.3521, lng:103.9447 },
      { id:'STORE-03', tenantId:'TEN-01', name:'Nova Jurong', address:'Jurong Gateway, Singapore', lat:1.3331, lng:103.7422 },
      { id:'STORE-04', tenantId:'TEN-01', name:'Nova Novena', address:'Novena, Singapore', lat:1.3201, lng:103.8439, deliveryEntrance:'Loading Bay B', accessNotes:'Use rear service road. Report to receiving desk before unloading.' }
    ],
    locationContacts: [
      { id:'LC-001', tenantId:'TEN-01', storeId:'STORE-01', name:'Orchard Receiving Desk', email:'orchard.receiving@novaretail.test', phone:'', role:'RECEIVING', receivePod:true, receiveAlerts:true, active:true },
      { id:'LC-002', tenantId:'TEN-01', storeId:'STORE-01', name:'Amy Lim', email:'amy.lim@novaretail.test', phone:'+65 8111 1001', role:'RECEIVING', receivePod:true, receiveAlerts:false, active:true },
      { id:'LC-003', tenantId:'TEN-01', storeId:'STORE-01', name:'Michelle Lee', email:'michelle.lee@novaretail.test', phone:'+65 8111 1002', role:'STORE_MANAGER', receivePod:true, receiveAlerts:true, active:true },
      { id:'LC-004', tenantId:'TEN-01', storeId:'STORE-02', name:'Tampines Receiving', email:'tampines.receiving@novaretail.test', phone:'', role:'RECEIVING', receivePod:true, receiveAlerts:true, active:true },
      { id:'LC-005', tenantId:'TEN-01', storeId:'STORE-02', name:'Marcus Ong', email:'marcus.ong@novaretail.test', phone:'+65 8111 2002', role:'STORE_MANAGER', receivePod:true, receiveAlerts:true, active:true },
      { id:'LC-006', tenantId:'TEN-01', storeId:'STORE-04', name:'Novena Receiving', email:'novena.receiving@novaretail.test', phone:'', role:'RECEIVING', receivePod:true, receiveAlerts:true, active:true },
      { id:'LC-007', tenantId:'TEN-01', storeId:null, name:'Nova Logistics HQ', email:'logistics@novaretail.test', phone:'', role:'LOGISTICS', receivePod:true, receiveAlerts:true, active:true }
    ],
    documentDistributions: [],
    inventory: [
      { id:'INV-01', tenantId:'TEN-01', locationType:'WAREHOUSE', locationId:'WH-01', sku:'SKU-RED-001', name:'Red Sneakers', qty:620, reorderPoint:180, unitCost:39.5, unitPrice:69.9, uom:'PAIR', handlingRules:['FRAGILE','KEEP_DRY'], barcode:'955000100001' },
      { id:'INV-02', tenantId:'TEN-01', locationType:'WAREHOUSE', locationId:'WH-01', sku:'SKU-BLK-002', name:'Black Hoodie', qty:410, reorderPoint:160, unitCost:28.0, unitPrice:49.9, uom:'EA', handlingRules:['KEEP_DRY'], barcode:'955000100002' },
      { id:'INV-03', tenantId:'TEN-01', locationType:'STORE', locationId:'STORE-01', sku:'SKU-RED-001', name:'Red Sneakers', qty:34, reorderPoint:50, unitCost:39.5, unitPrice:69.9, uom:'PAIR', handlingRules:['FRAGILE','KEEP_DRY'], barcode:'955000100001' },
      { id:'INV-04', tenantId:'TEN-01', locationType:'STORE', locationId:'STORE-02', sku:'SKU-BLK-002', name:'Black Hoodie', qty:21, reorderPoint:45, unitCost:28.0, unitPrice:49.9, uom:'EA', handlingRules:['KEEP_DRY'], barcode:'955000100002' },
      { id:'INV-05', tenantId:'TEN-01', locationType:'WAREHOUSE', locationId:'WH-03', sku:'SKU-WHT-003', name:'White Tee', qty:900, reorderPoint:220, unitCost:9.8, unitPrice:22.0, uom:'EA', handlingRules:['KEEP_DRY'], barcode:'955000100003' }
    ],
    stockLedger: [],
    stockReservations: [],
    approvals: [],
    goodsRequests: [
      { id:'GRQ-1001', tenantId:'TEN-01', sourceWarehouseId:'WH-01', destinationType:'STORE', destinationId:'STORE-02', requestedAt:minusDays(.3), requestedFor:plusDays(.7), status:'REQUESTED', priority:'NORMAL', items:[{sku:'SKU-BLK-002',qty:24}], notes:'Store replenishment for weekend demand.', createdBy:'USR-TENANT' }
    ],
    deliveryRequests: [
      { id:'DRQ-1001', tenantId:'TEN-01', requestType:'AD_HOC', pickup:{type:'WAREHOUSE',id:'WH-01',address:'21 Senoko Loop'}, stops:[{type:'STORE',id:'STORE-04',address:'Novena, Singapore',instructions:['Use service entrance','Call store manager on arrival']}], items:[{sku:'SKU-RED-001',qty:12}], requestedWindow:{start:plusDays(.5),end:plusDays(.6)}, specialHandling:['FRAGILE','KEEP_DRY'], notes:'Urgent campaign replenishment.', status:'REQUESTED', createdAt:minusDays(.2), createdBy:'USR-TENANT' }
    ],
    vehicles: [
      { id:'VEH-01', plate:'GBB 3812K', status:'AVAILABLE', capacityKg:2500 },
      { id:'VEH-02', plate:'GBK 1188T', status:'AVAILABLE', capacityKg:1800 },
      { id:'VEH-03', plate:'GBC 9011A', status:'MAINTENANCE', capacityKg:2500 }
    ],
    drivers: [
      { id:'DRV-01', userId:'USR-DRIVER', name:'Daniel Cruz', status:'AVAILABLE', phone:'+65 9000 0001', currentJobs:1, rating:4.9 },
      { id:'DRV-02', userId:null, name:'Marcus Lee', status:'AVAILABLE', phone:'+65 9000 0002', currentJobs:1, rating:4.7 },
      { id:'DRV-03', userId:null, name:'Sarah Ng', status:'AVAILABLE', phone:'+65 9000 0003', currentJobs:0, rating:4.8 }
    ],
    freightJobs: [
      { id:'FRT-SEA-001', tenantId:'TEN-03', mode:'SEA', serviceType:'FCL', origin:'Port Klang, Malaysia', destination:'Singapore', carrier:'Demo Ocean Line', containerNo:'MSCU1234567', vesselFlight:'MV Meridian', etd:plusDays(2), eta:plusDays(5), status:'BOOKED', cargoClass:'GENERAL', incoterm:'FOB', customsStatus:'PENDING', documents:['BILL_OF_LADING','PACKING_LIST','COMMERCIAL_INVOICE'] },
      { id:'FRT-AIR-001', tenantId:'TEN-01', mode:'AIR', serviceType:'AIR_FREIGHT', origin:'Hong Kong', destination:'Singapore', carrier:'Demo Air Cargo', awb:'618-12345675', vesselFlight:'FD218', etd:plusDays(.8), eta:plusDays(1.1), status:'CONFIRMED', cargoClass:'FRAGILE', incoterm:'CIP', customsStatus:'PRE_CLEARANCE', documents:['AIR_WAYBILL','PACKING_LIST','COMMERCIAL_INVOICE'] }
    ],
    cargoProfiles: [
      { id:'CARGO-FRAGILE', name:'Fragile cargo', flags:['FRAGILE'], handling:['DO_NOT_STACK','SHOCK_MONITOR','PHOTO_AT_HANDOFF'], maxTiltDeg:15 },
      { id:'CARGO-COLD', name:'Cold chain', flags:['TEMPERATURE_CONTROLLED'], handling:['TEMP_LOG_REQUIRED','PRIORITY_DOCK'], minTempC:2, maxTempC:8 },
      { id:'CARGO-HAZ', name:'Hazardous / regulated', flags:['HAZMAT'], handling:['CERTIFIED_HANDLER','SEGREGATED_STORAGE','SDS_REQUIRED'] },
      { id:'CARGO-HIGHVALUE', name:'High value', flags:['HIGH_VALUE'], handling:['TWO_PERSON_VERIFY','SEALED_CAGE','PHOTO_AT_HANDOFF'] }
    ],
    deliveries: [
      { id:'DEL-1001', tenantId:'TEN-01', routeRunId:'RUN-1042', routeStopId:'STOP-02', type:'RESTOCK', fromType:'WAREHOUSE', fromId:'WH-01', toType:'STORE', toId:'STORE-01', scheduledAt:plusDays(0.15), status:'ASSIGNED', driverId:'DRV-01', standbyDriverId:'DRV-02', vehicleId:'VEH-01', priority:'HIGH', onTime:true, items:[{sku:'SKU-RED-001',qty:50},{sku:'SKU-BLK-002',qty:30}], proofPhoto:null, receiverSignoff:null },
      { id:'DEL-1004', tenantId:'TEN-01', routeRunId:'RUN-1042', routeStopId:'STOP-03', type:'RESTOCK', fromType:'WAREHOUSE', fromId:'WH-01', toType:'STORE', toId:'STORE-04', scheduledAt:plusDays(0.17), status:'ASSIGNED', driverId:'DRV-01', standbyDriverId:'DRV-02', vehicleId:'VEH-01', priority:'NORMAL', onTime:true, items:[{sku:'SKU-BLK-002',qty:20}], proofPhoto:null, receiverSignoff:null },
      { id:'DEL-1005', tenantId:'TEN-01', routeRunId:'RUN-1042', routeStopId:'STOP-04', type:'RESTOCK', fromType:'WAREHOUSE', fromId:'WH-01', toType:'STORE', toId:'STORE-02', scheduledAt:plusDays(0.20), status:'ASSIGNED', driverId:'DRV-01', standbyDriverId:'DRV-02', vehicleId:'VEH-01', priority:'NORMAL', onTime:true, items:[{sku:'SKU-WHT-003',qty:25}], proofPhoto:null, receiverSignoff:null },
      { id:'DEL-1002', tenantId:'TEN-01', type:'RESTOCK', fromType:'WAREHOUSE', fromId:'WH-03', toType:'STORE', toId:'STORE-02', scheduledAt:plusDays(1.2), status:'PLANNED', driverId:null, vehicleId:null, priority:'NORMAL', onTime:true, items:[{sku:'SKU-WHT-003',qty:120}], proofPhoto:null, receiverSignoff:null },
      { id:'DEL-1003', tenantId:'TEN-01', type:'RETURN', fromType:'STORE', fromId:'STORE-03', toType:'WAREHOUSE', toId:'WH-01', scheduledAt:plusDays(2.1), status:'PLANNED', driverId:'DRV-02', vehicleId:'VEH-02', priority:'NORMAL', onTime:false, items:[{sku:'SKU-RED-001',qty:12}], proofPhoto:null, receiverSignoff:null }
    ],
    routeRuns: [
      { id:'RUN-1042', tenantId:'TEN-01', name:'Morning Retail Run', scheduledAt:plusDays(0.14), status:'ASSIGNED', primaryDriverId:'DRV-01', standbyDriverId:'DRV-02', standbyApproved:true, standbyApprovedBy:'Alex Tan', standbyApprovedAt:minusDays(0.05), activeDriverId:'DRV-01', vehicleId:'VEH-01', trackingStatus:'OFFLINE', trackingStartedAt:null, lastLocation:null, currentStopIndex:0, routePolicy:{requireStandby:true,allowAutoGeofenceArrival:true}, stops:[
        { id:'STOP-01', sequence:1, type:'PICKUP', locationType:'WAREHOUSE', locationId:'WH-01', name:'Warehouse A - Loading Bay', address:'21 Senoko Loop, Singapore', lat:1.4669, lng:103.8010, status:'PENDING', deliveryIds:['DEL-1001','DEL-1004','DEL-1005'], instructions:'Verify all route cargo before departure.' },
        { id:'STOP-02', sequence:2, type:'DELIVERY', locationType:'STORE', locationId:'STORE-01', name:'Nova Downtown', address:'Orchard Road, Singapore', lat:1.3048, lng:103.8318, status:'PENDING', deliveryIds:['DEL-1001'], deliveryWindow:'10:00-11:00', instructions:'Use service entrance and receiving dock.' },
        { id:'STOP-03', sequence:3, type:'DELIVERY', locationType:'STORE', locationId:'STORE-04', name:'Nova Novena', address:'Novena, Singapore', lat:1.3201, lng:103.8439, status:'PENDING', deliveryIds:['DEL-1004'], deliveryWindow:'11:00-12:00', instructions:'Loading Bay B via rear service road.' },
        { id:'STOP-04', sequence:4, type:'DELIVERY', locationType:'STORE', locationId:'STORE-02', name:'Nova Tampines', address:'Tampines Central, Singapore', lat:1.3521, lng:103.9447, status:'PENDING', deliveryIds:['DEL-1005'], deliveryWindow:'12:30-14:00', instructions:'Call receiving desk on arrival.' },
        { id:'STOP-05', sequence:5, type:'RETURN', locationType:'WAREHOUSE', locationId:'WH-01', name:'Warehouse A - Return', address:'21 Senoko Loop, Singapore', lat:1.4669, lng:103.8010, status:'PENDING', deliveryIds:[], instructions:'Return undelivered goods, documents and reusable totes.' }
      ] }
    ],
    driverAvailabilityRequests: [
      { id:'AVL-1001', driverId:'DRV-03', type:'DAY_OFF', start:plusDays(5), end:plusDays(5), status:'APPROVED', reason:'Rostered day off', submittedAt:minusDays(2), reviewedBy:'Alex Tan', reviewedAt:minusDays(1), documentPath:null }
    ],
    incidents: [
      { id:'INC-1001', type:'INVENTORY_MISMATCH', severity:'MEDIUM', status:'RECTIFICATION_CREATED', title:'Cycle count mismatch', description:'SKU-BLK-002 store count differs by 6 units', entityId:'INV-04', createdAt:minusDays(1), rectification:'Created stock reconciliation task and froze affected quantity.' }
    ],
    invoices: [
      { id:'INVOC-2026-0801', tenantId:'TEN-01', leaseId:'LEASE-01', period:monthKey(-1), rent:18000, utilities:2653.94, other:0, total:20653.94, currency:'SGD', dueDate:plusDays(7), status:'SENT' },
      { id:'INVOC-2026-0802', tenantId:'TEN-02', leaseId:'LEASE-02', period:monthKey(-1), rent:14200, utilities:2293.29, other:0, total:16493.29, currency:'SGD', dueDate:plusDays(7), status:'PAID' }
    ],
    tasks: [
      { id:'TASK-01', type:'RECONCILIATION', status:'OPEN', priority:'HIGH', title:'Recount Black Hoodie at Nova Tampines', assigneeRole:'WAREHOUSE_MANAGER', linkedEntity:'INV-04', createdAt:minusDays(1) }
    ],
    processEvents: [
      { id:'EVT-01', type:'DELIVERY_CREATED', entityType:'DELIVERY', entityId:'DEL-1001', actor:'system', method:'SYSTEM', timestamp:minusDays(0.5), note:'Restock request converted to delivery order.' },
      { id:'EVT-02', type:'DELIVERY_ASSIGNED', entityType:'DELIVERY', entityId:'DEL-1001', actor:'system', method:'SYSTEM', timestamp:minusDays(0.45), note:'Driver and vehicle assigned.' }
    ],
    simulationState: { mode:'DEMO', running:false, scenario:'NORMAL_DAY', speed:10, tick:0, runId:null, startedAt:null, updatedAt:null, elapsedSimMinutes:0 },
    simulationFeed: [],
    simulationTelemetry: [],
    notifications: [
      { id:'NOT-01', userId:'USR-OWNER', title:'Lease expiring soon', message:'Nova Retail lease at Warehouse A ends in 55 days.', level:'warning', read:false, createdAt:minusDays(0.2) },
      { id:'NOT-02', userId:'USR-DRIVER', title:'Delivery assigned', message:'DEL-1001 assigned for today.', level:'info', read:false, createdAt:minusDays(0.1) }
    ]
  };
}
