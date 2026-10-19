// CodeWiDas website server — no external dependencies (Node 18+)
// Run: node server.js   then open http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data', 'messages.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const rateMap = new Map(); // ip -> { count, start }
function rateLimited(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > 15 * 60 * 1000) { entry.count = 0; entry.start = now; }
  entry.count++;
  rateMap.set(ip, entry);
  return entry.count > 5;
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function clean(v, max) {
  return String(v || '').replace(/[<>]/g, '').trim().slice(0, max);
}

function validateContact(d) {
  const errors = {};
  const name = clean(d.name, 100);
  const email = clean(d.email, 150);
  const phone = clean(d.phone, 20);
  const service = clean(d.service, 80);
  const message = clean(d.message, 2000);
  if (name.length < 2) errors.name = 'Name is required.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Valid email is required.';
  if (!service) errors.service = 'Service is required.';
  if (message.length < 10) errors.message = 'Message must be at least 10 characters.';
  if (phone && !/^[+\d\s-]{7,20}$/.test(phone)) errors.phone = 'Phone number looks invalid.';
  return { errors, data: { name, email, phone, service, message } };
}

function saveMessage(entry) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  let list = [];
  try { list = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (_) { list = []; }
  list.push(entry);
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
}

function handleContact(req, res) {
  const ip = req.socket.remoteAddress;
  if (rateLimited(ip)) return sendJson(res, 429, { error: 'Too many requests. Please try again later.' });

  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 20000) { req.destroy(); }
  });
  req.on('end', () => {
    let parsed;
    try { parsed = JSON.parse(body || '{}'); } catch (_) {
      return sendJson(res, 400, { error: 'Invalid request body.' });
    }
    const { errors, data } = validateContact(parsed);
    if (Object.keys(errors).length) {
      return sendJson(res, 422, { error: Object.values(errors)[0], errors });
    }
    const entry = { id: Date.now().toString(36), receivedAt: new Date().toISOString(), ...data };
    try {
      saveMessage(entry);
    } catch (err) {
      console.error('Failed to save message:', err);
      return sendJson(res, 500, { error: 'Could not save your message. Please try again.' });
    }
    console.log(`New enquiry from ${data.name} <${data.email}> (${data.service})`);
    sendJson(res, 201, { ok: true, message: 'Thank you! We will be in touch soon.' });
  });
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const safe = path.normalize(urlPath === '/' ? '/index.html' : urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(ROOT, safe);
  // Block access to server code and stored data
  if (!filePath.startsWith(ROOT) || filePath.startsWith(path.join(ROOT, 'data')) || filePath === path.join(ROOT, 'server.js')) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const type = MIME[path.extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600' });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  // Basic security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (req.method === 'POST' && req.url === '/api/contact') return handleContact(req, res);
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
  res.writeHead(405); res.end('Method not allowed');
});

server.listen(PORT, () => {
  console.log(`CodeWiDas website running at http://localhost:${PORT}`);
});
