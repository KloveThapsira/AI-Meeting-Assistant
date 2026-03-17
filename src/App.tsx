/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, 
  FileText, 
  CheckCircle2, 
  Clock, 
  User, 
  Calendar, 
  Plus, 
  Trash2, 
  Search, 
  Filter, 
  BarChart3, 
  Moon, 
  Sun,
  Download,
  FileSpreadsheet,
  FileJson,
  Loader2,
  Mic,
  Mail,
  X,
  History,
  Info,
  Bell,
  BellOff,
  FileDown,
  Trash
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { GoogleGenAI, Type } from "@google/genai";
import { format, parseISO, isValid } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Types
interface Task {
  id: number;
  title: string;
  assigned_to: string;
  deadline: string;
  priority: 'Low' | 'Medium' | 'High';
  status: 'Pending' | 'Completed';
  notes: string;
  email?: string;
  auto_alert_enabled: number;
  created_at: string;
}

interface Meeting {
  id: number;
  filename: string;
  transcript: string;
  summary: string;
  created_at: string;
}

interface AIResult {
  transcript: string;
  summary: string;
  tasks: {
    task: string;
    assigned_to: string;
    deadline: string;
    priority: 'Low' | 'Medium' | 'High';
    notes: string;
    email?: string;
  }[];
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [latestMeeting, setLatestMeeting] = useState<Meeting | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'All' | 'Pending' | 'Completed'>('All');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [showNotification, setShowNotification] = useState<{message: string, type: 'success' | 'info'} | null>(null);
  const [emailModal, setEmailModal] = useState<{ isOpen: boolean, task: Task | null, email: string }>({
    isOpen: false,
    task: null,
    email: ''
  });
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize Gemini
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

