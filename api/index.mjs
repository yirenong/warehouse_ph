let application;

export default async function handler(req, res) {
  const missing = [];
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET === 'demo-change-me') missing.push('JWT_SECRET');
  if (missing.length) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({
      error: 'Server setup incomplete',
      missing,
      message: 'Set DATABASE_URL and a JWT_SECRET of at least 32 characters in Vercel, initialize the database, then redeploy.'
    }));
    return;
  }
  try {
    application ||= import('../server/src/index.js');
    const { default: app } = await application;
    await new Promise((resolve, reject) => {
      res.once('finish', resolve);
      res.once('close', resolve);
      res.once('error', reject);
      app(req, res);
    });
  } catch (error) {
    application = undefined;
    console.error('FlowDepot API startup failed:', error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({error: 'API startup failed. Check the Vercel Function logs.'}));
    } else if (!res.writableEnded) res.end();
  }
}
