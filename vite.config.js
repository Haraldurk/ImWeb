import { defineConfig } from "vite";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import fs from "fs";
import basicSsl from "@vitejs/plugin-basic-ssl";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Opt-in HTTPS (npm run dev:https) — iOS blocks getUserMedia on http, so
// camera/mic on the iPad need a secure origin. Off by default: an https
// page cannot reach the http Dev Capture catcher on :5174 (mixed content).
// Prefers the mkcert certificate in certs/ (trusted — no browser warning
// once the mkcert root CA is installed on the device); falls back to
// basic-ssl's self-signed cert if certs/ is absent.
// Regenerate after an IP change:
//   mkcert -key-file certs/dev-key.pem -cert-file certs/dev-cert.pem \
//     localhost 127.0.0.1 $(ipconfig getifaddr en0)
const HTTPS = !!process.env.IMWEB_HTTPS;
const CERT = resolve(dirname(fileURLToPath(import.meta.url)), "certs/dev-cert.pem");
const KEY = resolve(dirname(fileURLToPath(import.meta.url)), "certs/dev-key.pem");
const hasMkcert = fs.existsSync(CERT) && fs.existsSync(KEY);

/**
 * Serve `_imweb_ready/` (prepped clips + manifest.json) over `/_imweb_ready`.
 *
 * The clips are gitignored and live OUTSIDE public/, so `vite build` does not
 * copy them into dist/ — this route is the only way the app can reach them.
 * main.js fetches `/_imweb_ready/manifest.json` at startup to populate the
 * Movie Library, and the catalogue has no persistence (see MovieLibrary.js), so
 * it is rebuilt from that fetch on every load. No route ⇒ empty Movie Library.
 *
 * Registered on the dev server AND the preview server. It used to be dev-only,
 * which meant the Movie Library was always empty under `vite preview` — and
 * `vite preview` is precisely what CLAUDE.md mandates verifying against, since
 * automation rejects the https dev server's self-signed cert. Worse, the failure
 * did not look like a missing route: the SPA fallback answers the manifest
 * request with `index.html` at HTTP 200, so `res.ok` is true and the JSON parse
 * throws instead.
 *
 * Must be installed BEFORE Vite's internal middlewares (i.e. do not return a
 * post hook), or that same SPA fallback wins the race.
 */
const serveRawVideos = (server) => {
  server.middlewares.use('/_imweb_ready', (req, res, next) => {
    const fileName = decodeURIComponent(req.url.replace(/^\//, '').split('?')[0]);
    const filePath = resolve(__dirname, '_imweb_ready', fileName);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return next();
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;
    if (range) {
      const [startStr, endStr] = range.replace('bytes=', '').split('-');
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': 'video/mp4',
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });
};

/**
 * Soak telemetry sink — `POST /__soak`, one JSON object per request, appended
 * as NDJSON to `soak.log` at the repo root.
 *
 * The iPad soak tests read their numbers out of Safari's remote Web Inspector,
 * which makes a cabled debugger a single point of failure for a 40-minute run:
 * when it drops, the phase is unreadable even though the page kept sampling
 * fine. This sink lets the page ship its own numbers to the host instead, so
 * the inspector becomes optional rather than load-bearing.
 *
 * Registered on the dev server AND the preview server, for the same reason
 * serveRawVideos is: CLAUDE.md mandates verifying against `vite preview`.
 *
 * POST is load-bearing, not just semantics — public/sw.js returns early for any
 * request whose method is not GET, so these never enter its cache-first path
 * and cannot be answered from a stale cache.
 *
 * `soak.log` matches the existing `*.log` rule in .gitignore, so run data
 * cannot reach a commit. Do not rename it to `.ndjson` without adding a rule.
 */
const soakSink = (server) => {
  server.middlewares.use('/__soak', (req, res, next) => {
    if (req.method !== 'POST') return next();
    let body = '';
    let over = false;
    req.on('data', (c) => {
      body += c;
      // A wedged client must not be able to grow this without bound.
      if (body.length > 65536) { over = true; req.destroy(); }
    });
    req.on('end', () => {
      if (over) return;
      try {
        fs.appendFileSync(resolve(__dirname, 'soak.log'), body.trim() + '\n');
        res.writeHead(204);
      } catch {
        res.writeHead(500);
      }
      res.end();
    });
  });
};

export default defineConfig({
  root: ".",
  plugins: [
    ...(HTTPS && !hasMkcert ? [basicSsl()] : []),
    {
      name: 'serve-raw-videos',
      configureServer: serveRawVideos,
      configurePreviewServer: serveRawVideos,
    },
    {
      name: 'soak-sink',
      configureServer: soakSink,
      configurePreviewServer: soakSink,
    },
  ],
  server: {
      port: 5173,
      host: true, // <-- Now exposes to local network
      open: true,
      ...(HTTPS && hasMkcert
        ? { https: { cert: fs.readFileSync(CERT), key: fs.readFileSync(KEY) } }
        : {}),
    },
  build: {
    target: "esnext",
    outDir: "dist",
    rollupOptions: { input: resolve(__dirname, "index.html") },
  },
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version) },
  optimizeDeps: { include: ["three"] },
  assetsInclude: ["**/*.glsl", "**/*.wgsl"],
});
