import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const storage = multer.diskStorage({
  destination: path.join(__dirname, 'Brainstorms'),
  filename: (_req, file, cb) => {
    const ts = Math.floor(Date.now() / 1000);
    cb(null, `${ts}-${file.originalname}`);
  },
});
const upload = multer({ storage, limits: { fieldSize: 50 * 1024 * 1024 } });

const app = express();
app.use(cors());

app.post('/capture', upload.any(), (req, res) => {
  const saved = (req.files ?? []).map(f => f.filename);
  console.log('[catcher] saved:', saved);
  res.json({ ok: true, saved });
});

app.listen(5174, () => console.log('[catcher] listening on http://localhost:5174'));
