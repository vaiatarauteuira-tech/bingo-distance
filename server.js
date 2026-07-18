const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
let pool = Array.from({length: 75}, (_, i) => i + 1);
let drawnNumbers = [];
let orders = [];
let playerCount = 0;

let tournoiActuel = { nom: "Grand Match de l'Événement", statut: "Ouvert", coût: 50 };

io.on('connection', (socket) => {
    
    socket.on('admin-init', () => {
        socket.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders });
    });

    socket.on('admin-add-player', (nomJoueur) => {
        playerCount++;
        let nomNettoye = nomJoueur.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
        if (!nomNettoye) { nomNettoye = "JOUEUR"; }
        const chiffresFormates = String(playerCount).padStart(3, '0');
        const code = `${nomNettoye}${chiffresFormates}`;
        
        players[code] = {
            nom: nomJoueur.trim() || `Joueur ${playerCount}`,
            code: code,
            pions: 0,
            historiquePions: [{ date: "Ouverture", description: "Création du compte", montant: "+0" }],
            tournoisInscrits: [],
            online: false,
            socketId: null
        };
        io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders });
    });

    socket.on('player-login', (code) => {
        const codeVerif = code.trim().toUpperCase();
        if (players[codeVerif]) {
            players[codeVerif].online = true;
            players[codeVerif].socketId = socket.id;
            socket.emit('login-success-dashboard', {
                player: players[codeVerif],
                tournoiActuel: tournoiActuel,
                liveHistory: drawnNumbers
            });
            io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders });
        } else {
            socket.emit('login-error');
        }
    });

    socket.on('player-order', ({ code, type, qte }) => {
        if (!players[code]) return;
        const nbrPions = parseInt(qte);
        const francs = nbrPions * 100;
        
        orders.push({ 
            id: Date.now(), 
            code, 
            nom: players[code].nom, 
            type: `Virement de ${francs.toLocaleString()} fr`, 
            qte: nbrPions 
        });
        io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders });
    });

    socket.on('admin-validate-order', (idOrder) => {
        const idx = orders.findIndex(o => o.id === idOrder);
        if (idx !== -1) {
            const o = orders[idx];
            if (players[o.code]) {
                players[o.code].pions += o.qte;
                players[o.code].historiquePions.unshift({
                    date: "Caisse ok",
                    description: `Recharge validée (${o.qte} Pions)`,
                    montant: `+${o.qte}`
                });
                if (players[o.code].socketId) {
                    io.to(players[o.code].socketId).emit('update-dashboard', players[o.code]);
                }
            }
            orders.splice(idx, 1);
            io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders });
        }
    });

    socket.on('admin-draw', () => {
        if (pool.length === 0) return;
        const idx = Math.floor(Math.random() * pool.length);
        const num = pool.splice(idx, 1)[0];
        drawnNumbers.push(num);
        io.emit('new-ball', { actuelle: num, historique: drawnNumbers });
    });

    socket.on('admin-reset-all', () => {
        players = {}; pool = Array.from({length: 75}, (_, i) => i + 1); drawnNumbers = []; orders = []; playerCount = 0;
        io.emit('game-reset');
        io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders });
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
server.listen(PORT, () => { console.log(`Serveur en ligne`); });
