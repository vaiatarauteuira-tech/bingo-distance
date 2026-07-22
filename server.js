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


let historiqueVentes = [];
let pendingRegistrations = [];

let venteActive = false; 
let jeuActuel = { titre: "EN ATTENTE DU JEU", prix: 100, orga: "ADMIN / ORGA", desc: "1 boule pour 1 boule" };



function broadcastRefresh() {
    const playersArray = Object.values(players);

    io.emit('refresh-admin', { 
        players: playersArray,
        history: drawnNumbers,
        orders: orders,
        historiqueVentes: historiqueVentes,
        pendingRegistrations: pendingRegistrations,
        stockFichesCount: 0,
        creditOrganisateur: 0
    });

    io.emit('refresh-orga', { 
        playersList: playersArray,
        orders: orders,
        historiqueVentes: historiqueVentes
    });
}




    });

    io.emit('refresh-admin', { 
    players: playersArray, 
    history: drawnNumbers, 
    orders: orders,
    historiqueVentes: historiqueVentes,
    pendingRegistrations: pendingRegistrations,
    stockFichesCount: 0,
    creditOrganisateur: 0
});
}

io.on('connection', (socket) => {
    
    socket.on('admin-init', () => { broadcastRefresh(); });
    

    // ⚡ CRÉATION DIRECTE DU JOUEUR (Code unique BH-XXXX)
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

// 📝 DEMANDE DE CRÉATION DE CODE JOUEUR
socket.on('player-request-registration', ({ nom, tel }) => {

    const demande = {
        id: Date.now(),
        nom: nom.trim(),
        tel: tel.trim(),
        statut: "en attente"
    };

    if (!global.pendingRegistrations) {
        global.pendingRegistrations = [];
    }

    global.pendingRegistrations.push(demande);

    console.log("Nouvelle demande joueur :", demande);

    broadcastRefresh();
});


    // 🪙 DEMANDE DE PIONS DU JOUEUR (Transmission instantanée)
    socket.on('player-request-pions', ({ code, qte }) => {
        const codeClean = (code || "").trim().toUpperCase();
        const quantite = parseInt(qte) || 0;

        if (players[codeClean] && quantite > 0) {
            const nouvelleDemande = {
                id: Date.now(),
                code: codeClean,
                nom: players[codeClean].nom,
                qte: quantite,
                heure: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
            };

            orders.unshift(nouvelleDemande);
            io.emit('notification-staff', `🪙 ${players[codeClean].nom} (${codeClean}) demande ${quantite} pions !`);
            broadcastRefresh();
        }
    });

    // 🎁 VALIDATION DE PIONS PAR L'ADMIN / ORGA
    socket.on('admin-validate-order', (idOrder) => {
        const idx = orders.findIndex(o => o.id === idOrder);
        if (idx !== -1) {
            const o = orders[idx];
            const codeClean = (o.code || "").trim().toUpperCase();
            
            if (players[codeClean]) {
                players[codeClean].pions += parseInt(o.qte);
                if (players[codeClean].socketId) {
                    io.to(players[codeClean].socketId).emit('update-dashboard', players[codeClean]);
                    io.to(players[codeClean].socketId).emit('notification', `🎁 +${o.qte} Pions ajoutés !`);
                }
            }
            orders.splice(idx, 1);
            broadcastRefresh();
        }
    });

    // 📄 LIVRAISON DU PDF 1 PAR 1
    socket.on('orga-deliver-pdf', ({ code, serie, fichierUrl, pageDebut, pageFin }) => {
        const codeClean = (code || "").trim().toUpperCase();
        if (players[codeClean]) {
            players[codeClean].pdfUrl = fichierUrl;
            players[codeClean].seriesCartons = serie;
            players[codeClean].pagesInfo = (pageDebut === pageFin) ? `Page ${pageDebut}` : `Pages ${pageDebut} à ${pageFin}`;

            if (players[codeClean].socketId) {
                io.to(players[codeClean].socketId).emit('update-dashboard', players[codeClean]);
                io.to(players[codeClean].socketId).emit('notification', `📄 Votre ticket (${players[codeClean].pagesInfo}) est disponible !`);
            }
            broadcastRefresh();
        }
    });


let pendingRegistrations = [];



    const demande = {
        id: Date.now(),
        nom: nom,
        tel: tel
    };

    pendingRegistrations.push(demande);

    io.emit('notification-staff', 
        `📝 Nouvelle demande de code : ${nom}`
    );

    broadcastRefresh();
});

    // 🔐 CONNEXION JOUEUR SÉCURISÉE
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
            socket.emit('login-error', '❌ ACCÈS REFUSÉ ! Ce code n\'existe pas dans le système.'); 
        }
    });

    // BOULIER EN DIRECT
    socket.on('admin-draw', () => { 
        if (pool.length === 0) return; 
        const num = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]; 
        drawnNumbers.push(num); 
        io.emit('new-ball', { actuelle: num, historique: drawnNumbers }); 
    });

    socket.on('player-announce-bingo', (data) => { io.emit('admin-receive-bingo', data); });
   


socket.on('admin-reset-all', () => {
    players = {};
    pendingRegistrations = [];
    pool = Array.from({ length: 75 }, (_, i) => i + 1);
    drawnNumbers = [];
    orders = [];
    historiqueVentes = [];
    venteActive = false;

    io.emit('game-reset');
    broadcastRefresh();
});

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Serveur BingoHome Prêt sur le port ${PORT}`); });
