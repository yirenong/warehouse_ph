<script setup>
import { computed,onMounted,onUnmounted,ref,watch } from 'vue'; import { useRoute,useRouter } from 'vue-router'; import { useAuthStore } from './stores/auth'; import { io } from '../../../shared/realtime'; import { API_BASE } from './api'; import { LayoutDashboard,Building2,Warehouse,Users,FileClock,Boxes,CalendarClock,Truck,TriangleAlert,ReceiptText,FileArchive,ScanLine,Gauge,DollarSign,Plane,LogOut,Bell,Menu,X,PlayCircle,ContactRound } from 'lucide-vue-next';
const auth=useAuthStore(),route=useRoute(),router=useRouter(); const open=ref(false); const toast=ref(null); let socket,toastTimer;
function showToast(n){toast.value=n;clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.value=null,5000)}
function onAppToast(e){showToast(e.detail)}
const role=computed(()=>auth.user?.role||''); const simulationEnabled=String(import.meta.env.VITE_SIMULATION_ENABLED??'true')==='true';
const groups=[
 {name:'Overview',items:[['Dashboard','/',LayoutDashboard,['OWNER','TENANT','WAREHOUSE_MANAGER','DRIVER']],['My Lease & Announcements','/my-leasing',FileClock,['TENANT']]]},
 {name:'Properties',items:[['Sites','/sites',Building2,['OWNER','WAREHOUSE_MANAGER']],['Warehouses','/warehouses',Warehouse,['OWNER','WAREHOUSE_MANAGER']],['Tenants','/tenants',Users,['OWNER']],['Rent & Leasing','/commercial',DollarSign,['OWNER']],['Lease Agreements','/leases',FileClock,['OWNER']]]},
 {name:'Operations',items:[['Inventory Control','/inventory',Boxes,['TENANT','WAREHOUSE_MANAGER','OWNER']],['Delivery Planning','/planning',CalendarClock,['TENANT','WAREHOUSE_MANAGER','OWNER']],['Deliveries & Dispatch','/deliveries',Truck,['OWNER','TENANT','WAREHOUSE_MANAGER','DRIVER']],['POD Contacts','/pod-contacts',ContactRound,['OWNER','TENANT','WAREHOUSE_MANAGER']],['Freight & Cargo','/freight',Plane,['OWNER','TENANT','WAREHOUSE_MANAGER']],['Issues & Incidents','/incidents',TriangleAlert,['OWNER','TENANT','WAREHOUSE_MANAGER','DRIVER']]]},
 {name:'Finance & Utilities',items:[['Energy & Water','/utilities',Gauge,['OWNER','WAREHOUSE_MANAGER']],['Billing & Invoices','/billing',ReceiptText,['OWNER','TENANT']]]},
 {name:'Records & Tools',items:[['Reports & Records','/records',FileArchive,['OWNER','TENANT','WAREHOUSE_MANAGER']],['Scan QR / RFID','/scanner',ScanLine,['OWNER','TENANT','WAREHOUSE_MANAGER','DRIVER']],['Live Simulation','/simulation',PlayCircle,['OWNER','WAREHOUSE_MANAGER']]]}
];
const navGroups=computed(()=>groups.map(g=>({...g,items:g.items.filter(x=>x[3].includes(role.value)&&(simulationEnabled||x[1]!=='/simulation'))})).filter(g=>g.items.length));
function logout(){auth.logout();router.push('/login');}
watch(()=>auth.user?.id,(userId)=>{socket?.disconnect();if(userId){socket=io(API_BASE.replace('/api',''));socket.on('connect',()=>socket.emit('join-user',userId));socket.on('notification',showToast);}},{immediate:true});
onMounted(()=>{window.addEventListener('flowdepot:toast',onAppToast);});onUnmounted(()=>{socket?.disconnect();window.removeEventListener('flowdepot:toast',onAppToast);clearTimeout(toastTimer)});
</script>
<template>
<router-view v-if="route.path==='/login'||route.path==='/apply'||route.path==='/spaces'"/>
<div v-else class="shell">
  <aside :class="['sidebar',{open}]">
    <div class="brand"><div class="brand-mark">FD</div><div><b>FlowDepot</b><span>Warehouse Suite</span></div><button class="mobile-close" aria-label="Close menu" @click="open=false"><X/></button></div>
    <nav><div v-for="group in navGroups" :key="group.name" class="nav-group"><div class="nav-heading">{{group.name}}</div><router-link v-for="[label,path,Icon] in group.items" :key="path" :to="path" @click="open=false"><component :is="Icon"/><span>{{label}}</span></router-link></div></nav>
    <div class="profile"><div class="avatar">{{auth.user?.name?.split(' ').map(x=>x[0]).join('').slice(0,2)}}</div><div><b>{{auth.user?.name}}</b><span>{{role.replaceAll('_',' ')}}</span></div><button aria-label="Sign out" title="Sign out" @click="logout"><LogOut/></button></div>
  </aside>
  <main class="main"><header><button class="menu" aria-label="Open menu" @click="open=true"><Menu/></button><div><h2>{{route.meta.title||'Dashboard'}}</h2><p>{{role==='OWNER'?'Portfolio overview and daily operations':role==='DRIVER'?'Your assigned work and delivery tasks':'Warehouse operations and tasks'}}</p></div><div class="head-actions"><button class="iconbtn" aria-label="Notifications" title="Notifications" @click="showToast({title: 'Activity notifications', message: 'Operational alerts appear here as they arrive. Open Issues & Incidents to review actions.'})"><Bell/><i></i></button><span class="status"><em></em>Online</span></div></header><section class="content"><router-view/></section></main>
  <div v-if="open" class="overlay" @click="open=false"></div>
  <div v-if="toast" :class="['toast',toast.type==='error'?'toast-error':toast.type==='warning'?'toast-warning':'toast-success']"><Bell/><div><b>{{toast.title}}</b><span>{{toast.message}}</span></div></div>
</div>
</template>
