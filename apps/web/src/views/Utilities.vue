<script setup>
import { computed,onMounted,ref } from 'vue';
import { api } from '../api';
import { Line } from 'vue-chartjs';
import { Chart as ChartJS,CategoryScale,LinearScale,PointElement,LineElement,Title,Tooltip,Legend,Filler } from 'chart.js';
ChartJS.register(CategoryScale,LinearScale,PointElement,LineElement,Title,Tooltip,Legend,Filler);

const data=ref(null),editing=ref(null),saving=ref(false),baseCurrency=ref('SGD'),fxQuote=ref('USD'),fxRate=ref(''),warehouseId=ref('ALL'),granularity=ref('monthly');
const currencyList=['SGD','USD','EUR','GBP','MYR','PHP','JPY','AUD','CAD','CNY','HKD','INR','AED','THB','IDR','KRW'];
const money=(v,c)=>new Intl.NumberFormat(undefined,{style:'currency',currency:c||data.value?.organization?.baseCurrency||'SGD',maximumFractionDigits:2}).format(Number(v||0));
const num=(v,d=0)=>new Intl.NumberFormat(undefined,{maximumFractionDigits:d}).format(Number(v||0));
async function load(){data.value=(await api.get('/utilities/overview',{params:{warehouseId:warehouseId.value,granularity:granularity.value}})).data;baseCurrency.value=data.value.organization.baseCurrency}
async function changeView(){await load()}
function openWarehouse(id){warehouseId.value=id;load()}
const scopeName=computed(()=>warehouseId.value==='ALL'?'All warehouses':data.value?.selectedWarehouse?.name||warehouseId.value);
const periodName=computed(()=>({hourly:'Hourly',daily:'Daily',weekly:'Weekly',monthly:'Monthly',yearly:'Yearly'})[granularity.value]||'Monthly');
const scopedEnergy=computed(()=>warehouseId.value==='ALL'?data.value?.analytics?.electricityKwh:data.value?.selectedWarehouse?.electricityKwh||0);
const scopedWater=computed(()=>warehouseId.value==='ALL'?data.value?.analytics?.waterM3:data.value?.selectedWarehouse?.waterM3||0);
onMounted(load);
const energyChart=computed(()=>({labels:data.value?.trend?.map(x=>x.period)||[],datasets:[{label:'Electricity (kWh)',data:data.value?.trend?.map(x=>x.electricityKwh)||[],tension:.28,fill:false}]}));
const waterChart=computed(()=>({labels:data.value?.trend?.map(x=>x.period)||[],datasets:[{label:'Water (m³)',data:data.value?.trend?.map(x=>x.waterM3)||[],tension:.28,fill:false}]}));
const chartOptions={responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:false}}};
function editTariff(w,utility){const t=utility==='ELECTRICITY'?w.electricityTariff:w.waterTariff;editing.value={warehouseId:w.id,warehouseName:w.name,utility,baseRate:t?.baseRate||0,markupRate:t?.markupRate||0,currency:t?.currency||data.value.organization.baseCurrency,unit:t?.unit||(utility==='ELECTRICITY'?'kWh':'m3')}}
async function saveTariff(){saving.value=true;try{await api.post('/utilities/tariffs',editing.value);editing.value=null;await load()}finally{saving.value=false}}
async function saveCurrency(){await api.post('/currency/settings',{baseCurrency:baseCurrency.value,reportingCurrency:baseCurrency.value,autoFx:true});await load()}
async function saveFx(){await api.post('/currency/rates',{base:data.value.organization.baseCurrency,quote:fxQuote.value,rate:Number(fxRate.value)});fxRate.value='';await load()}
async function exportFile(format){const r=await api.get(`/reports/utilities?format=${format}`,{responseType:'blob'});const u=URL.createObjectURL(r.data);const a=document.createElement('a');a.href=u;a.download=`utilities-report.${format}`;a.click();URL.revokeObjectURL(u)}
</script>

