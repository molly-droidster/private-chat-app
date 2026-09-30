const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const appInstance = express();
const server = http.createServer(appInstance);
const io = new Server(server, {
    maxHttpBufferSize: 1e7 // 10MB upload limit for images
});

const DATA_FILE = path.join(__dirname, 'messages.json');
const ADMIN_PASSWORD = "admin1234"; // 🔒 Your secret password to wipe chat logs

// ⌨️ Tracks socket IDs and nicknames currently typing
let activeTypers = {}; 

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

appInstance.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    // 1. Assign a random identity immediately on connection arrival
    const generatedGuestName = `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
    socket.username = generatedGuestName;

    // 2. Load historical scroll logs to client
    socket.emit('chat_history', { messages, defaultName: generatedGuestName });
    
    // Broadcast arrival status row
    io.emit('system_message', `${socket.username} joined the chat`);

    // ⌨️ Listen for incoming typing state updates from frontend
    socket.on('typing', (data) => {
        if (data.isTyping) {
            activeTypers[socket.id] = socket.username;
        } else {
            delete activeTypers[socket.id];
        }
        // Broadcast the active list of typers to everyone else
        io.emit('user_typing', Object.values(activeTypers));
    });

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

    socket.on('change_username', (newName) => {
        const oldName = socket.username;
        if (newName.trim() && newName.trim() !== oldName) {
            socket.username = newName.trim();
            // If they change their name while typing, update it in active trackers
            if (activeTypers[socket.id]) {
                activeTypers[socket.id] = socket.username;
                io.emit('user_typing', Object.values(activeTypers));
            }
            io.emit('system_message', `${oldName} changed their name to ${socket.username}`);
        }
    });

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
        // Clear them out of the typing list if they disconnect mid-sentence
        delete activeTypers[socket.id];
        io.emit('user_typing', Object.values(activeTypers));

        if (socket.username) {
            io.emit('system_message', `${socket.username} left the chat`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Instant Chat Engine running on port ${PORT}`));
