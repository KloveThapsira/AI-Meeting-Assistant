import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import multer from 'multer';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import cron from 'node-cron';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Ensure uploads directory exists
  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

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
      email TEXT,
      reminder_sent INTEGER DEFAULT 0,
      auto_alert_enabled INTEGER DEFAULT 1,
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
    if (!columns.includes('email')) {
      db.exec("ALTER TABLE tasks ADD COLUMN email TEXT");
    }
    if (!columns.includes('reminder_sent')) {
      db.exec("ALTER TABLE tasks ADD COLUMN reminder_sent INTEGER DEFAULT 0");
    }
    if (!columns.includes('auto_alert_enabled')) {
      db.exec("ALTER TABLE tasks ADD COLUMN auto_alert_enabled INTEGER DEFAULT 1");
    }
  } catch (e) {
    console.error("Migration error:", e);
  }

  app.use(express.json());

  // Email Transporter Setup
  const getTransporter = () => {
    const host = process.env.EMAIL_HOST;
    const port = parseInt(process.env.EMAIL_PORT || '587');
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;

    if (!user || !pass) {
      return null;
    }

    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  };

  // Multer setup for audio uploads
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + '-' + file.originalname);
    }
  });
  const upload = multer({ 
    storage,
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
  });

  // API Routes
  app.post('/api/upload', (req, res) => {
    upload.single('audio')(req, res, (err) => {
      if (err) {
        console.error('Multer error:', err);
        if (err instanceof multer.MulterError) {
          return res.status(400).json({ error: `Upload error: ${err.message}` });
        }
        return res.status(500).json({ error: `Server error during upload: ${err.message}` });
      }

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
  });

  app.post('/api/meetings', (req, res) => {
    const { filename, transcript, summary } = req.body;
    const info = db.prepare(
      'INSERT INTO meetings (filename, transcript, summary) VALUES (?, ?, ?)'
    ).run(filename, transcript, summary);
    res.json({ id: info.lastInsertRowid });
  });

  app.get('/api/meetings', (req, res) => {
    const meetings = db.prepare('SELECT * FROM meetings ORDER BY created_at DESC').all();
    res.json(meetings);
  });

  app.get('/api/meetings/latest', (req, res) => {
    const meeting = db.prepare('SELECT * FROM meetings ORDER BY created_at DESC LIMIT 1').get();
    res.json(meeting || null);
  });

  app.delete('/api/meetings/:id', (req, res) => {
    const { id } = req.params;
    db.transaction(() => {
      db.prepare('DELETE FROM tasks WHERE meeting_id = ?').run(id);
      db.prepare('DELETE FROM meetings WHERE id = ?').run(id);
    })();
    res.json({ success: true });
  });

  app.delete('/api/meetings', (req, res) => {
    db.transaction(() => {
      db.prepare('DELETE FROM tasks').run();
      db.prepare('DELETE FROM meetings').run();
    })();
    res.json({ success: true });
  });

  app.get('/api/tasks', (req, res) => {
    const tasks = db.prepare('SELECT * FROM tasks ORDER BY deadline ASC, created_at DESC').all();
    res.json(tasks);
  });

  app.post('/api/tasks', (req, res) => {
    const { title, assigned_to, deadline, notes, priority, meeting_id, email, auto_alert_enabled } = req.body;
    const info = db.prepare(
      'INSERT INTO tasks (title, assigned_to, deadline, notes, priority, meeting_id, email, auto_alert_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(title, assigned_to, deadline, notes, priority || 'Medium', meeting_id || null, email || null, auto_alert_enabled ?? 1);
    res.json({ id: info.lastInsertRowid });
  });

  app.put('/api/tasks/:id', (req, res) => {
    const { id } = req.params;
    const { title, assigned_to, deadline, notes, priority, status, email, auto_alert_enabled } = req.body;
    db.prepare(`
      UPDATE tasks 
      SET title = ?, assigned_to = ?, deadline = ?, notes = ?, priority = ?, status = ?, email = ?, auto_alert_enabled = ?
      WHERE id = ?
    `).run(title, assigned_to, deadline, notes, priority, status, email, auto_alert_enabled ?? 1, id);
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

  app.post('/api/tasks/clear', (req, res) => {
    db.prepare('DELETE FROM tasks').run();
    res.json({ success: true });
  });

  app.post('/api/send-email', async (req, res) => {
    const { to, subject, text } = req.body;
    
    const transporter = getTransporter();
    if (!transporter) {
      console.warn("Email credentials missing in .env. Email not sent.");
      return res.status(500).json({ error: 'Email service not configured. Please set EMAIL_USER and EMAIL_PASS in .env' });
    }

    try {
      await transporter.sendMail({
        from: `"MeetingAI Assistant" <${process.env.EMAIL_USER}>`,
        to,
        subject,
        text,
      });
      res.json({ success: true });
    } catch (error) {
      console.error('Email error:', error);
      res.status(500).json({ error: 'Failed to send email' });
    }
  });

  // Automatic Email Reminders Cron Job (Runs every day at 9:00 AM)
  cron.schedule('0 9 * * *', async () => {
    console.log('Running daily email reminder check...');
    const transporter = getTransporter();
    if (!transporter) return;

    const now = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    // 1. Check for deadlines due tomorrow
    const tasksDueTomorrow = db.prepare(`
      SELECT * FROM tasks 
      WHERE deadline LIKE ? AND status = 'Pending' AND reminder_sent = 0 AND email IS NOT NULL AND auto_alert_enabled = 1
    `).all(`${tomorrowStr}%`) as any[];

    for (const task of tasksDueTomorrow) {
      try {
        const subject = `Upcoming Deadline: ${task.title}`;
        const text = `Hi ${task.assigned_to},\n\nThis is an automated reminder that your task "${task.title}" is due tomorrow (${task.deadline}).\n\nPriority: ${task.priority}\nNotes: ${task.notes || 'N/A'}\n\nPlease complete it soon!\n\nSent via MeetingAI Assistant`;

        await transporter.sendMail({
          from: `"MeetingAI Assistant" <${process.env.EMAIL_USER}>`,
          to: task.email,
          subject,
          text,
        });

        db.prepare('UPDATE tasks SET reminder_sent = 1 WHERE id = ?').run(task.id);
        console.log(`Sent automated reminder to ${task.email} for task ${task.id}`);
      } catch (error) {
        console.error(`Failed to send automated reminder for task ${task.id}:`, error);
      }
    }

    // 2. Check for tasks with no deadline after 5 days
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    const fiveDaysAgoStr = fiveDaysAgo.toISOString().split('T')[0];

    const tasksNoDeadline = db.prepare(`
      SELECT * FROM tasks 
      WHERE (deadline = 'Unknown' OR deadline IS NULL) 
      AND status = 'Pending' 
      AND reminder_sent = 0 
      AND email IS NOT NULL 
      AND auto_alert_enabled = 1
      AND created_at <= ?
    `).all(fiveDaysAgoStr) as any[];

    for (const task of tasksNoDeadline) {
      try {
        const subject = `Follow-up: ${task.title}`;
        const text = `Hi ${task.assigned_to},\n\nThis is an automated follow-up for your task "${task.title}" which was assigned 5 days ago.\n\nNo specific deadline was set. Please provide an update on your progress.\n\nNotes: ${task.notes || 'N/A'}\n\nSent via MeetingAI Assistant`;

        await transporter.sendMail({
          from: `"MeetingAI Assistant" <${process.env.EMAIL_USER}>`,
          to: task.email,
          subject,
          text,
        });

        db.prepare('UPDATE tasks SET reminder_sent = 1 WHERE id = ?').run(task.id);
        console.log(`Sent 5-day follow-up to ${task.email} for task ${task.id}`);
      } catch (error) {
        console.error(`Failed to send 5-day follow-up for task ${task.id}:`, error);
      }
    }
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
