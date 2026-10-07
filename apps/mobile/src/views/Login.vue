<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent, IonButton, IonIcon } from '@ionic/vue';
import { cubeOutline, arrowForwardOutline } from 'ionicons/icons';
import { api } from '../api';
const demoMode=String(import.meta.env.VITE_DEMO_MODE??'true')==='true';
const email=ref(demoMode?'driver@demo.com':''),password=ref(demoMode?'Driver123!':''),error=ref(''),busy=ref(false),router=useRouter();
async function login(){error.value='';busy.value=true;try{const {data}=await api.post('/auth/login',{email:email.value,password:password.value});localStorage.setItem('driverToken',data.token);localStorage.setItem('driverUser',JSON.stringify(data.user));router.replace('/driver/app/today')}catch(e){error.value=e.response?.data?.error||'Unable to sign in. Please try again.'}finally{busy.value=false}}
</script>
<template><ion-page><ion-content><div class="loginm">
  <div class="mobile-brand"><span class="mobile-brand-mark"><ion-icon :icon="cubeOutline"/></span><div><b>FlowDepot</b><small>DRIVER WORKSPACE</small></div></div>
  <a class="portal-return portal-return-light" href="/login"><span aria-hidden="true">←</span> Back to FlowDepot login</a>
  <div class="login-intro"><span class="login-kicker">READY FOR THE ROAD</span><h1>Your route.<br>Your day.<br><em>All in one place.</em></h1><p>From first pickup to final delivery, keep your work moving with FlowDepot.</p><div class="login-steps"><span>01 &nbsp; Pick up</span><span>02 &nbsp; Deliver</span><span>03 &nbsp; Sign off</span></div></div>
  <form class="logincard" @submit.prevent="login"><h2>Let's get moving</h2><p>Sign in to your field operations account.</p><label for="driver-email">Email address</label><input id="driver-email" v-model="email" type="email" autocomplete="username" placeholder="you@company.com" required/><label for="driver-password">Password</label><input id="driver-password" v-model="password" type="password" autocomplete="current-password" placeholder="Enter your password" required/><div v-if="error" class="login-error" role="alert">{{error}}</div><ion-button type="submit" expand="block" :disabled="busy">{{busy?'Signing in…':'Sign in to my workspace'}}<ion-icon slot="end" :icon="arrowForwardOutline"/></ion-button><div v-if="demoMode" class="note"><b>Try the driver workspace</b><span>driver@demo.com / Driver123!</span><span>Manager: manager@demo.com / Manager123!</span></div></form>
  <p class="login-footer">Every handoff. Every delivery. Connected.</p>
</div></ion-content></ion-page></template>
