const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({ storage: storage, limits: { fileSize: 50 * 1024 * 1024 } });

app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Хранилище данных
const users = new Map();
const messages = [];
const typingUsers = new Map();

function generateId() {
    return Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

function saveMessage(message) {
    messages.push(message);
    if (messages.length > 200) messages.shift();
}

// Обработка загрузки файлов
app.post('/upload', upload.single('file'), (req, res) => {
    const { username } = req.body;
    const file = req.file;
    
    if (!file) return res.status(400).json({ error: 'Нет файла' });
    
    let fileType = 'document';
    let preview = null;
    
    if (file.mimetype.startsWith('image/')) {
        fileType = 'image';
        preview = `/uploads/${file.filename}`;
    } else if (file.mimetype.startsWith('audio/')) {
        fileType = 'audio';
    } else if (file.mimetype === 'application/pdf') {
        fileType = 'pdf';
    }
    
    const msgData = {
        id: generateId(),
        username: username,
        avatar: users.get(username)?.avatar || '😀',
        timestamp: new Date().toLocaleTimeString(),
        type: fileType,
        file_info: {
            filename: file.originalname,
            saved_name: file.filename,
            size: file.size,
            url: `/uploads/${file.filename}`,
            mimeType: file.mimetype
        }
    };
    
    if (fileType === 'image') {
        msgData.message = preview;
    } else if (fileType === 'audio') {
        msgData.message = `🎵 Аудиофайл`;
    } else {
        msgData.message = `📄 ${file.originalname}`;
    }
    
    saveMessage(msgData);
    io.emit('new_message', msgData);
    
    res.json({ success: true, message: msgData });
});

// Обработка голосовых сообщений (сохранение как файл)
const voiceStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const voiceDir = path.join(__dirname, 'uploads', 'voice');
        if (!fs.existsSync(voiceDir)) fs.mkdirSync(voiceDir, { recursive: true });
        cb(null, voiceDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + '.webm';
        cb(null, uniqueName);
    }
});

const voiceUpload = multer({ storage: voiceStorage, limits: { fileSize: 10 * 1024 * 1024 } });

app.post('/upload-voice', voiceUpload.single('audio'), (req, res) => {
    const { username, duration } = req.body;
    const file = req.file;
    
    if (!file) return res.status(400).json({ error: 'Нет аудио' });
    
    const msgData = {
        id: generateId(),
        username: username,
        avatar: users.get(username)?.avatar || '😀',
        timestamp: new Date().toLocaleTimeString(),
        type: 'voice',
        message: '🎤 Голосовое сообщение',
        voice_info: {
            url: `/uploads/voice/${file.filename}`,
            duration: duration || 0
        }
    };
    
    saveMessage(msgData);
    io.emit('new_message', msgData);
    
    res.json({ success: true, message: msgData });
});

io.on('connection', (socket) => {
    console.log('Новый пользователь подключился:', socket.id);

    socket.on('join', (data) => {
        const { username, avatar } = data;
        
        if (users.has(username) && users.get(username).socketId !== socket.id) {
            socket.emit('join_error', { message: 'Пользователь с таким именем уже существует!' });
            return;
        }
        
        users.set(username, { socketId: socket.id, avatar: avatar || '😀' });
        socket.username = username;
        
        const userList = Array.from(users.keys());
        const usersData = Array.from(users.entries()).map(([name, data]) => ({ username: name, avatar: data.avatar }));
        
        socket.emit('joined', {
            messages: messages,
            users: userList,
            usersData: usersData
        });
        
        socket.broadcast.emit('user_joined', {
            username: username,
            avatar: avatar,
            users: userList
        });
    });
    
    socket.on('send_message', (data) => {
        const msgData = {
            id: generateId(),
            username: socket.username,
            avatar: users.get(socket.username)?.avatar || '😀',
            message: data.message,
            timestamp: new Date().toLocaleTimeString(),
            type: 'text'
        };
        
        saveMessage(msgData);
        io.emit('new_message', msgData);
    });
    
    socket.on('update_avatar', (data) => {
        if (users.has(data.username)) {
            users.get(data.username).avatar = data.avatar;
            io.emit('user_avatar_update', { username: data.username, avatar: data.avatar });
        }
    });
    
    socket.on('typing_start', (data) => {
        const { username } = data;
        socket.broadcast.emit('typing_update', { user: username });
    });
    
    socket.on('typing_stop', (data) => {
        socket.broadcast.emit('typing_update', { user: null });
    });
    
    socket.on('disconnect', () => {
        let disconnectedUser = null;
        for (let [username, data] of users.entries()) {
            if (data.socketId === socket.id) {
                disconnectedUser = username;
                users.delete(username);
                break;
            }
        }
        
        if (disconnectedUser) {
            const userList = Array.from(users.keys());
            io.emit('user_left', { username: disconnectedUser, users: userList });
        }
        
        console.log('Пользователь отключился:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер запущен на http://localhost:${PORT}`);
    console.log(`📱 Откройте в браузере: http://localhost:${PORT}`);
});