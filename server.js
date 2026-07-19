const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

// Variables globales de la session de jeu BingoHome
let players = {};              
let pendingRegistrations = []; 
let pool = Array.from({length: 75}, (_, i) => i + 1);
let drawnNumbers = [];
let orders = [];
let playerCount = 0;
let fichesMatchOuvertes = true;

// --- NOUVEAU SYSTÈME DE COMMERCE ADMIN -> ORGANISATEUR ---
let stockFichesAdmin = []; // Fiches personnalisées injectées par l'admin
let creditOrganisateur = 0; // Portefeuille de l'orga pour acheter à l'admin
let fichesAcheteesOrga = []; // Fiches que l'organisateur a achetées à l'admin
let cataloguePrixFiche = 50; // Prix d'une fiche personnalisée en pions/crédits

io.on('connection', (socket) => {
    
    // Initialisation Admin
    socket.on('admin-init', () => {
        socket.emit('refresh-admin', { 
            players: Object.values(players), 
            history: drawnNumbers, 
            orders,
            pendingRegistrations,
            stockFichesCount: stockFichesAdmin.length,
            creditOrganisateur
        });
    });

    // Initialisation Organisateur
    socket.on('orga-init', () => {
        socket.emit('refresh-orga', {
            creditOrganisateur,
            fichesDisponibles: fichesAcheteesOrga.length,
            cataloguePrixFiche,
            stockAdminCount: stockFichesAdmin.length
        });
    });

    // ➕ L'ADMIN INJECTE DES FICHES PERSONNALISÉES DANS SON STOCK
    socket.on('admin-add-custom-fiches', ({ nomSerie, quantite }) => {
        const qte = parseInt(quantite) || 1;
        for (let i = 0; i < qte; i++) {
            const numeroSerieUnique = Math.floor(100000 + Math.random() * 900000);
            stockFichesAdmin.push({
                serieNom: nomSerie || "Série Spéciale",
                numero: numeroSerieUnique,
                grille: Array.from({length: 25}, () => Math.floor(Math.random() * 75) + 1)
            });
        }
        io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations, stockFichesCount: stockFichesAdmin.length, creditOrganisateur });
        io.emit('refresh-orga', { creditOrganisateur, fichesDisponibles: fichesAcheteesOrga.length, cataloguePrixFiche, stockAdminCount: stockFichesAdmin.length });
    });

    // 💰 L'ADMIN RECHARGE LE CRÉDIT DE L'ORGANISATEUR
    socket.on('admin-recharge-orga', (montant) => {
        creditOrganisateur += parseInt(montant) || 0;
        io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations, stockFichesCount: stockFichesAdmin.length, creditOrganisateur });
        io.emit('refresh-orga', { creditOrganisateur, fichesDisponibles: fichesAcheteesOrga.length, cataloguePrixFiche, stockAdminCount: stockFichesAdmin.length });
    });

    // 🛒 L'ORGANISATEUR ACHÈTE DES FICHES AUPRÈS DE L'ADMIN
    socket.on('orga-buy-fiches', (quantite) => {
        const qte = parseInt(quantite) || 0;
        const coutTotal = qte * cataloguePrixFiche;

        if (creditOrganisateur >= coutTotal) {
            if (stockFichesAdmin.length >= qte) {
                creditOrganisateur -= coutTotal;
                // Transfert des fiches du stock admin vers l'organisateur
                const fichesPrises = stockFichesAdmin.splice(0, qte);
                fichesAcheteesOrga = fichesAcheteesOrga.concat(fichesPrises);

                socket.emit('orga-notification', `✅ Achat réussi ! Vous avez récupéré ${qte} fiches personnalisées.`);
                
                io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations, stockFichesCount: stockFichesAdmin.length, creditOrganisateur });
                io.emit('refresh-orga', { creditOrganisateur, fichesDisponibles: fichesAcheteesOrga.length, cataloguePrixFiche, stockAdminCount: stockFichesAdmin.length });
            } else {
                socket.emit('orga-notification', "❌ Stock Admin insuffisant pour cette quantité.");
            }
        } else {
            socket.emit('orga-notification', "❌ Crédit insuffisant. Demandez une recharge à l'Admin.");
        }
    });

    // --- RESTE DU CODE TEMPS RÉEL (SÉCURISÉ) ---
    socket.on('player-request-registration', ({ nom, tel }) => {
        const telNettoye = tel.trim().replace(/[^0-9]/g, "");
        const dejaExiste = Object.values(players).find(p => p.tel === telNettoye);
        if (dejaExiste) return socket.emit('registration-status', { status: 'already_active', code: dejaExiste.code });
        
        if (pendingRegistrations.find(r => r.tel === telNettoye)) return socket.emit('registration-status', { status: 'pending' });

        pendingRegistrations.push({ id: Date.now(), nom: nom.trim(), tel: telNettoye, socketId: socket.id });
        socket.emit('registration-status', { status: 'submitted' });
        io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations, stockFichesCount: stockFichesAdmin.length, creditOrganisateur });
    });

    socket.on('admin-approve-registration', (idReg) => {
        const idx = pendingRegistrations.findIndex(r => r.id === idReg);
        if (idx !== -1) {
            const reg = pendingRegistrations[idx];
            const codeSecurise = `BH-${Math.floor(1000 + Math.random() * 9000)}`;

            players[codeSecurise] = {
                nom: reg.nom, tel: reg.tel, code: codeSecurise, pions: 0, totalPionsRecus: 0, totalPionsDepenses: 0, nombreFiches: 0, seriesCartons: "",
                historiquePions: [{ date: "Système", description: "Accès caisse approuvé", montant: "+0" }],
                online: false, socketId: null, grille: Array.from({length: 25}, () => Math.floor(Math.random() * 75) + 1)
            };
            io.to(reg.socketId).emit('registration-approved', { code: codeSecurise });
            pendingRegistrations.splice(idx, 1);
            io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations, stockFichesCount: stockFichesAdmin.length, creditOrganisateur });
        }
    });

    socket.on('player-login', (code) => {
        const codeVerif = code.trim().toUpperCase();
        if (players[codeVerif]) {
            players[codeVerif].online = true; players[codeVerif].socketId = socket.id;
            socket.emit('login-success-dashboard', { player: players[codeVerif], tournoiActuel: {}, liveHistory: drawnNumbers });
        } else { socket.emit('login-error'); }
    });

    socket.on('admin-draw', () => {
        if (pool.length === 0) return;
        const num = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
        drawnNumbers.push(num);
        io.emit('new-ball', { actuelle: num, historique: drawnNumbers });
    });

    socket.on('admin-reset-all', () => {
        players = {}; pool = Array.from({length: 75}, (_, i) => i + 1); drawnNumbers = []; orders = []; stockFichesAdmin = []; fichesAcheteesOrga = []; creditOrganisateur = 0; pendingRegistrations = [];
        io.emit('game-reset');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Serveur BingoHome Actif`); });