  useEffect(() => {
    fetchTasks();
    fetchMeetings();
    fetchLatestMeeting();
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setIsDarkMode(true);
    }
  }, []);

  useEffect(() => {
    if (showNotification) {
      const timer = setTimeout(() => setShowNotification(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [showNotification]);

  const fetchTasks = async () => {
    try {
      const response = await fetch('/api/tasks');
      const data = await response.json();
      setTasks(data);
    } catch (error) {
      console.error('Error fetching tasks:', error);
    }
  };

  const fetchMeetings = async () => {
    try {
      const response = await fetch('/api/meetings');
      const data = await response.json();
      setMeetings(data);
    } catch (error) {
      console.error('Error fetching meetings:', error);
    }
  };

  const fetchLatestMeeting = async () => {
    try {
      const response = await fetch('/api/meetings/latest');
      const data = await response.json();
      setLatestMeeting(data);
    } catch (error) {
      console.error('Error fetching meeting:', error);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!file) return;
    
    setIsUploading(true);
    setIsProcessing(true);
    
    try {
      const formData = new FormData();
      formData.append('audio', file);
      
      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      
      if (!uploadRes.ok) throw new Error('Upload failed');
      const uploadData = await uploadRes.json();

      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onloadend = async () => {
        const base64Data = (reader.result as string).split(',')[1];
        
        try {
          const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: [
              {
                parts: [
                  {
                    inlineData: {
                      mimeType: file.type,
                      data: base64Data
                    }
                  },
                  {
                    text: `Transcribe this meeting audio and extract every single actionable task, assignment, and deadline mentioned. 
                    
                    CRITICAL INSTRUCTIONS:
                    1. Identify the person assigned to each task. Look for phrases like "I will...", "Can you...", "[Name] should...", etc.
                    2. If a task is mentioned but no one is explicitly assigned, try to infer the owner from context or use "General/Team".
                    3. Extract deadlines even if they are vague (e.g., "by end of week").
                    4. Provide a concise summary of the meeting.
                    
                    Return a JSON object with:
                    - transcript: the full transcription
                    - summary: a concise 3-4 sentence summary of the meeting highlights
                    - tasks: an array of objects with { task, assigned_to, deadline, priority, notes, email }.
                    
                    CRITICAL: If an email address is mentioned in relation to a person or task, extract it into the 'email' field.
                    
                    For priority, choose from "Low", "Medium", or "High" based on the urgency discussed.
                    For deadlines, convert natural language into YYYY-MM-DD format based on today's date: ${new Date().toISOString().split('T')[0]}.
                    If deadline is missing, use "Unknown".`
                  }
                ]
              }
            ],
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  transcript: { type: Type.STRING },
                  summary: { type: Type.STRING },
                  tasks: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        task: { type: Type.STRING },
                        assigned_to: { type: Type.STRING },
                        deadline: { type: Type.STRING },
                        priority: { type: Type.STRING, enum: ["Low", "Medium", "High"] },
                        notes: { type: Type.STRING },
                        email: { type: Type.STRING }
                      },
                      required: ["task", "assigned_to", "deadline", "priority", "notes"]
                    }
                  }
                },
                required: ["transcript", "summary", "tasks"]
              }
            }
          });

          const resultText = response.text;
          if (!resultText) throw new Error("AI returned empty response");
          
          const result: AIResult = JSON.parse(resultText);
          
          // Save meeting
          const meetingRes = await fetch('/api/meetings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: uploadData.filename,
              transcript: result.transcript,
              summary: result.summary
            }),
          });
          const meetingData = await meetingRes.json();

          // Save tasks sequentially to ensure they are all processed
          if (result.tasks && result.tasks.length > 0) {
            for (const taskData of result.tasks) {
              await fetch('/api/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  title: taskData.task,
                  assigned_to: taskData.assigned_to,
                  deadline: taskData.deadline,
                  priority: taskData.priority,
                  notes: taskData.notes,
                  email: taskData.email,
                  meeting_id: meetingData.id
                }),
              });
            }
            setShowNotification({ message: `Successfully extracted ${result.tasks.length} tasks!`, type: 'success' });
          } else {
            setShowNotification({ message: "Meeting processed, but no specific tasks were identified.", type: 'info' });
          }

          fetchTasks();
          fetchLatestMeeting();
          setIsProcessing(false);
          setIsUploading(false);
        } catch (error) {
          console.error('AI Processing error:', error);
          setShowNotification({ message: "Error processing meeting audio. Please try again.", type: 'info' });
          setIsProcessing(false);
          setIsUploading(false);
        }
      };
    } catch (error) {
      console.error('Upload error:', error);
      setShowNotification({ message: "Failed to upload audio file.", type: 'info' });
      setIsUploading(false);
      setIsProcessing(false);
    }
  };

  const handleSendReminder = (task: Task) => {
    const defaultEmail = task.email || `${task.assigned_to.toLowerCase().replace(/\s/g, '.')}@example.com`;
    setEmailModal({
      isOpen: true,
      task,
      email: defaultEmail
    });
  };

  const confirmSendEmail = async () => {
    if (!emailModal.task || !emailModal.email) return;

    const { task, email } = emailModal;
    
    // Update task with email if it was changed or newly provided
    if (task.email !== email) {
      try {
        await fetch(`/api/tasks/${task.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...task,
            email: email
          }),
        });
        fetchTasks();
      } catch (error) {
        console.error('Error updating task email:', error);
      }
    }

    const subject = `[Action Required] Meeting Reminder: ${task.title}`;
    const message = `
Hi ${task.assigned_to},

This is an automated reminder for a task assigned to you from a recent meeting.

TASK DETAILS:
--------------------------------------------------
Title: ${task.title}
Deadline: ${task.deadline}
Priority: ${task.priority}
Status: ${task.status}
Notes: ${task.notes || 'No additional notes provided.'}
--------------------------------------------------

Please ensure this task is completed by the deadline. You can manage your tasks and view meeting history in the MeetingAI Assistant dashboard.

Best regards,
MeetingAI Assistant
    `.trim();
    
    setEmailModal(prev => ({ ...prev, isOpen: false }));
    setIsProcessing(true);

    try {
      const response = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: email,
          subject,
          text: message
        }),
      });

      if (response.ok) {
        setShowNotification({ message: `Reminder sent to ${email}!`, type: 'success' });
      } else {
        const data = await response.json();
        setShowNotification({ message: data.error || "Failed to send email.", type: 'info' });
      }
    } catch (error) {
      console.error('Error sending email:', error);
      setShowNotification({ message: "Error connecting to email service.", type: 'info' });
    } finally {
      setIsProcessing(false);
    }
  };

  const getDeadlineStatus = (deadline: string) => {
    if (deadline === 'Unknown') return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDate = new Date(deadline);
    dueDate.setHours(0, 0, 0, 0);

    if (dueDate < today) return 'Overdue';
    if (dueDate.getTime() === today.getTime()) return 'Due Today';
    const diffTime = dueDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays <= 3) return 'Upcoming';
    return null;
  };

  const priorityColors = {
    High: "text-rose-500 bg-rose-500/10 border-rose-500/20",
    Medium: "text-amber-500 bg-amber-500/10 border-amber-500/20",
    Low: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20"
  };

  const deadlineStatusColors = {
    'Overdue': "text-rose-600 bg-rose-100 dark:bg-rose-900/30 dark:text-rose-400",
    'Due Today': "text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400",
    'Upcoming': "text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400"
  };

  const toggleTaskStatus = async (id: number) => {
    try {
      await fetch(`/api/tasks/${id}/complete`, { method: 'POST' });
      fetchTasks();
    } catch (error) {
      console.error('Error completing task:', error);
    }
  };

  const deleteTask = async (id: number) => {
    try {
      await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
      fetchTasks();
      setShowNotification({ message: "Task deleted", type: 'info' });
    } catch (error) {
      console.error('Error deleting task:', error);
    }
  };

  const clearAllTasks = async () => {
    try {
      await fetch('/api/tasks/clear', { method: 'POST' });
      fetchTasks();
      setShowNotification({ message: "All tasks cleared", type: 'info' });
      setShowClearConfirm(false);
    } catch (error) {
      console.error('Error clearing tasks:', error);
    }
  };

  const downloadSingleTaskPDF = (task: Task) => {
    const doc = new jsPDF() as any;
    
    doc.setFontSize(22);
    doc.setTextColor(79, 70, 229); // indigo-600
    doc.text("Task Details", 14, 22);
    
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated on ${format(new Date(), 'PPP p')}`, 14, 30);
    
    doc.setDrawColor(229, 231, 235);
    doc.line(14, 35, 196, 35);

    const data = [
      ["Title", task.title],
      ["Assigned To", task.assigned_to],
      ["Deadline", task.deadline],
      ["Priority", task.priority],
      ["Status", task.status],
      ["Email", task.email || 'N/A'],
      ["Notes", task.notes || 'No additional notes.']
    ];

    autoTable(doc, {
      startY: 45,
      body: data,
      theme: 'plain',
      styles: { fontSize: 12, cellPadding: 5 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 40 },
        1: { cellWidth: 'auto' }
      }
    });

    doc.save(`Task_${task.id}_${task.title.replace(/\s+/g, '_')}.pdf`);
  };

  const toggleAutoAlert = async (task: Task) => {
    try {
      const updatedTask = { ...task, auto_alert_enabled: task.auto_alert_enabled === 1 ? 0 : 1 };
      await fetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedTask),
      });
      fetchTasks();
      if (selectedTask?.id === task.id) {
        setSelectedTask(updatedTask);
      }
      setShowNotification({ 
        message: `Auto-alerts ${updatedTask.auto_alert_enabled ? 'enabled' : 'disabled'}`, 
        type: 'success' 
      });
    } catch (error) {
      console.error('Error toggling auto-alert:', error);
    }
  };

  const downloadPDF = () => {
    const doc = new jsPDF() as any;
    
    doc.setFontSize(20);
    doc.text("MeetingAI Task List", 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated on ${format(new Date(), 'PPP p')}`, 14, 30);
    
    const tableData = tasks.map(t => [
      t.title,
      t.assigned_to,
      t.deadline,
      t.priority,
      t.status,
      t.email || 'N/A'
    ]);

    autoTable(doc, {
      startY: 40,
      head: [['Task', 'Assigned To', 'Deadline', 'Priority', 'Status', 'Email']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [79, 70, 229] }, // indigo-600
    });

    doc.save(`MeetingAI_Tasks_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
  };

  const filteredTasks = tasks.filter(task => {
    const matchesSearch = task.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         task.assigned_to.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterStatus === 'All' || task.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const stats = {
    total: tasks.length,
    completed: tasks.filter(t => t.status === 'Completed').length,
    pending: tasks.filter(t => t.status === 'Pending').length
  };

  const exportToExcel = () => {
    const csvContent = "data:text/csv;charset=utf-8," 
      + "Title,Assigned To,Deadline,Status,Notes\n"
      + tasks.map(t => `"${t.title}","${t.assigned_to}","${t.deadline}","${t.status}","${t.notes}"`).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "meeting_tasks.csv");
    document.body.appendChild(link);
    link.click();
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className={cn(
      "min-h-screen transition-colors duration-300",
      isDarkMode ? "bg-[#0a0a0a] text-white" : "bg-[#f8f9fa] text-slate-900"
    )}>
      {/* Notifications */}
      <AnimatePresence>
        {showNotification && (
          <motion.div
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 20 }}
            exit={{ opacity: 0, y: -50 }}
            className={cn(
              "fixed top-0 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border",
              showNotification.type === 'success' ? "bg-emerald-500 text-white border-emerald-400" : "bg-indigo-500 text-white border-indigo-400"
            )}
          >
            {showNotification.type === 'success' ? <CheckCircle2 size={20} /> : <FileText size={20} />}
            <span className="font-medium">{showNotification.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Navigation */}
      <nav className={cn(
        "sticky top-0 z-50 backdrop-blur-md border-b px-6 py-4 flex items-center justify-between",
        isDarkMode ? "bg-black/50 border-white/10" : "bg-white/50 border-black/5"
      )}>
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
            <Mic size={24} />
          </div>
          <h1 className="text-xl font-bold tracking-tight">MeetingAI Assistant</h1>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={cn(
                "p-2 rounded-lg transition-all flex items-center gap-2",
                isDarkMode ? "hover:bg-white/10 text-slate-300" : "hover:bg-black/5 text-slate-600"
              )}
              title="View History"
            >
              <History size={20} />
              <span className="hidden sm:inline font-medium text-sm">History</span>
            </button>
            <button 
              onClick={() => setIsDarkMode(!isDarkMode)}
              className={cn(
                "p-2 rounded-lg transition-colors",
                isDarkMode ? "hover:bg-white/10" : "hover:bg-black/5"
              )}
            >
              {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          </div>
          <div className="h-6 w-px bg-slate-300 dark:bg-slate-700 mx-2" />
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-medium text-sm">
              KK
            </div>
            <span className="text-sm font-medium hidden sm:inline">Kishore Kannan</span>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-6 space-y-8">
        {showHistory ? (
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
                  <History size={24} />
                </div>
                <div>
                  <h2 className="text-2xl font-bold">Meeting History</h2>
                  <p className="text-slate-500 text-sm">Review past transcripts and summaries</p>
                </div>
              </div>
              <button
                onClick={() => setShowHistory(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-zinc-800 font-medium hover:bg-slate-200 dark:hover:bg-zinc-700 transition-all"
              >
                Back to Dashboard
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {meetings.length > 0 ? (
                meetings.map((m) => (
                  <div 
                    key={m.id}
                    className={cn(
                      "p-6 rounded-3xl border transition-all",
                      isDarkMode ? "bg-zinc-900 border-white/10" : "bg-white border-black/5 shadow-sm"
                    )}
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="font-bold text-lg">{m.filename}</h3>
                        <p className="text-xs text-slate-500">{format(parseISO(m.created_at), 'PPP p')}</p>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-500 mb-2">Summary</h4>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{m.summary}</p>
                      </div>
                      <details className="group">
                        <summary className="text-xs font-bold uppercase tracking-wider text-slate-400 cursor-pointer hover:text-indigo-500 transition-colors list-none flex items-center gap-1">
                          View Full Transcript
                        </summary>
                        <div className="mt-4 p-4 rounded-2xl bg-slate-50 dark:bg-zinc-800/50 text-sm text-slate-600 dark:text-slate-400 leading-relaxed max-h-60 overflow-y-auto">
                          {m.transcript}
                        </div>
                      </details>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-20 opacity-50">
                  <History size={48} className="mx-auto mb-4" />
                  <p>No meeting history found.</p>
                </div>
              )}
            </div>
          </motion.section>
        ) : (
          <>
            {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              "p-6 rounded-2xl border flex items-center gap-4",
              isDarkMode ? "bg-zinc-900/50 border-white/10" : "bg-white border-black/5 shadow-sm"
            )}
          >
            <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <BarChart3 size={24} />
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">Total Tasks</p>
              <p className="text-2xl font-bold">{stats.total}</p>
            </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className={cn(
              "p-6 rounded-2xl border flex items-center gap-4",
              isDarkMode ? "bg-zinc-900/50 border-white/10" : "bg-white border-black/5 shadow-sm"
            )}
          >
            <div className="w-12 h-12 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 size={24} />
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">Completed</p>
              <p className="text-2xl font-bold">{stats.completed}</p>
            </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className={cn(
              "p-6 rounded-2xl border flex items-center gap-4",
              isDarkMode ? "bg-zinc-900/50 border-white/10" : "bg-white border-black/5 shadow-sm"
            )}
          >
            <div className="w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-amber-600 dark:text-amber-400">
              <Clock size={24} />
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">Pending</p>
              <p className="text-2xl font-bold">{stats.pending}</p>
            </div>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Upload & Transcript */}
          <div className="lg:col-span-1 space-y-6">
            <section className={cn(
              "p-6 rounded-2xl border",
              isDarkMode ? "bg-zinc-900/50 border-white/10" : "bg-white border-black/5 shadow-sm"
            )}>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Upload size={20} className="text-indigo-500" />
                Upload Meeting Audio
              </h2>
              
              <div 
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all",
                  dragActive 
                    ? "border-indigo-500 bg-indigo-500/5" 
                    : "border-slate-300 dark:border-slate-700 hover:border-indigo-400",
                  (isUploading || isProcessing) && "opacity-50 pointer-events-none"
                )}
              >
                <input 
                  type="file" 
                  ref={fileInputRef}
                  onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
                  className="hidden" 
                  accept="audio/*"
                />
                <div className="w-12 h-12 rounded-full bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center text-indigo-600">
                  {isProcessing ? <Loader2 className="animate-spin" /> : <Upload size={24} />}
                </div>
                <div className="text-center">
                  <p className="font-medium">Click or drag audio file</p>
                  <p className="text-xs text-slate-500 mt-1">MP3, WAV, M4A up to 25MB</p>
                </div>
              </div>

              {isProcessing && (
                <div className="mt-4 space-y-2">
                  <div className="flex justify-between text-xs font-medium">
                    <span>AI is processing...</span>
                    <span>Transcribing & Extracting</span>
                  </div>
                  <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: "100%" }}
                      transition={{ duration: 15, ease: "linear" }}
                      className="h-full bg-indigo-500"
                    />
                  </div>
                </div>
              )}
            </section>

            {latestMeeting && (
              <motion.section 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className={cn(
                  "p-6 rounded-2xl border",
                  isDarkMode ? "bg-indigo-900/20 border-indigo-500/30" : "bg-indigo-50 border-indigo-100 shadow-sm"
                )}
              >
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                  <BarChart3 size={20} />
                  Meeting Summary
                </h2>
                <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300 italic">
                  {latestMeeting.summary}
                </p>
              </motion.section>
            )}

            <section className={cn(
              "p-6 rounded-2xl border h-[300px] flex flex-col",
              isDarkMode ? "bg-zinc-900/50 border-white/10" : "bg-white border-black/5 shadow-sm"
            )}>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <FileText size={20} className="text-indigo-500" />
                Transcript Viewer
              </h2>
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                {latestMeeting?.transcript ? (
                  <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
                    {latestMeeting.transcript}
                  </p>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center">
                    <FileText size={48} strokeWidth={1} className="mb-2 opacity-20" />
                    <p className="text-sm">No transcript available.<br/>Upload audio to start processing.</p>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Right Column: Tasks */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
                  <CheckCircle2 size={24} />
                </div>
                <div>
                  <h2 className="text-2xl font-bold">Action Items</h2>
                  <p className="text-slate-500 text-sm">Track and manage your meeting tasks</p>
                </div>
              </div>
              
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={downloadPDF}
                  className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 font-bold text-sm hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-all flex items-center justify-center gap-2"
                >
                  <FileDown size={18} />
                  Export PDF
                </button>
                <button
                  onClick={() => setShowClearConfirm(true)}
                  className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 font-bold text-sm hover:bg-red-100 dark:hover:bg-red-900/40 transition-all flex items-center justify-center gap-2"
                >
                  <Trash size={18} />
                  Clear All
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input 
                  type="text"
                  placeholder="Search tasks or owners..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={cn(
                    "w-full pl-10 pr-4 py-2 rounded-xl border focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all",
                    isDarkMode ? "bg-zinc-900/50 border-white/10" : "bg-white border-black/5"
                  )}
                />
              </div>

              <div className="flex items-center gap-3 w-full sm:w-auto">
                <div className="flex items-center gap-2 bg-white dark:bg-zinc-900 border border-black/5 dark:border-white/10 rounded-xl p-1">
                  {(['All', 'Pending', 'Completed'] as const).map((status) => (
                    <button
                      key={status}
                      onClick={() => setFilterStatus(status)}
                      className={cn(
                        "px-3 py-1.5 text-xs font-medium rounded-lg transition-all",
                        filterStatus === status 
                          ? "bg-indigo-600 text-white shadow-sm" 
                          : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
                      )}
                    >
                      {status}
                    </button>
                  ))}
                </div>
                <button 
                  onClick={exportToExcel}
                  className="p-2 rounded-xl border border-black/5 dark:border-white/10 bg-white dark:bg-zinc-900 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors"
                  title="Export to CSV"
                >
                  <Download size={20} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <AnimatePresence mode="popLayout">
                {filteredTasks.length > 0 ? (
                  filteredTasks.map((task) => {
                    const dlStatus = getDeadlineStatus(task.deadline);
                    return (
                      <motion.div
                        key={task.id}
                        layout
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className={cn(
                          "p-5 rounded-2xl border group relative transition-all cursor-pointer",
                          isDarkMode ? "bg-zinc-900/50 border-white/10" : "bg-white border-black/5 shadow-sm",
                          task.status === 'Completed' && "opacity-75"
                        )}
                        onClick={() => setSelectedTask(task)}
                      >
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex gap-2">
                            <div className={cn(
                              "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                              task.status === 'Completed' 
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" 
                                : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                            )}>
                              {task.status}
                            </div>
                            <div className={cn(
                              "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                              priorityColors[task.priority]
                            )}>
                              {task.priority}
                            </div>
                          </div>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteTask(task.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-red-500 transition-all"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>

                        <h3 className={cn(
                          "font-semibold text-lg mb-4 line-clamp-2",
                          task.status === 'Completed' && "line-through text-slate-500"
                        )}>
                          {task.title}
                        </h3>

                        <div className="space-y-2 mb-6">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                              <User size={14} className="text-indigo-500" />
                              <div className="flex flex-col">
                                <span className="font-medium text-slate-700 dark:text-slate-300">
                                  {task.assigned_to === 'Unknown' ? (
                                    <span className="text-red-400 italic">Unassigned</span>
                                  ) : task.assigned_to}
                                </span>
                                {task.email && (
                                  <span className="text-[10px] text-slate-400 truncate max-w-[120px]">
                                    {task.email}
                                  </span>
                                )}
                              </div>
                            </div>
                            {task.assigned_to !== 'Unknown' && (
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSendReminder(task);
                                }}
                                className="text-[10px] font-bold text-indigo-500 hover:underline uppercase"
                              >
                                Send Reminder
                              </button>
                            )}
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                              <Calendar size={14} className="text-indigo-500" />
                              <span className={cn(
                                task.deadline === 'Unknown' && "text-red-400 italic"
                              )}>
                                {task.deadline === 'Unknown' ? 'No Deadline' : task.deadline}
                              </span>
                            </div>
                            {dlStatus && task.status === 'Pending' && (
                              <div className={cn(
                                "px-2 py-0.5 rounded-md text-[9px] font-bold uppercase",
                                deadlineStatusColors[dlStatus]
                              )}>
                                {dlStatus}
                              </div>
                            )}
                          </div>
                        </div>

                        {task.notes && task.notes !== 'Unknown' && (
                          <div className="mb-6 p-3 rounded-xl bg-slate-50 dark:bg-zinc-800/50 text-xs text-slate-500 dark:text-slate-400 italic">
                            "{task.notes}"
                          </div>
                        )}

                        <button
                          onClick={() => toggleTaskStatus(task.id)}
                          className={cn(
                            "w-full py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2",
                            task.status === 'Completed'
                              ? "bg-slate-100 dark:bg-zinc-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-zinc-700"
                              : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-500/20"
                          )}
                        >
                          {task.status === 'Completed' ? (
                            <>Reopen Task</>
                          ) : (
                            <>
                              <CheckCircle2 size={18} />
                              Mark as Complete
                            </>
                          )}
                        </button>
                      </motion.div>
                    );
                  })
                ) : (
                  <div className="col-span-full py-20 flex flex-col items-center justify-center text-slate-400">
                    <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-zinc-900 flex items-center justify-center mb-4">
                      <Search size={32} strokeWidth={1} />
                    </div>
                    <p className="text-lg font-medium">No tasks found</p>
                    <p className="text-sm">Try adjusting your search or upload a meeting recording.</p>
                  </div>
                )}
              </AnimatePresence>
            </div>
          </div>
          </div>
        </>
      )}
    </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto p-6 mt-12 border-t border-black/5 dark:border-white/10 text-center text-slate-500 text-sm">
        <p>© 2026 MeetingAI Assistant. Built with Gemini 3 Flash.</p>
      </footer>

      {/* Email Modal */}
      <AnimatePresence>
        {emailModal.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEmailModal(prev => ({ ...prev, isOpen: false }))}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className={cn(
                "relative w-full max-w-md p-6 rounded-3xl border shadow-2xl",
                isDarkMode ? "bg-zinc-900 border-white/10" : "bg-white border-black/5"
              )}
            >
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                    <Mail size={20} />
                  </div>
                  <h2 className="text-xl font-bold">Send Reminder</h2>
                </div>
                <button 
                  onClick={() => setEmailModal(prev => ({ ...prev, isOpen: false }))}
                  className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                    Recipient Name
                  </label>
                  <div className="px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800 border border-black/5 dark:border-white/10 font-medium">
                    {emailModal.task?.assigned_to}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={emailModal.email}
                    onChange={(e) => setEmailModal(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="Enter email address..."
                    className={cn(
                      "w-full px-4 py-2.5 rounded-xl border focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all",
                      isDarkMode ? "bg-zinc-800 border-white/10" : "bg-white border-black/5"
                    )}
                    autoFocus
                  />
                </div>

                <div className="p-4 rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-500/20">
                  <p className="text-xs text-indigo-600 dark:text-indigo-400 leading-relaxed">
                    <span className="font-bold">Message Preview:</span><br/>
                    Hi {emailModal.task?.assigned_to}, this is a reminder for your task: "{emailModal.task?.title}".
                  </p>
                </div>

                <button
                  onClick={confirmSendEmail}
                  disabled={!emailModal.email || !emailModal.email.includes('@')}
                  className="w-full py-3.5 rounded-2xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/20 transition-all flex items-center justify-center gap-2"
                >
                  <Mail size={18} />
                  Send Email Now
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Task Detail Modal */}
      <AnimatePresence>
        {selectedTask && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedTask(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className={cn(
                "relative w-full max-w-lg p-8 rounded-3xl border shadow-2xl",
                isDarkMode ? "bg-zinc-900 border-white/10" : "bg-white border-black/5"
              )}
            >
              <div className="flex justify-between items-center mb-8">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                    <Info size={24} />
                  </div>
                  <h2 className="text-2xl font-bold">Task Details</h2>
                </div>
                <button 
                  onClick={() => setSelectedTask(null)}
                  className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-bold mb-2">{selectedTask.title}</h3>
                  <div className="flex gap-2">
                    <span className={cn(
                      "px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider",
                      selectedTask.status === 'Completed' ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                    )}>
                      {selectedTask.status}
                    </span>
                    <span className={cn(
                      "px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border",
                      priorityColors[selectedTask.priority]
                    )}>
                      {selectedTask.priority} Priority
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Assigned To</label>
                    <div className="flex items-center gap-2 font-medium">
                      <User size={16} className="text-indigo-500" />
                      {selectedTask.assigned_to}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Deadline</label>
                    <div className="flex items-center gap-2 font-medium">
                      <Calendar size={16} className="text-indigo-500" />
                      {selectedTask.deadline}
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Email Address</label>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={selectedTask.email || ''}
                      onChange={(e) => {
                        const updated = { ...selectedTask, email: e.target.value };
                        setSelectedTask(updated);
                      }}
                      onBlur={() => {
                        // Save email when focus is lost
                        fetch(`/api/tasks/${selectedTask.id}`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(selectedTask),
                        }).then(() => fetchTasks());
                      }}
                      placeholder="Enter email for alerts..."
                      className={cn(
                        "flex-1 px-3 py-2 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all",
                        isDarkMode ? "bg-zinc-800 border-white/10" : "bg-white border-black/5"
                      )}
                    />
                    <button
                      onClick={() => handleSendReminder(selectedTask)}
                      className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-all"
                      title="Send manual reminder"
                    >
                      <Mail size={18} />
                    </button>
                    <button
                      onClick={() => downloadSingleTaskPDF(selectedTask)}
                      className="p-2 rounded-xl bg-slate-50 dark:bg-zinc-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-700 transition-all"
                      title="Download as PDF"
                    >
                      <FileDown size={18} />
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Notes</label>
                  <p className="text-slate-600 dark:text-slate-400 leading-relaxed bg-slate-50 dark:bg-zinc-800 p-4 rounded-2xl border border-black/5 dark:border-white/5">
                    {selectedTask.notes || 'No additional notes.'}
                  </p>
                </div>

                <div className="flex items-center justify-between p-4 rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-500/20">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                      selectedTask.auto_alert_enabled ? "bg-indigo-600 text-white" : "bg-slate-200 dark:bg-zinc-700 text-slate-400"
                    )}>
                      {selectedTask.auto_alert_enabled ? <Bell size={20} /> : <BellOff size={20} />}
                    </div>
                    <div>
                      <p className="font-bold text-sm">Automatic Alerts</p>
                      <p className="text-xs text-slate-500">Send email 1 day before deadline</p>
                    </div>
                  </div>
                  <button
                    onClick={() => toggleAutoAlert(selectedTask)}
                    className={cn(
                      "px-4 py-2 rounded-xl font-bold text-xs transition-all",
                      selectedTask.auto_alert_enabled 
                        ? "bg-indigo-600 text-white hover:bg-indigo-700" 
                        : "bg-slate-200 dark:bg-zinc-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-zinc-600"
                    )}
                  >
                    {selectedTask.auto_alert_enabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => {
                      toggleTaskStatus(selectedTask.id);
                      setSelectedTask(null);
                    }}
                    className="flex-1 py-3.5 rounded-2xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-500/20"
                  >
                    Mark as {selectedTask.status === 'Completed' ? 'Pending' : 'Completed'}
                  </button>
                  <button
                    onClick={() => {
                      deleteTask(selectedTask.id);
                      setSelectedTask(null);
                    }}
                    className="px-6 py-3.5 rounded-2xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 font-bold hover:bg-red-100 dark:hover:bg-red-900/40 transition-all"
                  >
                    <Trash2 size={20} />
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Clear All Confirmation Modal */}
      <AnimatePresence>
        {showClearConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowClearConfirm(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={cn(
                "relative w-full max-w-sm p-6 rounded-3xl border shadow-2xl text-center",
                isDarkMode ? "bg-zinc-900 border-white/10" : "bg-white border-black/5"
              )}
            >
              <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600 dark:text-red-400 mx-auto mb-4">
                <Trash2 size={32} />
              </div>
              <h2 className="text-xl font-bold mb-2">Clear All Tasks?</h2>
              <p className="text-slate-500 text-sm mb-6">
                This will permanently delete all tasks from your dashboard. This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="flex-1 py-3 rounded-xl bg-slate-100 dark:bg-zinc-800 font-bold hover:bg-slate-200 dark:hover:bg-zinc-700 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={clearAllTasks}
                  className="flex-1 py-3 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-500/20"
                >
                  Clear All
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
