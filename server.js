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

let venteActive = false; 
let jeuActuel = { titre: "EN ATTENTE DU JEU", prix: 100, orga: "ADMIN / ORGA", desc: "1 boule pour 1 boule" };
let historiqueVentes = []; 

function broadcastRefresh() {
    const playersArray = Object.values(players);
    
    io.emit('refresh-admin', { 
        players: playersArray, 
        history: drawnNumbers, 
        orders: orders, 
        historiqueVentes: historiqueVentes 
    });

    io.emit('refresh-orga', { 
        playersList: playersArray, 
        orders: orders, 
        historiqueVentes: historiqueVentes 
    });
}

io.on('connection', (socket) => {
    
    socket.on('admin-init', () => { broadcastRefresh(); });
    socket.on('orga-init', () => { broadcastRefresh(); });

    // ⚡ CRÉATION DIRECTE D'UN JOUEUR PAR L'ORGANISATEUR
    socket.on('orga-create-player-direct', ({ nom, tel }) => {
        const nomClean = (nom || "").trim();
        const telClean = (tel || "").trim();
        if (!nomClean) return;

        const codeUnique = `BH-${Math.floor(1000 + Math.random() * 9000)}`;

        players[codeUnique] = {
            nom: nomClean,
            tel: telClean,
            code: codeUnique,
            pions: 0,
            nombreFiches: 0,
            seriesCartons: "",
            pdfUrl: null,
            pagesInfo: "",
            online: false,
            socketId: null
        };

        socket.emit('player-created-success', { nom: nomClean, code: codeUnique });
        broadcastRefresh();
    });

    // 🪙 DEMANDE DE PIONS DU JOUEUR
    socket.on('player-request-pions', ({ code, qte }) => {
        const codeClean = (code || "").trim().toUpperCase();
        const quantite = parseInt(qte) || 0;

        if (players[codeClean] && quantite > 0) {
            const nouvelleDemande = {
                id: Date.now(),
                code: codeClean,
                nom: players[codeClean].nom,
                qte: quantite,
                type: "Demande de Pions"
            };

            orders.unshift(nouvelleDemande);
            io.emit('notification-staff', `🪙 ${players[codeClean].nom} (${codeClean}) demande ${quantite} pions !`);
            broadcastRefresh();
        }
    });

    // VALIDATION COMMANDE PIONS
    socket.on('admin-validate-order', (idOrder) => {
        const idx = orders.findIndex(o => o.id === idOrder);
        if (idx !== -1) {
            const o = orders[idx];
            const codeClean = (o.code || "").trim().toUpperCase();
            
            if (players[codeClean]) {
                players[codeClean].pions += parseInt(o.qte);
                if (players[codeClean].socketId) {
                    io.to(players[codeClean].socketId).emit('update-dashboard', players[codeClean]);
                    io.to(players[codeClean].socketId).emit('notification', `✅ ${o.qte} pions ajoutés !`);
                }
            }
            orders.splice(idx, 1);
            broadcastRefresh();
        }
    });

    // 🔐 CONNEXION JOUEUR
    socket.on('player-login', (code) => {
        if (!code) return socket.emit('login-error', '❌ Saisis ton code.');
        const codeVerif = code.trim().toUpperCase();

        if (players[codeVerif]) {
            players[codeVerif].online = true; 
            players[codeVerif].socketId = socket.id;
            socket.emit('login-success-dashboard', { player: players[codeVerif], liveHistory: drawnNumbers });
            socket.emit('sync-vente-status', { active: venteActive, jeu: jeuActuel });
            broadcastRefresh();
        } else { 
            socket.emit('login-error', '❌ Code inconnu ! Demande un code à l\'organisateur.'); 
        }
    });

    socket.on('toggle-vente-game', ({ active, titre, prix, orga, desc }) => {
        venteActive = active;
        if(titre) jeuActuel.titre = titre;
        if(prix) jeuActuel.prix = parseInt(prix);
        if(orga) jeuActuel.orga = orga;
        if(desc) jeuActuel.desc = desc;
        io.emit('sync-vente-status', { active: venteActive, jeu: jeuActuel });
    });

    // LIVRAISON PDF
    socket.on('orga-deliver-pdf', ({ code, serie, fichierUrl, pageDebut, pageFin }) => {
        const codeClean = (code || "").trim().toUpperCase();
        if (players[codeClean]) {
            players[codeClean].pdfUrl = fichierUrl;
            players[codeClean].seriesCartons = serie;
            players[codeClean].pagesInfo = (pageDebut === pageFin) ? `Page ${pageDebut}` : `Pages ${pageDebut} à ${pageFin}`;

            if (players[codeClean].socketId) {
                io.to(players[codeClean].socketId).emit('update-dashboard', players[codeClean]);
                io.to(players[codeClean].socketId).emit('notification', `📄 Ticket (${players[codeClean].pagesInfo}) prêt !`);
            }
            broadcastRefresh();
        }
    });

    socket.on('admin-draw', () => { 
        if (pool.length === 0) return; 
        const num = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]; 
        drawnNumbers.push(num); 
        io.emit('new-ball', { actuelle: num, historique: drawnNumbers }); 
    });

    socket.on('player-announce-bingo', (data) => { io.emit('admin-receive-bingo', data); });
    socket.on('admin-reset-all', () => { 
        players = {}; 
        pool = Array.from({length: 75}, (_, i) => i + 1); 
        drawnNumbers = []; 
        orders = []; 
        venteActive = false; 
        io.emit('game-reset'); 
        broadcastRefresh(); 
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Serveur BingoHome Prêt sur le port ${PORT}`); });
