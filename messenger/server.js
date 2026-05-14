const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

// ========== ИНИЦИАЛИЗАЦИЯ SQLITE ==========
const db = new sqlite3.Database('./messenger.db');

db.serialize(() => {
  // Таблица пользователей
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    avatar TEXT DEFAULT '😀',
    isOnline INTEGER DEFAULT 0,
    lastSeen INTEGER DEFAULT 0
  )`);

  // Сообщения общего чата
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    avatar TEXT,
    message TEXT,
    timestamp TEXT,
    type TEXT DEFAULT 'text',
    file_info TEXT,
    voice_info TEXT,
    createdAt INTEGER DEFAULT (strftime('%s', 'now'))
  )`);

  // Приватные сообщения
  db.run(`CREATE TABLE IF NOT EXISTS private_messages (
    id TEXT PRIMARY KEY,
    from_user TEXT NOT NULL,
    to_user TEXT NOT NULL,
    message TEXT,
    avatar TEXT,
    timestamp TEXT,
    type TEXT DEFAULT 'text',
    isRead INTEGER DEFAULT 0,
    createdAt INTEGER DEFAULT (strftime('%s', 'now'))
  )`);
});

// ========== НАСТРОЙКИ MULTER ==========
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const voiceDir = path.join(uploadDir, 'voice');
if (!fs.existsSync(voiceDir)) fs.mkdirSync(voiceDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

const voiceStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, voiceDir),
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + Math.random() + '.webm');
  }
});
const voiceUpload = multer({ storage: voiceStorage, limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.static(__dirname));
app.use('/uploads', express.static(uploadDir));
app.use(express.json());

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
function parseMessageRow(row) {
  if (!row) return row;
  return {
    ...row,
    file_info: row.file_info ? JSON.parse(row.file_info) : null,
    voice_info: row.voice_info ? JSON.parse(row.voice_info) : null
  };
}

// ========== API ==========
app.post('/api/register', async (req, res) => {
  const { username, password, avatar } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Заполните все поля' });
  if (username.length < 3) return res.status(400).json({ error: 'Имя не менее 3 символов' });
  if (password.length < 4) return res.status(400).json({ error: 'Пароль не менее 4 символов' });

  db.get('SELECT id FROM users WHERE username = ?', [username], async (err, row) => {
    if (row) return res.status(400).json({ error: 'Пользователь уже существует' });
    const hashed = await bcrypt.hash(password, 10);
    db.run('INSERT INTO users (username, password, avatar) VALUES (?, ?, ?)',
      [username, hashed, avatar || '😀'],
      (err) => {
        if (err) return res.status(500).json({ error: 'Ошибка БД' });
        res.json({ success: true });
      });
  });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (!user) return res.status(401).json({ error: 'Неверные данные' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Неверные данные' });
    res.json({ success: true, user: { username: user.username, avatar: user.avatar } });
  });
});

app.get('/api/messages', (req, res) => {
  db.all('SELECT * FROM messages ORDER BY createdAt ASC LIMIT 200', (err, rows) => {
    res.json(rows.map(parseMessageRow));
  });
});

app.get('/api/private-messages/:user1/:user2', (req, res) => {
  const { user1, user2 } = req.params;
  db.all(
    `SELECT * FROM private_messages 
     WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)
     ORDER BY createdAt ASC LIMIT 200`,
    [user1, user2, user2, user1],
    (err, rows) => res.json(rows || [])
  );
});

app.post('/api/mark-read', (req, res) => {
  const { username, fromUser } = req.body;
  db.run('UPDATE private_messages SET isRead = 1 WHERE to_user = ? AND from_user = ? AND isRead = 0',
    [username, fromUser], () => res.json({ success: true }));
});

// Загрузка файлов
app.post('/upload', upload.single('file'), (req, res) => {
  const { username } = req.body;
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Нет файла' });

  const isImage = file.mimetype.startsWith('image/');
  const fileType = isImage ? 'image' : 'document';
  const fileInfo = {
    filename: file.originalname,
    url: `/uploads/${file.filename}`,
    size: file.size,
    mimeType: file.mimetype
  };

  const msgData = {
    id: Date.now() + '-' + Math.random(),
    username,
    avatar: '😀',
    timestamp: new Date().toLocaleTimeString(),
    type: fileType,
    message: isImage ? fileInfo.url : `📄 ${file.originalname}`,
    file_info: fileInfo
  };

  db.run(`INSERT INTO messages (id, username, avatar, message, timestamp, type, file_info)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [msgData.id, msgData.username, msgData.avatar, msgData.message, msgData.timestamp, msgData.type, JSON.stringify(fileInfo)],
    (err) => {
      if (err) return res.status(500).json({ error: 'Ошибка БД' });
      io.emit('new_message', msgData);
      res.json({ success: true, message: msgData });
    });
});

// Голосовые сообщения
app.post('/upload-voice', voiceUpload.single('audio'), (req, res) => {
  const { username, duration } = req.body;
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Нет аудио' });

  const voiceInfo = {
    url: `/uploads/voice/${file.filename}`,
    duration: duration || 0
  };
  const msgData = {
    id: Date.now() + '-' + Math.random(),
    username,
    avatar: '😀',
    timestamp: new Date().toLocaleTimeString(),
    type: 'voice',
    message: '🎤 Голосовое сообщение',
    voice_info: voiceInfo
  };

  db.run(`INSERT INTO messages (id, username, avatar, message, timestamp, type, voice_info)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [msgData.id, msgData.username, msgData.avatar, msgData.message, msgData.timestamp, msgData.type, JSON.stringify(voiceInfo)],
    (err) => {
      if (err) return res.status(500).json({ error: 'Ошибка БД' });
      io.emit('new_message', msgData);
      res.json({ success: true, message: msgData });
    });
});

// ========== WEBSOCKET ==========
let onlineUsers = new Map();   // username -> socketId
let typingUsers = new Set();

io.on('connection', (socket) => {
  socket.on('login', async (data) => {
    const { username, password } = data;
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
      if (!user || !(await bcrypt.compare(password, user.password))) {
        return socket.emit('login_error', { error: 'Неверные данные' });
      }
      if (onlineUsers.has(username)) {
        return socket.emit('login_error', { error: 'Уже в сети' });
      }
      onlineUsers.set(username, socket.id);
      socket.username = username;
      socket.avatar = user.avatar;
      db.run('UPDATE users SET isOnline = 1, lastSeen = ? WHERE username = ?', [Date.now(), username]);

      // Загружаем историю сообщений
      db.all('SELECT * FROM messages ORDER BY createdAt ASC LIMIT 200', (err, rows) => {
        const messages = rows.map(parseMessageRow);
        db.all('SELECT username, avatar, isOnline FROM users', (err, users) => {
          const userList = users.map(u => ({
            username: u.username,
            avatar: u.avatar,
            isOnline: onlineUsers.has(u.username)
          }));
          socket.emit('login_success', {
            user: { username, avatar: user.avatar },
            messages,
            users: userList
          });
          socket.broadcast.emit('user_online', { username, avatar: user.avatar });
          io.emit('users_update', userList);
        });
      });
    });
  });

  socket.on('send_message', (data) => {
    const msgData = {
      id: Date.now() + '-' + Math.random(),
      username: socket.username,
      avatar: socket.avatar,
      message: data.message,
      timestamp: new Date().toLocaleTimeString(),
      type: 'text'
    };
    db.run(`INSERT INTO messages (id, username, avatar, message, timestamp, type) VALUES (?,?,?,?,?,?)`,
      [msgData.id, msgData.username, msgData.avatar, msgData.message, msgData.timestamp, msgData.type],
      () => io.emit('new_message', msgData));
  });

  socket.on('send_private_message', (data) => {
    const msgData = {
      id: Date.now() + '-' + Math.random(),
      from_user: socket.username,
      to_user: data.to,
      message: data.message,
      avatar: socket.avatar,
      timestamp: new Date().toLocaleTimeString(),
      type: 'text',
      isRead: 0
    };
    db.run(`INSERT INTO private_messages (id, from_user, to_user, message, avatar, timestamp, type, isRead) VALUES (?,?,?,?,?,?,?,?)`,
      [msgData.id, msgData.from_user, msgData.to_user, msgData.message, msgData.avatar, msgData.timestamp, msgData.type, msgData.isRead],
      () => {
        socket.emit('private_message_sent', msgData);
        const toSocket = onlineUsers.get(data.to);
        if (toSocket) io.to(toSocket).emit('private_message_received', msgData);
      });
  });

  socket.on('update_avatar', (data) => {
    db.run('UPDATE users SET avatar = ? WHERE username = ?', [data.avatar, socket.username]);
    socket.avatar = data.avatar;
    io.emit('user_avatar_update', { username: socket.username, avatar: data.avatar });
  });

  socket.on('typing_start', () => {
    typingUsers.add(socket.username);
    socket.broadcast.emit('typing_update', { users: Array.from(typingUsers) });
  });
  socket.on('typing_stop', () => {
    typingUsers.delete(socket.username);
    socket.broadcast.emit('typing_update', { users: Array.from(typingUsers) });
  });

  socket.on('disconnect', () => {
    if (socket.username) {
      onlineUsers.delete(socket.username);
      typingUsers.delete(socket.username);
      db.run('UPDATE users SET isOnline = 0, lastSeen = ? WHERE username = ?', [Date.now(), socket.username]);
      db.all('SELECT username, avatar, isOnline FROM users', (err, users) => {
        const userList = users.map(u => ({
          username: u.username,
          avatar: u.avatar,
          isOnline: onlineUsers.has(u.username)
        }));
        io.emit('users_update', userList);
        io.emit('user_offline', { username: socket.username });
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Сервер запущен: http://localhost:${PORT}`));