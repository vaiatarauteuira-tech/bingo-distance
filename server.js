const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
let pool = Array.from({length: 75}, (_, i) => i + 1);
let drawnNumbers = [];
let orders = [];

io.on('connection', (socket) => {
    
    socket.on('admin-init', () => {
        socket.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders });
    });

    socket.on('admin-generate-players', () => {
        players = {}; pool = Array.from({length: 75}, (_, i) => i + 1); drawnNumbers = []; orders = [];
        for (let i = 1; i <= 50; i++) {
            const code = `BINGO-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
            players[code] = {
                nom: `Joueur ${i}`, code: code, p20: 0, p50: 0, p100: 0,
                grille: Array.from({length: 25}, () => Math.floor(Math.random() * 75) + 1),
                online: false, socketId: null
            };
        }
        io.emit('game-reset');
        io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders });
    });

    socket.on('admin-draw', () => {
        if (pool.length === 0) return;
        const idx = Math.floor(Math.random() * pool.length);
        const num = pool.splice(idx, 1)[0];
        drawnNumbers.push(num);
        io.emit('new-ball', { actuelle: num, historique: drawnNumbers });
    });

    socket.on('player-login', (code) => {
        if (players[code]) {
            players[code].online = true;
            players[code].socketId = socket.id;
            socket.emit('login-success', players[code]);
            io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders });
        } else {
            socket.emit('login-error');
        }
    });

    socket.on('player-order', ({ code, type, qte }) => {
        if (!players[code]) return;
        const newOrder = { id: Date.now(), code, nom: players[code].nom, type, qte };
        orders.push(newOrder);
        io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders });
    });

    socket.on('admin-validate-order', (idOrder) => {
        const idx = orders.findIndex(o => o.id === idOrder);
        if (idx !== -1) {
            const o = orders[idx];
            if (players[o.code]) {
                players[o.code][o.type] += parseInt(o.qte);
                if (players[o.code].socketId) {
                    io.to(players[o.code].socketId).emit('update-pions', players[o.code]);
                }
            }
            orders.splice(idx, 1);
            io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders });
        }
    });

    socket.on('disconnect', () => {
        for (let code in players) {
            if (players[code].socketId === socket.id) {
                players[code].online = false;
                players[code].socketId = null;
                io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders });
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Bingo en ligne sur le port ${PORT}`);
});
