import { defineConfig } from "vite";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  root: ".",
  plugins: [
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
  server: { port: 5173, host: "localhost", open: true },
  build: {
    target: "esnext",
    outDir: "dist",
    rollupOptions: { input: resolve(__dirname, "index.html") },
  },
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version) },
  optimizeDeps: { include: ["three"] },
  assetsInclude: ["**/*.glsl", "**/*.wgsl"],
});
