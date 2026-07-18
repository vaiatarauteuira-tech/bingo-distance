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

// Grille des futurs tournois configurée avec les 3 barèmes demandés
let tournoisInfos = [
    { date: "Partie 1 - 20h00", nom: "Jeu Flash Classique", coutPions: 50 },
    { date: "Partie 2 - 21h00", nom: "Super Tournoi Régulier", coutPions: 100 },
    { date: "Partie 3 - 22h30", nom: "Méga Cagnotte de Clôture", coutPions: 500 }
];

// Le tournoi actif actuellement proposé à l'inscription sur le dashboard (coûte 100 pions par défaut)
let tournoiActuel = { nom: "Jeu Intermédiaire Événementiel", statut: "Inscriptions Ouvertes", coût: 100 };

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
        const nomFinal = nomJoueur.trim() || `Joueur ${playerCount}`;

        players[code] = {
            nom: nomFinal,
            code: code,
            pions: 0, // Commence à 0 pion tant qu'il n'a pas fait de virement
            historiquePions: [
                { date: "Création", description: "Compte ouvert", montant: "+0" }
            ],
            tournoisInscrits: [],
            grille: Array.from({length: 25}, () => Math.floor(Math.random() * 75) + 1),
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
                tournoisInfos: tournoisInfos,
                tournoiActuel: tournoiActuel,
                liveHistory: drawnNumbers
            });
            io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders });
        } else {
            socket.emit('login-error');
        }
    });

    socket.on('player-register-tournoi', (code) => {
        if (players[code]) {
            if (players[code].tournoisInscrits.includes(tournoiActuel.nom)) {
                return socket.emit('notification', "Déjà inscrit à ce jeu !");
            }
            if (players[code].pions >= tournoiActuel.coût) {
                players[code].pions -= tournoiActuel.coût;
                players[code].tournoisInscrits.push(tournoiActuel.nom);
                players[code].historiquePions.unshift({
                    date: "À l'instant",
                    description: `Débit : Ticket ${tournoiActuel.nom}`,
                    montant: `-${tournoiActuel.coût}`
                });
                socket.emit('update-dashboard', players[code]);
                socket.emit('notification', `🎉 Inscription validée ! -${tournoiActuel.coût} Pions.`);
                io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders });
            } else {
                socket.emit('notification', `❌ Pions insuffisants. Ce jeu requiert ${tournoiActuel.coût} pions.`);
            }
        }
    });

    socket.on('player-order', ({ code, type, qte }) => {
        if (!players[code]) return;
        const qtePions = parseInt(qte);
        const montantFrancs = qtePions * 100;
        
        // On affiche clairement à l'admin le nombre de pions ET le virement attendu en francs
        const newOrder = { 
            id: Date.now(), 
            code, 
            nom: players[code].nom, 
            type: `Virement de ${montantFrancs.toLocaleString()} f`, 
            qte: qtePions 
        };
        orders.push(newOrder);
        io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders });
    });

    socket.on('admin-validate-order', (idOrder) => {
        const idx = orders.findIndex(o => o.id === idOrder);
        if (idx !== -1) {
            const o = orders[idx];
            if (players[o.code]) {
                let pionsGagnes = parseInt(o.qte);
                players[o.code].pions += pionsGagnes;
                players[o.code].historiquePions.unshift({
                    date: "Caisse validée",
                    description: `Approvisionnement virement reçu`,
                    montant: `+${pionsGagnes}`
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
server.listen(PORT, () => { console.log(`Serveur actif port ${PORT}`); });
