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
let dernierNumeroSerie = 9; // Démarre avant la série 10
let boutiqueOuverte = true;

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
            historiquePions: [{ date: "Système", description: "Compte ouvert en caisse", montant: "+0" }],
            tournoisInscrits: [],
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

    socket.on('player-order', ({ code, type, qte }) => {
        if (!players[code]) return;
        if (!boutiqueOuverte) {
            return socket.emit('notification', "🔒 Les ventes sont fermées pour ce match. Impossible de commander !");
        }
        const nbrPions = parseInt(qte);
        const francs = nbrPions * 100;
        
        orders.push({ 
            id: Date.now(), 
            code, 
            nom: players[code].nom, 
            type: `${type} [Total: ${francs.toLocaleString()} fr]`, 
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
                
                // Attribution automatique de sa série exclusive (ex: de 10 à 13)
                const fichesAchetees = Math.floor(o.qte / 5) || 1; 
                const debutSerie = dernierNumeroSerie + 1;
                const finSerie = dernierNumeroSerie + fichesAchetees;
                dernierNumeroSerie = finSerie; // On décale le compteur global pour le joueur suivant
                
                players[o.code].nombreFiches += fichesAchetees;
                players[o.code].seriesCartons = `Série n° ${debutSerie} à ${finSerie}`;
                
                players[o.code].historiquePions.unshift({
                    date: "Validé",
                    description: `Livraison : ${players[o.code].seriesCartons}`,
                    montant: `+${o.qte}`
                });
                
                if (players[o.code].socketId) {
                    io.to(players[o.code].socketId).emit('update-dashboard', players[o.code]);
                    io.to(players[o.code].socketId).emit('notification', `💰 Vos cartons ont été livrés ! (${players[o.code].seriesCartons})`);
                }
            }
            orders.splice(idx, 1);
            io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders });
        }
    });

    // Bouton de clôture des ventes
    socket.on('admin-toggle-ventes', (statut) => {
        boutiqueOuverte = statut;
    });

    // Message flash instantané
    socket.on('admin-send-flash', (msg) => {
        io.emit('notification', `📢 MESSAGE DE LA DIRECTION :\n\n${msg}`);
    });

    // Déclenchement d'un tirage
    socket.on('admin-draw', () => {
        if (pool.length === 0) return;
        const idx = Math.floor(Math.random() * pool.length);
        const num = pool.splice(idx, 1)[0];
        drawnNumbers.push(num);
        io.emit('new-ball', { actuelle: num, historique: drawnNumbers });
        io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders });
    });

    // Demande d'inspection de carton de la part de l'admin
    socket.on('admin-request-carton', (code) => {
        if (players[code]) {
            socket.emit('admin-view-carton', {
                nom: players[code].nom,
                code: code,
                grille: players[code].grille,
                history: drawnNumbers
            });
        }
    });

    // Envoi manuel de pions de gain
    socket.on('admin-direct-reward', ({ code, montant }) => {
        if (players[code]) {
            players[code].pions += parseInt(montant);
            players[code].historiquePions.unshift({
                date: "Gain Match",
                description: "Fiche vérifiée conforme et gagnante",
                montant: `+${montant}`
            });
            if (players[code].socketId) {
                io.to(players[o.code].socketId).emit('update-dashboard', players[code]);
            }
            io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders });
        }
    });

    socket.on('admin-reset-all', () => {
        players = {}; pool = Array.from({length: 75}, (_, i) => i + 1); drawnNumbers = []; orders = []; playerCount = 0; dernierNumeroSerie = 9; boutiqueOuverte = true;
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
server.listen(PORT, () => { console.log(`Régie prête`); });
