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
let dernierNumeroSerie = 9;
let ventesFichesOuvertes = true; // La clôture ne s'applique désormais qu'aux fiches de bingo !

let tournoiActuel = { nom: "Match Événementiel Régional", statut: "Ouvert", coût: 50 };

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
            nombreFiches: 0,
            seriesCartons: "",
            historiquePions: [{ date: "Système", description: "Compte créé", montant: "+0" }],
            online: false,
            socketId: null,
            grille: Array.from({length: 25}, () => Math.floor(Math.random() * 75) + 1)
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

    // 📄 ACHAT DE FICHES BINGO (DÉBIT DIRECT DES PIONS DU JOUEUR - REJETÉ SI CLÔTURÉ)
    socket.on('player-buy-fiches', ({ code, qte }) => {
        if (!players[code]) return;
        if (!ventesFichesOuvertes) {
            return socket.emit('notification', "🔒 Désolé, les ventes de fiches de Bingo sont closes pour ce match ! Vous ne pouvez plus en ajouter.");
        }
        
        const coutTotalPions = qte * 5; // Exemple : 5 pions par fiche
        if (players[code].pions >= coutTotalPions) {
            players[code].pions -= coutTotalPions;
            
            const debut = dernierNumeroSerie + 1;
            const fin = dernierNumeroSerie + qte;
            dernierNumeroSerie = fin;

            players[code].nombreFiches += qte;
            players[code].seriesCartons = `Série n° ${debut} à ${fin}`;

            players[code].historiquePions.unshift({
                date: "Achat Fiches",
                description: `Acquisition ${qte} cartons (${players[code].seriesCartons})`,
                montant: `-${coutTotalPions}`
            });

            socket.emit('update-dashboard', players[code]);
            socket.emit('notification', `🎉 Cartons obtenus avec succès ! (${players[code].seriesCartons})`);
            io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders });
        } else {
            socket.emit('notification', `❌ Solde insuffisant. Il vous faut ${coutTotalPions} pions pour acheter ${qte} fiches.`);
        }
    });

    // 💳 RECHARGE DE PIONS À LA CAISSE (TOUJOURS DISPONIBLE)
    socket.on('player-order', ({ code, type, qte }) => {
        if (!players[code]) return;
        const nbrPions = parseInt(qte);
        const francs = nbrPions * 100;
        
        orders.push({ 
            id: Date.now(), 
            code, 
            nom: players[code].nom, 
            type: `${type} [Attendu : ${francs.toLocaleString()} fr]`, 
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
                    date: "Caisse",
                    description: `Recharge de +${o.qte} pions validée`,
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

    // 🚨 TRANSMISSION DE L'ALERTE BINGO DU JOUEUR VERS L'ADMIN
    socket.on('player-announce-bingo', (data) => {
        io.emit('admin-receive-bingo', data);
    });

    // Gestion des fermetures des ventes de fiches
    socket.on('admin-toggle-ventes', (statut) => { ventesFichesOuvertes = statut; });
    socket.on('admin-send-flash', (msg) => { io.emit('notification', `📢 REGIE ANNONCE :\n\n${msg}`); });

    socket.on('admin-draw', () => {
        if (pool.length === 0) return;
        const idx = Math.floor(Math.random() * pool.length);
        const num = pool.splice(idx, 1)[0];
        drawnNumbers.push(num);
        io.emit('new-ball', { actuelle: num, historique: drawnNumbers });
        io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders });
    });

    socket.on('admin-request-carton', (code) => {
        if (players[code]) {
            socket.emit('admin-view-carton', { nom: players[code].nom, code: code, grille: players[code].grille, history: drawnNumbers });
        }
    });

    socket.on('admin-reset-all', () => {
        players = {}; pool = Array.from({length: 75}, (_, i) => i + 1); drawnNumbers = []; orders = []; playerCount = 0; dernierNumeroSerie = 9; ventesFichesOuvertes = true;
        io.emit('game-reset');
        io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders });
    });

    socket.on('disconnect', () => {
        for (let code in players) {
            if (players[code].socketId === socket.id) { players[code].online = false; players[code].socketId = null; io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders }); break; }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Régie en ligne`); });
