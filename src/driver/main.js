import { createApp } from 'vue';
import { IonicVue } from '@ionic/vue';
import App from './App.vue';
import router from './router';
import '@ionic/vue/css/core.css';
import '@ionic/vue/css/normalize.css';
import '@ionic/vue/css/structure.css';
import '@ionic/vue/css/typography.css';
import './style.css';

const app=createApp(App);
app.use(IonicVue);
app.use(router);
router.isReady().then(()=>app.mount('#app'));
