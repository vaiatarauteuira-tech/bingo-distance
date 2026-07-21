const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

let players = {};              
let pendingRegistrations = []; 
let pool = Array.from({length: 75}, (_, i) => i + 1);
let drawnNumbers = [];
let orders = [];

let venteActive = false; 
let jeuActuel = { titre: "EN ATTENTE DU JEU", prix: 100, orga: "ADMIN / ORGA", desc: "1 boule pour 1 boule" };

let stockFichesAdmin = []; 
let creditOrganisateur = 0; 
let fichesAcheteesOrga = []; 
let cataloguePrixFiche = 50; 
let boutiqueOrgaFichesEnVente = 0; 
let prixFichePourJoueur = 100;       
let historiqueVentes = []; 

function broadcastRefresh() {
    io.emit('refresh-admin', { 
        players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations,
        stockFichesCount: stockFichesAdmin.length, creditOrganisateur, historiqueVentes
    });
    io.emit('refresh-orga', {
        creditOrganisateur, fichesDisponibles: fichesAcheteesOrga.length, cataloguePrixFiche,
        stockAdminCount: stockFichesAdmin.length, boutiqueOrgaFichesEnVente, prixFichePourJoueur, orders, historiqueVentes,
        playersList: Object.values(players), pendingRegistrations
    });
}

