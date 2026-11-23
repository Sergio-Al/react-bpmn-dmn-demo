// Vercel function: serves the Fastify API under /api for the hosted demo.
// vercel.json rewrites /api/* here; the web app (apps/web/dist) is served as static files.
import { buildApp } from '../apps/api/dist/app.js';

const app = buildApp();
const ready = app.ready();

export default async function handler(req, res) {
  await ready;
  // The API's routes have no /api prefix (Vite's dev proxy strips it too).
  req.url = req.url.replace(/^\/api(?=\/|\?|$)/, '') || '/';
  app.server.emit('request', req, res);
}
