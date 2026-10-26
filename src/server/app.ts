// Express app: JSON API for chat and upload, and the built UI. No login, no cookies, no storage.

import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handleTurn, normaliseState } from '../chat';
import { carriers, today } from '../config';
import { checkUpload } from '../upload';

const here = path.dirname(fileURLToPath(import.meta.url));
export const UI_DIST = path.resolve(here, '../../dist');

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function createApp(opts: { uiDist?: string } = {}): express.Express {
  const app = express();
  const uiDist = opts.uiDist ?? UI_DIST;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 2 } });

  app.disable('x-powered-by');
  app.get('/health', (_req, res) => {
    res.json({ ok: true, claude: Boolean(process.env.ANTHROPIC_API_KEY), today: today() });
  });

  app.post('/api/chat', express.json({ limit: '200kb' }), async (req, res) => {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) {
      res.status(400).json({ error: 'Type a message to start.' });
      return;
    }
    try {
      const out = await handleTurn({
        state: req.body.state,
        history: Array.isArray(req.body.history) ? req.body.history.slice(-20) : [],
        message,
      }, today(), carriers);
      res.json({ ...out, state: normaliseState(out.state) });
    } catch (err) {
      console.error('chat failed', err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });

  app.post('/api/upload', upload.fields([{ name: 'bookings', maxCount: 1 }, { name: 'items', maxCount: 1 }]), async (req, res) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const b = files?.bookings?.[0];
    const i = files?.items?.[0];
    if (!b || !i) {
      res.status(400).json({ error: 'Upload both the Bookings and the Items sheet.' });
      return;
    }
    const bad = [b, i].find((f) => !/\.(xlsx|csv)$/i.test(f.originalname));
    if (bad) {
      res.status(400).json({ error: `${bad.originalname} must be an .xlsx or .csv file.` });
      return;
    }
    try {
      const report = await checkUpload({
        bookings: { buffer: b.buffer, filename: b.originalname },
        items: { buffer: i.buffer, filename: i.originalname },
        today: today(),
        carriers,
      });
      res.json(report);
    } catch (err) {
      console.error('upload failed', err);
      res.status(422).json({ error: 'We could not read that file. Check it matches the template and try again.' });
    }
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const tooBig = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
    res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'Each file must be 5 MB or smaller.' : 'Bad request.' });
  });

  if (fs.existsSync(uiDist)) {
    app.use(express.static(uiDist, { index: 'index.html', maxAge: '1h' }));
    app.get(/^\/(?!api\/|health).*/, (_req, res) => res.sendFile(path.join(uiDist, 'index.html')));
  } else {
    app.get('/', (_req, res) => res.type('text').send('UI not built. Run npm run build, then npm start.'));
  }
  return app;
}
