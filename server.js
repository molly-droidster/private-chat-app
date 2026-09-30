const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');


const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e7 // 10MB limit for images
});


const DATA_DIR = path.join(__dirname, 'rooms_data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}


const ROOMS_REGISTRY_FILE = path.join(DATA_DIR, 'rooms_registry.json');
const ADMIN_PASSWORD = "admin1234";


let roomsRegistry = {};
if (fs.existsSync(ROOMS_REGISTRY_FILE)) {
    try {
        roomsRegistry = JSON.parse(fs.readFileSync(ROOMS_REGISTRY_FILE, 'utf8'));
    } catch (e) {
        roomsRegistry = {};
    }
}


function saveRegistry() {
    fs.writeFileSync(ROOMS_REGISTRY_FILE, JSON.stringify(roomsRegistry, null, 2));
}


function getRoomFile(roomId) {
    const safeRoomId = roomId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    return path.join(DATA_DIR, `room_${safeRoomId}.json`);
}


function loadRoomMessages(roomId) {
    const file = getRoomFile(roomId);
    if (fs.existsSync(file)) {
        try {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (e) {
            return [];
        }
    }
    return [];
}


function saveRoomMessages(roomId, messages) {
    const file = getRoomFile(roomId);
    fs.writeFileSync(file, JSON.stringify(messages, null, 2));
}


app.use(express.static(path.join(__dirname, 'public')));


io.on('connection', (socket) => {
    socket.username = "Anonymous";
    socket.currentRoom = null;


    socket.on('create_room', (data) => {
        const customName = data.roomName.trim() || "Private Room";
        const username = data.username.trim() || `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
        
        let roomId;
        do {
            roomId = Math.random().toString(36).substr(2, 6).toUpperCase();
        } while (roomsRegistry[roomId]);


        roomsRegistry[roomId] = customName;
        saveRegistry();


        socket.emit('room_created', { roomId, roomName: customName, username });
    });


    socket.on('join_room', (data) => {
        const roomId = data.roomId.trim().toUpperCase();
        const username = data.username.trim() || `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
        
        if (!roomId) return socket.emit('join_error', 'Please enter a room code.');
        if (!roomsRegistry[roomId]) return socket.emit('join_error', 'Room code not found.');


        const roomName = roomsRegistry[roomId];
        socket.username = username;
        socket.currentRoom = roomId;
        
        socket.join(roomId);
        
        const roomHistory = loadRoomMessages(roomId);
        socket.emit('chat_history', { messages: roomHistory, roomId, roomName, username });


        socket.to(roomId).emit('system_message', `${socket.username} joined the chat`);
    });


    socket.on('chat_message', (data) => {
        if (!socket.currentRoom || !data.text || !data.text.trim()) return;
        
        const roomHistory = loadRoomMessages(socket.currentRoom);
        const msgData = {
            id: '_' + Math.random().toString(36).substr(2, 9),
            type: 'text',
            username: socket.username,
            text: data.text,
            replyTo: data.replyTo || null,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        
        roomHistory.push(msgData);
        saveRoomMessages(socket.currentRoom, roomHistory);
        io.to(socket.currentRoom).emit('chat_message', msgData);
    });


    socket.on('chat_image', (data) => {
        if (!socket.currentRoom) return;


        const roomHistory = loadRoomMessages(socket.currentRoom);
        const msgData = {
            id: '_' + Math.random().toString(36).substr(2, 9),
            type: 'image',
            username: socket.username,
            image: data.base64Data,
            replyTo: data.replyTo || null,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        
        roomHistory.push(msgData);
        saveRoomMessages(socket.currentRoom, roomHistory);
        io.to(socket.currentRoom).emit('chat_message', msgData);
    });


    socket.on('change_username', (newName) => {
        const oldName = socket.username;
        if (newName.trim() && newName.trim() !== oldName && socket.currentRoom) {
            socket.username = newName.trim();
            io.to(socket.currentRoom).emit('system_message', `${oldName} changed their name to ${socket.username}`);
        }
    });


    socket.on('wipe_history', (password) => {
        if (password === ADMIN_PASSWORD && socket.currentRoom) {
            saveRoomMessages(socket.currentRoom, []);
            io.to(socket.currentRoom).emit('history_wiped');
            io.to(socket.currentRoom).emit('system_message', `🚨 The chat history for this room was cleared by an admin.`);
        } else {
            socket.emit('wipe_failed', 'Incorrect admin password!');
        }
    });


    socket.on('disconnect', () => {
        if (socket.currentRoom && socket.username !== "Anonymous") {
            io.to(socket.currentRoom).emit('system_message', `${socket.username} left the chat`);
        }
    });
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Coded & Named DM App running on http://localhost:${PORT}`));