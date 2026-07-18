const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

let players = {};         // Contient les joueurs validés et actifs
let pendingRegistrations = []; // Demandes d'inscription en attente de l'admin
let pool = Array.from({length: 75}, (_, i) => i + 1);
let drawnNumbers = [];
let orders = [];
let playerCount = 0;
let dernierNumeroSerie = 9;
let fichesMatchOuvertes = true;

io.on('connection', (socket) => {
    
    // Initialisation Admin : on lui envoie aussi les inscriptions en attente
    socket.on('admin-init', () => {
        socket.emit('refresh-admin', { 
            players: Object.values(players), 
            history: drawnNumbers, 
            orders,
            pendingRegistrations
        });
    });

    // 🔔 LE JOUEUR DEMANDE UNE INSCRIPTION
    socket.on('player-request-registration', ({ nom, tel }) => {
        // Vérifier si ce numéro de téléphone est déjà validé dans le système
        const dejaExiste = Object.values(players).find(p => p.tel === tel);
        if (dejaExiste) {
            return socket.emit('registration-status', { status: 'already_active', code: dejaExiste.code });
        }

        // Vérifier si la demande est déjà dans la liste d'attente
        const dejaEnAttente = pendingRegistrations.find(r => r.tel === tel);
        if (dejaEnAttente) {
            return socket.emit('registration-status', { status: 'pending' });
        }

        // Ajouter à la liste d'attente de la caisse
        pendingRegistrations.push({
            id: Date.now(),
            nom: nom.trim(),
            tel: tel.trim(),
            socketId: socket.id
        });

        socket.emit('registration-status', { status: 'submitted' });
        
        // Rafraîchir l'écran admin
        io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations });
    });

    // 🛠️ L'ADMIN VALIDE ET GÉNÈRE UN CODE UNIQUE SÉCURISÉ
    socket.on('admin-approve-registration', (idReg) => {
        const idx = pendingRegistrations.findIndex(r => r.id === idReg);
        if (idx !== -1) {
            const reg = pendingRegistrations[idx];
            
            // Génération d'un code de sécurité à 4 chiffres (ex: BH-4829)
            const randomDigits = Math.floor(1000 + Math.random() * 9000);
            const codeSecurise = `BH-${randomDigits}`;

            // Création définitive du joueur
            players[codeSecurise] = {
                nom: reg.nom,
                tel: reg.tel,
                code: codeSecurise,
                pions: 0,
                totalPionsRecus: 0,
                totalPionsDepenses: 0,
                nombreFiches: 0,
                seriesCartons: "",
                historiquePions: [{ date: "Système", description: "Compte validé et sécurisé", montant: "+0" }],
                online: false,
                socketId: null,
                grille: Array.from({length: 25}, () => Math.floor(Math.random() * 75) + 1)
            };

            // Notifier le joueur s'il est encore connecté sur la page
            io.to(reg.socketId).emit('registration-approved', { code: codeSecurise });

            // Retirer de la liste d'attente
            pendingRegistrations.splice(idx, 1);
            
            io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations });
        }
    });

    // CONNEXION DU JOUEUR AVEC LE CODE SÉCURISÉ
    socket.on('player-login', (code) => {
        const codeVerif = code.trim().toUpperCase();
        if (players[codeVerif]) {
            players[codeVerif].online = true;
            players[codeVerif].socketId = socket.id;
            socket.emit('login-success-dashboard', { player: players[codeVerif], tournoiActuel: {}, liveHistory: drawnNumbers });
            io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations });
        } else {
            socket.emit('login-error');
        }
    });

    // 📄 ACHAT DE FICHES BINGO
    socket.on('player-buy-fiches', ({ code, qte }) => {
        if (!players[code]) return;
        if (!fichesMatchOuvertes) return socket.emit('notification', "🔒 Les fiches pour ce match sont clôturées !");
        
        const cout = qte * 5;
        if (players[code].pions >= cout) {
            players[code].pions -= cout;
            players[code].totalPionsDepenses += cout;
            
            const debut = dernierNumeroSerie + 1;
            const fin = dernierNumeroSerie + qte;
            dernierNumeroSerie = fin;

            players[code].nombreFiches += qte;
            players[code].seriesCartons = `Série ${debut} à ${fin}`;
            players[code].historiquePions.unshift({ date: "Achat Fiche", description: `Achat ${qte} Cartons (${players[code].seriesCartons})`, montant: `-${cout}` });

            socket.emit('update-dashboard', players[code]);
            socket.emit('notification', `🎉 Cartons activés ! Série ${debut} à ${fin}`);
            io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations });
        } else {
            socket.emit('notification', `❌ Pions insuffisants.`);
        }
    });

    // 💳 RECHARGE DE PIONS
    socket.on('player-order', ({ code, type, qte }) => {
        if (!players[code]) return;
        const nbr = parseInt(qte);
        orders.push({ id: Date.now(), code, nom: players[code].nom, type: `${type} (${(nbr*100).toLocaleString()} XPF)`, qte: nbr });
        io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations });
    });

    socket.on('admin-validate-order', (idOrder) => {
        const idx = orders.findIndex(o => o.id === idOrder);
        if (idx !== -1) {
            const o = orders[idx];
            if (players[o.code]) {
                players[o.code].pions += o.qte;
                players[o.code].totalPionsRecus += o.qte;
                players[o.code].historiquePions.unshift({ date: "Caisse", description: "Recharge pions approuvée", montant: `+${o.qte}` });
                if (players[o.code].socketId) io.to(players[o.code].socketId).emit('update-dashboard', players[o.code]);
            }
            orders.splice(idx, 1);
            io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations });
        }
    });

    socket.on('player-announce-bingo', (data) => { io.emit('admin-receive-bingo', data); });
    socket.on('admin-toggle-ventes', (statut) => { fichesMatchOuvertes = statut; });

    socket.on('admin-draw', () => {
        if (pool.length === 0) return;
        const num = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
        drawnNumbers.push(num);
        io.emit('new-ball', { actuelle: num, historique: drawnNumbers });
        io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations });
    });

    socket.on('admin-request-carton', (code) => {
        if (players[code]) socket.emit('admin-view-carton', { nom: players[code].nom, code: code, grille: players[code].grille, history: drawnNumbers });
    });

    socket.on('admin-direct-reward', ({ code, montant }) => {
        if (players[code]) {
            const m = parseInt(montant);
            players[code].pions += m; players[code].totalPionsRecus += m;
            players[code].historiquePions.unshift({ date: "Gain", description: "Gain Bingo validé", montant: `+${m}` });
            if (players[code].socketId) io.to(players[code].socketId).emit('update-dashboard', players[code]);
            io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations });
        }
    });

    socket.on('admin-reset-all', () => {
        players = {}; pool = Array.from({length: 75}, (_, i) => i + 1); drawnNumbers = []; orders = []; playerCount = 0; dernierNumeroSerie = 9; fichesMatchOuvertes = true; pendingRegistrations = [];
        io.emit('game-reset'); io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations });
    });

    socket.on('disconnect', () => {
        for (let code in players) {
            if (players[code].socketId === socket.id) { players[code].online = false; players[code].socketId = null; io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations }); break; }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Serveur BingoHome Actif`); });
