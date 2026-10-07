// One entry point. Load only the requested interface's router and styles.
if (/^\/driver(?:\/|$)/.test(window.location.pathname)) {
  document.title = 'FlowDepot — Driver Workspace';
  await import('./driver/main.js');
} else {
  await import('./portal/main.js');
}
