import axios from 'axios';
export const API_BASE=import.meta.env.VITE_API_URL || '/api';
export const api=axios.create({baseURL:API_BASE});
api.interceptors.request.use(c=>{const t=localStorage.getItem('token');if(t)c.headers.Authorization=`Bearer ${t}`;return c;});
