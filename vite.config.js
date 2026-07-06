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

export default defineConfig({
  root: ".",
  plugins: [
    ...(HTTPS && !hasMkcert ? [basicSsl()] : []),
    {
      name: 'serve-raw-videos',
      configureServer(server) {
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
      },
    },
  ],
  server: {
    port: 5173,
    host: "localhost",
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
