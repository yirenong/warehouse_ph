import { io as socketIo } from 'socket.io-client';

// Hosted builds poll persisted notifications so updates do not depend on a
// particular server instance. Local development retains Socket.IO simulation.
export function io(url, options = {}) {
  if(import.meta.env.VITE_REALTIME_MODE !== 'poll') return socketIo(url || window.location.origin, options);
  const listeners = new Map(); let closed = false, initialized = false, version, pending = false;
  const seen = new Set(); const emit = (event, value) => listeners.get(event)?.forEach(fn => fn(value));
  async function poll() {
    if(closed || pending || document.hidden) return;
    const token=localStorage.getItem(options.tokenKey || 'token'); if(!token) return;
    pending = true;
    try {
      const response=await fetch(`${url || ''}/api/live`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
      if(!response.ok) return;
      const data=await response.json(); if(closed) return;
      for(const notification of [...data.notifications].reverse()) {
        if(initialized && !seen.has(notification.id)) emit('notification',notification);
        seen.add(notification.id);
      }
      if(initialized && data.version !== version) {
        emit('process-event',{}); emit('simulation-event',{}); emit('route-updated',{});
      }
      version=data.version; initialized=true;
    } catch { /* Retry on the next interval after a transient connection failure. */ }
    finally {pending=false;}
  }
  const timer=setInterval(poll,15000);
  queueMicrotask(()=>{emit('connect');poll();});
  return { on(event,fn){if(!listeners.has(event))listeners.set(event,[]);listeners.get(event).push(fn);return this;},
    emit(){return this;},disconnect(){closed=true;clearInterval(timer);listeners.clear();} };
}
