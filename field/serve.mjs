#!/usr/bin/env node
/**
 * Zero-dependency static server for the VisuLab build.
 *
 *   node serve.mjs                 -> http://localhost:8080   (camera works: localhost is a secure context)
 *   node serve.mjs --https         -> https://<your-LAN-IP>:8443  (camera works on a tablet)
 *   node serve.mjs --port 3000
 *
 * WHY HTTPS MATTERS. Browsers only grant camera access on a "secure context". `localhost` counts as
 * one even over plain HTTP, so the laptop works with no certificate. A tablet reaching this machine
 * over the LAN does NOT, so plain HTTP there will silently give you no camera — which would make
 * every ocular measurement empty. Use --https for tablet testing and accept the certificate warning
 * once on the device.
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, 'app');
const argv = process.argv.slice(2);
const useHttps = argv.includes('--https');
const portArg = argv.indexOf('--port');
const PORT = portArg >= 0 ? Number(argv[portArg + 1]) : (useHttps ? 8443 : 8080);

// MIME types. The MediaPipe files are the ones that break silently if served as octet-stream:
// .wasm must be application/wasm for streaming instantiation, and .data/.binarypb are fetched as
// ArrayBuffers by the loader.
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.binarypb': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
};

function handler(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';

  // Contain every request inside ROOT: resolve, then verify the result is still under ROOT.
  const resolved = path.resolve(ROOT, '.' + urlPath);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  fs.stat(resolved, (err, st) => {
    // Single-page app: unknown paths fall back to index.html so a deep link still boots the app.
    const file = err || !st.isFile() ? path.join(ROOT, 'index.html') : resolved;
    fs.readFile(file, (e, buf) => {
      if (e) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        // No caching: you are timing a protocol, and a stale service worker or asset would make
        // you measure yesterday's build without noticing.
        'Cache-Control': 'no-store',
      });
      res.end(buf);
    });
  });
}

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
}

function ensureCert() {
  const key = path.join(HERE, 'localhost-key.pem');
  const crt = path.join(HERE, 'localhost-cert.pem');
  if (fs.existsSync(key) && fs.existsSync(crt)) return { key, crt };
  const ips = lanAddresses();
  const san = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((i) => `IP:${i}`)].join(',');
  console.log(`Generating a self-signed certificate for: ${san}`);
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '365',
    '-keyout', key, '-out', crt,
    '-subj', '/CN=VisuLab local', '-addext', `subjectAltName=${san}`,
  ], { stdio: 'inherit' });
  return { key, crt };
}

let server;
if (useHttps) {
  const { key, crt } = ensureCert();
  server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(crt) }, handler);
} else {
  server = http.createServer(handler);
}

server.listen(PORT, '0.0.0.0', () => {
  const scheme = useHttps ? 'https' : 'http';
  console.log(`\n  VisuLab is serving ${ROOT}\n`);
  console.log(`  On this machine : ${scheme}://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  On the tablet   : ${scheme}://${ip}:${PORT}`);
  if (!useHttps) {
    console.log('\n  NOTE: over plain HTTP the camera works on localhost ONLY. For the tablet,');
    console.log('        stop this and run:  node serve.mjs --https');
  } else {
    console.log('\n  The tablet will warn about the self-signed certificate. Accept it once.');
  }
  console.log('\n  Ctrl-C to stop.\n');
});
