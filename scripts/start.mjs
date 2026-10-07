process.env.SERVE_FRONTENDS = 'true';
process.env.PORT ||= '5182';
await import('../server/src/index.js');