io.on('connection', (socket) => {
    
    // RENTRÉE ADMIN / ORGA -> SYNCHRONISATION IMMÉDIATE DES DEMANDES
    socket.on('admin-init', () => { broadcastRefresh(); });
    socket.on('orga-init', () => { broadcastRefresh(); });

    // DEMANDE D'INSCRIPTION DU JOUEUR
    socket.on('player-request-registration', ({ nom, tel }) => {
        const telNettoye = (tel || "").trim().replace(/[^0-9]/g, "");
        const nomNettoye = (nom || "").trim();
        
        if (!nomNettoye || !telNettoye) return;

        // 1. Vérification si déjà validé
        const joueurExistant = Object.values(players).find(p => p.tel === telNettoye);
        if (joueurExistant) {
            io.emit('admin-security-alert', { type: "FRAUDE_NUMERO_EXISTANT", tel: telNettoye, nomFraudeur: nomNettoye, nomProprietaire: joueurExistant.nom, codeAssocie: joueurExistant.code });
            return socket.emit('registration-status', { status: 'already_active', code: joueurExistant.code });
        }

        // 2. Ajout à la liste en attente
        const nouvelleDemande = { id: Date.now(), nom: nomNettoye, tel: telNettoye, socketId: socket.id };
        pendingRegistrations.push(nouvelleDemande);
        
        socket.emit('registration-status', { status: 'submitted' });
        
        // Broadcast instantané pour que l'Admin et l'Orga voient la demande immédiatement !
        broadcastRefresh();
    });

    // APPROBATION PAR L'ADMIN/ORGA
    socket.on('admin-approve-registration', (idReg) => {
        const idx = pendingRegistrations.findIndex(r => r.id === idReg);
        if (idx !== -1) {
            const reg = pendingRegistrations[idx];
            const codeUniverselUnique = `BH-${Math.floor(1000 + Math.random() * 9000)}`;
            
            players[codeUniverselUnique] = {
                nom: reg.nom, tel: reg.tel, code: codeUniverselUnique, pions: 0, totalPionsRecus: 0, totalPionsDepenses: 0, nombreFiches: 0, seriesCartons: "", pdfUrl: null, pagesInfo: "", online: false, socketId: null
            };

            io.to(reg.socketId).emit('registration-approved', { code: codeUniverselUnique });
            socket.emit('admin-code-generated-display', { nom: reg.nom, tel: reg.tel, code: codeUniverselUnique });
            pendingRegistrations.splice(idx, 1);
            broadcastRefresh();
        }
    });

    socket.on('player-login', (code) => {
        if (!code || typeof code !== 'string') {
            return socket.emit('login-error', '❌ Veuillez saisir un code.');
        }

        const codeVerif = code.trim().toUpperCase();

        if (players[codeVerif]) {
            players[codeVerif].online = true; 
            players[codeVerif].socketId = socket.id;
            
            socket.emit('login-success-dashboard', { player: players[codeVerif], liveHistory: drawnNumbers });
            socket.emit('sync-vente-status', { active: venteActive, jeu: jeuActuel });
            broadcastRefresh();
        } else { 
            socket.emit('login-error', '❌ ACCÈS REFUSÉ ! Ce code n\'a pas été créé par l\'organisation.'); 
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

    socket.on('player-order', ({ code, type, qte, destinataire }) => {
        const codeClean = (code || "").trim().toUpperCase();
        if (players[codeClean] || codeClean === "ORGANISATEUR") { 
            const nomEmetteur = players[codeClean] ? players[codeClean].nom : "ORGANISATEUR";
            orders.push({ id: Date.now(), code: codeClean, nom: nomEmetteur, type: type, qte: parseInt(qte), destinataire: destinataire }); 
            broadcastRefresh(); 
        }
    });

    socket.on('admin-validate-order', (idOrder) => {
        const idx = orders.findIndex(o => o.id === idOrder);
        if (idx !== -1) {
            const o = orders[idx];
            const codeClean = (o.code || "").trim().toUpperCase();
            if (players[codeClean]) { 
                players[codeClean].pions += parseInt(o.qte); 
                players[codeClean].totalPionsRecus += parseInt(o.qte);
                if (players[codeClean].socketId) io.to(players[codeClean].socketId).emit('update-dashboard', players[codeClean]); 
                io.emit('update-dashboard-global', { code: codeClean, player: players[codeClean] });
            }
            orders.splice(idx, 1);
            broadcastRefresh();
        }
    });

    socket.on('admin-direct-reward', ({ code, montant }) => {
        const codeClean = (code || "").trim().toUpperCase();
        const ajoutPions = parseInt(montant) || 0;

        if (players[codeClean]) { 
            players[codeClean].pions += ajoutPions; 
            players[codeClean].totalPionsRecus += ajoutPions;
            if (players[codeClean].socketId) {
                io.to(players[codeClean].socketId).emit('update-dashboard', players[codeClean]); 
                io.to(players[codeClean].socketId).emit('notification', `🎁 Rechargement : +${ajoutPions} Pions crédités !`);
            }
            io.emit('update-dashboard-global', { code: codeClean, player: players[codeClean] });
            broadcastRefresh(); 
        } else {
            socket.emit('notification', `❌ Code joueur ${codeClean} introuvable !`);
        }
    });

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
            io.emit('update-dashboard-global', { code: codeClean, player: players[codeClean] });
            broadcastRefresh();
        }
    });

    socket.on('player-buy-fiches-from-orga', ({ code, qte }) => {
        const codeClean = (code || "").trim().toUpperCase();
        if (!venteActive) return socket.emit('notification', '❌ Les ventes sont actuellement fermées !');
        
        const coutTotal = qte * jeuActuel.prix;
        if (players[codeClean] && players[codeClean].pions >= coutTotal) {
            players[codeClean].pions -= coutTotal;
            players[codeClean].nombreFiches += qte;
            players[codeClean].seriesCartons = jeuActuel.titre;
            
            historiqueVentes.unshift({ id: Date.now(), date: "Commande Directe", nomJoueur: players[codeClean].nom, codeJoueur: players[codeClean].code, quantite: qte, pionsDepenses: coutTotal, infoSérie: jeuActuel.titre });
            
            if (players[codeClean].socketId) io.to(players[codeClean].socketId).emit('update-dashboard', players[codeClean]);
            io.emit('update-dashboard-global', { code: codeClean, player: players[codeClean] });
            broadcastRefresh();
        }
    });

    socket.on('admin-draw', () => { if (pool.length === 0) return; const num = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]; drawnNumbers.push(num); io.emit('new-ball', { actuelle: num, historique: drawnNumbers }); });
    socket.on('player-announce-bingo', (data) => { io.emit('admin-receive-bingo', data); });
    socket.on('admin-send-flash', (msg) => { io.emit('notification', msg); });
    socket.on('admin-reset-all', () => { players = {}; pool = Array.from({length: 75}, (_, i) => i + 1); drawnNumbers = []; orders = []; venteActive = false; io.emit('game-reset'); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Serveur BingoHome Actif`); });
