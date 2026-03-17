import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import multer from 'multer';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Database setup
  const db = new Database('meeting_assistant.db');
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      assigned_to TEXT,
      deadline TEXT,
      status TEXT DEFAULT 'Pending',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  app.use(express.json());

  // Multer setup for audio uploads
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + '-' + file.originalname);
    }
  });
  const upload = multer({ storage });

  // API Routes
  app.post('/api/upload', upload.single('audio'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    res.json({ 
      message: 'File uploaded successfully', 
      filename: req.file.filename,
      path: req.file.path 
    });
  });

  app.get('/api/tasks', (req, res) => {
    const tasks = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all();
    res.json(tasks);
  });

  app.post('/api/tasks', (req, res) => {
    const { title, assigned_to, deadline, notes } = req.body;
    const info = db.prepare(
      'INSERT INTO tasks (title, assigned_to, deadline, notes) VALUES (?, ?, ?, ?)'
    ).run(title, assigned_to, deadline, notes);
    res.json({ id: info.lastInsertRowid });
  });

  app.post('/api/tasks/:id/complete', (req, res) => {
    const { id } = req.params;
    db.prepare("UPDATE tasks SET status = 'Completed' WHERE id = ?").run(id);
    res.json({ success: true });
  });

  app.delete('/api/tasks/:id', (req, res) => {
    const { id } = req.params;
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