<template>
<div v-if="data">
  <div class="hero utility-hero"><div><h1>Energy & Water</h1><p>Track usage across the entire portfolio or drill into a single warehouse. Switch between hourly, daily, weekly, monthly and yearly trends.</p></div><div class="quick"><button class="btn secondary" @click="exportFile('csv')">Export CSV</button><button class="btn" @click="exportFile('pdf')">Export PDF</button></div></div>

  <div class="card section" style="padding:16px"><div class="section-head"><div><h3>Usage view</h3><span>Choose the portfolio or a warehouse, then choose the time interval.</span></div></div><div class="form-grid"><div class="field"><label>Warehouse</label><select v-model="warehouseId" @change="changeView"><option value="ALL">All warehouses</option><option v-for="w in data.warehouses" :key="w.id" :value="w.id">{{w.name}} · {{w.id}}</option></select></div><div class="field"><label>Time interval</label><select v-model="granularity" @change="changeView"><option value="hourly">Hourly</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></div></div><div class="note"><b>{{scopeName}}</b> · {{periodName}} usage view</div></div>

  <div class="grid4 section">
    <div class="card metric"><div class="label">Electricity · {{scopeName}}</div><div class="value">{{num(scopedEnergy)}} kWh</div><div class="sub" :class="{'negative':data.analytics.energyChangePct>0}">{{data.analytics.energyChangePct>=0?'+':''}}{{data.analytics.energyChangePct}}% vs prior month</div></div>
    <div class="card metric"><div class="label">Water · {{scopeName}}</div><div class="value">{{num(scopedWater)}} m³</div><div class="sub" :class="{'negative':data.analytics.waterChangePct>0}">{{data.analytics.waterChangePct>=0?'+':''}}{{data.analytics.waterChangePct}}% vs prior month</div></div>
    <div class="card metric"><div class="label">ESTIMATED TENANT BILLING</div><div class="value">{{money(data.analytics.projectedRecovery)}}</div><div class="sub">Supplier cost {{money(data.analytics.supplierCost)}}</div></div>
    <div class="card metric"><div class="label">UTILITY RECOVERY MARGIN</div><div class="value">{{money(data.analytics.utilityMargin)}}</div><div class="sub">Meter coverage {{data.analytics.meterCoveragePct}}%</div></div>
  </div>

  <div class="grid4 section">
    <div class="card metric compact"><div class="label">Energy intensity</div><div class="value">{{data.analytics.energyIntensityKwhM2}}</div><div class="sub">kWh / m² / month</div></div>
    <div class="card metric compact"><div class="label">Water intensity</div><div class="value">{{data.analytics.waterIntensityM3M2}}</div><div class="sub">m³ / m² / month</div></div>
    <div class="card metric compact"><div class="label">Estimated carbon emissions</div><div class="value">{{num(data.analytics.carbonKgCo2e)}} kg</div><div class="sub">CO₂e using configurable factor</div></div>
    <div class="card metric compact"><div class="label">Occupied portfolio area</div><div class="value">{{num(data.analytics.occupiedSqft)}} ft²</div><div class="sub">Used for intensity & ROI analysis</div></div>
  </div>

  <div class="split section">
    <div class="card chart-card"><div class="section-head"><div><h3>Electricity usage trend</h3><span>{{periodName}} · {{scopeName}}</span></div></div><div class="chart-area"><Line :data="energyChart" :options="chartOptions"/></div></div>
    <div class="card chart-card"><div class="section-head"><div><h3>Water usage trend</h3><span>{{periodName}} · {{scopeName}}</span></div></div><div class="chart-area"><Line :data="waterChart" :options="chartOptions"/></div></div>
  </div>

  <div class="card section table-wrap">
    <div class="section-head table-title"><div><h3>Usage and cost by warehouse</h3><span>Cost, tenant recovery and active tariff by warehouse</span></div></div>
    <table class="table"><thead><tr><th>Warehouse</th><th>Electricity</th><th>Water</th><th>Peak kW</th><th>Supplier cost</th><th>Tenant billing</th><th>Margin</th><th>Tariffs</th></tr></thead><tbody>
      <tr v-for="w in data.warehouses" :key="w.id"><td><button class="mini-btn" @click="openWarehouse(w.id)"><b>{{w.name}}</b> · {{w.id}}</button></td><td>{{num(w.electricityKwh)}} kWh</td><td>{{num(w.waterM3)}} m³</td><td>{{w.peakKw}}</td><td>{{money(w.supplierCost)}}</td><td>{{money(w.tenantBilling)}}</td><td><b>{{money(w.margin)}}</b></td><td><div class="tariff-actions"><button class="mini-btn" @click="editTariff(w,'ELECTRICITY')">⚡ {{money(w.electricityTariff?.finalRate,w.electricityTariff?.currency)}}/kWh</button><button class="mini-btn" @click="editTariff(w,'WATER')">💧 {{money(w.waterTariff?.finalRate,w.waterTariff?.currency)}}/m³</button></div></td></tr>
    </tbody></table>
  </div>

  <div class="split section">
    <div class="card modal-card"><div class="section-head"><div><h3>Reporting currency</h3><span>Portfolio reporting currency and FX configuration</span></div></div><div class="form-grid"><div class="field"><label>Portfolio reporting currency</label><select v-model="baseCurrency"><option v-for="c in currencyList" :key="c">{{c}}</option></select></div><div class="field"><label>&nbsp;</label><button class="btn" style="width:100%" @click="saveCurrency">Save currency</button></div></div><p class="note">Lease, invoice and site records keep their original transaction currency. Portfolio KPIs are translated into the owner reporting currency using the effective FX rate.</p></div>
    <div class="card modal-card"><div class="section-head"><div><h3>Exchange rates</h3><span>Manual fallback; production can connect to a live FX provider</span></div></div><div class="form-grid"><div class="field"><label>{{data.organization.baseCurrency}} → currency</label><select v-model="fxQuote"><option v-for="c in currencyList.filter(x=>x!==data.organization.baseCurrency)" :key="c">{{c}}</option></select></div><div class="field"><label>Rate</label><input v-model="fxRate" type="number" step="0.0001" placeholder="e.g. 0.78"/></div></div><button class="btn section" @click="saveFx">Save exchange rate</button></div>
  </div>

  <div class="card section table-wrap"><div class="section-head table-title"><div><h3>Utility meters</h3><span>IoT / BMS / manual meter connectivity</span></div></div><table class="table"><thead><tr><th>Meter</th><th>Warehouse</th><th>Type</th><th>Protocol</th><th>Status</th><th>Last seen</th></tr></thead><tbody><tr v-for="m in data.meters" :key="m.id"><td><b>{{m.id}}</b></td><td>{{m.warehouseId}}</td><td>{{m.type}}</td><td>{{m.protocol}}</td><td><span class="pill good">{{m.status}}</span></td><td>{{new Date(m.lastSeen).toLocaleString()}}</td></tr></tbody></table></div>

  <div v-if="editing" class="modal-overlay" @click.self="editing=null"><div class="card modal-dialog"><div class="section-head"><div><h3>{{editing.warehouseName}} · {{editing.utility}} tariff</h3><span>Create a new effective tariff without overwriting history</span></div><button class="mini-btn" @click="editing=null">Close</button></div><div class="form-grid"><div class="field"><label>Supplier cost per unit</label><input v-model="editing.baseRate" type="number" step="0.001"/></div><div class="field"><label>Owner markup per {{editing.unit}}</label><input v-model="editing.markupRate" type="number" step="0.001"/></div><div class="field"><label>Currency</label><select v-model="editing.currency"><option v-for="c in currencyList" :key="c">{{c}}</option></select></div><div class="field"><label>Tenant price per unit</label><input :value="(Number(editing.baseRate)+Number(editing.markupRate)).toFixed(3)" disabled/></div></div><button class="btn section" :disabled="saving" @click="saveTariff">{{saving?'Saving…':'Save new utility price'}}</button></div></div>
</div>
<div v-else class="empty">Loading utility intelligence…</div>
</template>
