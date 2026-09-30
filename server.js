const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e7 // 10MB upload limit for images
});

const DATA_FILE = path.join(__dirname, 'messages.json');
const ADMIN_PASSWORD = "admin1234"; // 🔒 Your secret password to wipe chat history

// Load existing chat history on startup or start fresh
let messages = [];
if (fs.existsSync(DATA_FILE)) {
    try {
        messages = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
        messages = [];
    }
}

function saveMessages() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(messages, null, 2));
}

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    // 1. Immediately send past message logs to the arriving user
    socket.emit('chat_history', messages);
    socket.username = "Anonymous";

    // 2. Set user's temporary name when they complete the initial popup prompt
    socket.on('set_initial_name', (username) => {
        socket.username = username.trim() || `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
        io.emit('system_message', `${socket.username} joined the chat`);
    });

    // 3. Handle standard text messages
    socket.on('chat_message', (data) => {
        if (!data.text || !data.text.trim()) return;
        const msgData = {
            id: '_' + Math.random().toString(36).substr(2, 9),
            type: 'text',
            username: socket.username,
            text: data.text,
            replyTo: data.replyTo || null,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        messages.push(msgData);
        saveMessages();
        io.emit('chat_message', msgData);
    });

    // 4. Handle incoming image files
    socket.on('chat_image', (data) => {
        const msgData = {
            id: '_' + Math.random().toString(36).substr(2, 9),
            type: 'image',
            username: socket.username,
            image: data.base64Data,
            replyTo: data.replyTo || null,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        messages.push(msgData);
        saveMessages();
        io.emit('chat_message', msgData);
    });

    // 5. Handle changing nickname from the top header bar later on
    socket.on('change_username', (newName) => {
        const oldName = socket.username;
        if (newName.trim() && newName.trim() !== oldName) {
            socket.username = newName.trim();
            io.emit('system_message', `${oldName} changed their name to ${socket.username}`);
        }
    });

    // 6. Handle the admin wipe function
    socket.on('wipe_history', (password) => {
        if (password === ADMIN_PASSWORD) {
            messages = [];
            saveMessages();
            io.emit('history_wiped');
            io.emit('system_message', `🚨 The entire chat history was cleared by an admin.`);
        } else {
            socket.emit('wipe_failed', 'Incorrect admin password!');
        }
    });

    socket.on('disconnect', () => {
        if (socket.username !== "Anonymous") {
            io.emit('system_message', `${socket.username} left the chat`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Instant Chat Engine running on port ${PORT}`));
