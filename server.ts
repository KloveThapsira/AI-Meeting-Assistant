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
  
  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT,
      transcript TEXT,
      summary TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id INTEGER,
      title TEXT NOT NULL,
      assigned_to TEXT,
      deadline TEXT,
      priority TEXT DEFAULT 'Medium',
      status TEXT DEFAULT 'Pending',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(meeting_id) REFERENCES meetings(id)
    );
  `);

  // Migration: Add missing columns if they don't exist (for existing databases)
  try {
    const tableInfo = db.prepare("PRAGMA table_info(tasks)").all() as any[];
    const columns = tableInfo.map(c => c.name);
    
    if (!columns.includes('priority')) {
      db.exec("ALTER TABLE tasks ADD COLUMN priority TEXT DEFAULT 'Medium'");
    }
    if (!columns.includes('meeting_id')) {
      db.exec("ALTER TABLE tasks ADD COLUMN meeting_id INTEGER REFERENCES meetings(id)");
    }
  } catch (e) {
    console.error("Migration error:", e);
  }

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
    const file = req.file as Express.Multer.File;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    res.json({ 
      message: 'File uploaded successfully', 
      filename: file.filename,
      path: file.path 
    });
  });

  app.post('/api/meetings', (req, res) => {
    const { filename, transcript, summary } = req.body;
    const info = db.prepare(
      'INSERT INTO meetings (filename, transcript, summary) VALUES (?, ?, ?)'
    ).run(filename, transcript, summary);
    res.json({ id: info.lastInsertRowid });
  });

  app.get('/api/meetings/latest', (req, res) => {
    const meeting = db.prepare('SELECT * FROM meetings ORDER BY created_at DESC LIMIT 1').get();
    res.json(meeting || null);
  });

  app.get('/api/tasks', (req, res) => {
    const tasks = db.prepare('SELECT * FROM tasks ORDER BY deadline ASC, created_at DESC').all();
    res.json(tasks);
  });

  app.post('/api/tasks', (req, res) => {
    const { title, assigned_to, deadline, notes, priority, meeting_id } = req.body;
    const info = db.prepare(
      'INSERT INTO tasks (title, assigned_to, deadline, notes, priority, meeting_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(title, assigned_to, deadline, notes, priority || 'Medium', meeting_id || null);
    res.json({ id: info.lastInsertRowid });
  });

  app.put('/api/tasks/:id', (req, res) => {
    const { id } = req.params;
    const { title, assigned_to, deadline, notes, priority, status } = req.body;
    db.prepare(`
      UPDATE tasks 
      SET title = ?, assigned_to = ?, deadline = ?, notes = ?, priority = ?, status = ?
      WHERE id = ?
    `).run(title, assigned_to, deadline, notes, priority, status, id);
    res.json({ success: true });
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
