const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

// Variables de session globales BingoHome
let players = {};              
let pendingRegistrations = []; 
let pool = Array.from({length: 75}, (_, i) => i + 1);
let drawnNumbers = [];
let orders = [];
let fichesMatchOuvertes = true;

let stockFichesAdmin = []; 
let creditOrganisateur = 0; 
let fichesAcheteesOrga = []; 
let cataloguePrixFiche = 50; 
let boutiqueOrgaFichesEnVente = 0; 
let prixFichePourJoueur = 5;       
let historiqueVentes = []; 

io.on('connection', (socket) => {
    
    socket.on('admin-init', () => {
        socket.emit('refresh-admin', { 
            players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations,
            stockFichesCount: stockFichesAdmin.length, creditOrganisateur, historiqueVentes
        });
    });

    socket.on('orga-init', () => {
        socket.emit('refresh-orga', {
            creditOrganisateur, fichesDisponibles: fichesAcheteesOrga.length, cataloguePrixFiche,
            stockAdminCount: stockFichesAdmin.length, boutiqueOrgaFichesEnVente, prixFichePourJoueur, orders, historiqueVentes
        });
    });

    // 📱 TRAITEMENT DES INSCRIPTIONS ET DÉTECTION STRICTE DE LA FRAUDE
    socket.on('player-request-registration', ({ nom, tel }) => {
        const telNettoye = tel.trim().replace(/[^0-9]/g, "");
        if (!nom || !telNettoye) return;

        // 🚨 CRITICAL ANTI-FRAUDE 1 : Le numéro existe déjà dans la base certifiée ?
        const joueurExistant = Object.values(players).find(p => p.tel === telNettoye);
        if (joueurExistant) {
            // On déclenche le gyrophare de fraude sur l'écran Admin
            io.emit('admin-security-alert', {
                type: "FRAUDE_NUMERO_EXISTANT",
                tel: telNettoye,
                nomFraudeur: nom.trim(),
                nomProprietaire: joueurExistant.nom,
                codeAssocie: joueurExistant.code
            });
            // On renvoie simplement son code d'origine au joueur sans rien recréer
            return socket.emit('registration-status', { status: 'already_active', code: joueurExistant.code });
        }

        // 🚨 CRITICAL ANTI-FRAUDE 2 : Le numéro harcèle la liste d'attente ?
        const dejaEnAttente = pendingRegistrations.find(r => r.tel === telNettoye);
        if (dejaEnAttente) {
            io.emit('admin-security-alert', {
                type: "SPAM_INSCRIPTION",
                tel: telNettoye,
                nomFraudeur: nom.trim(),
                nomProprietaire: dejaEnAttente.nom,
                codeAssocie: "En attente de validation Admin"
            });
            return socket.emit('registration-status', { status: 'pending' });
        }

        // Si tout est vert, on met en attente de certification Admin
        pendingRegistrations.push({ id: Date.now(), nom: nom.trim(), tel: telNettoye, socketId: socket.id });
        socket.emit('registration-status', { status: 'submitted' });
        
        io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations, stockFichesCount: stockFichesAdmin.length, creditOrganisateur, historiqueVentes });
    });

        // 🔑 L'ADMIN CERTIFIE ET REÇOIT LE CODE UNIQUE POUR L'ENVOYER PERSONNELLEMENT
    socket.on('admin-approve-registration', (idReg) => {
        const idx = pendingRegistrations.findIndex(r => r.id === idReg);
        if (idx !== -1) {
            const reg = pendingRegistrations[idx];
            
            // Double verrou anti-doublon
            if (Object.values(players).find(p => p.tel === reg.tel)) {
                pendingRegistrations.splice(idx, 1);
                return io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations, stockFichesCount: stockFichesAdmin.length, creditOrganisateur, historiqueVentes });
            }

            // Génération de la clé universelle unique BingoHome
            const codeUniverselUnique = `BH-${Math.floor(1000 + Math.random() * 9000)}`;

            players[codeUniverselUnique] = {
                nom: reg.nom,
                tel: reg.tel,
                code: codeUniverselUnique,
                pions: 0,
                totalPionsRecus: 0,
                totalPionsDepenses: 0,
                nombreFiches: 0,
                seriesCartons: "",
                historiquePions: [{ date: "Système", description: "Compte certifié unique", montant: "+0" }],
                online: false, socketId: null, grille: Array.from({length: 25}, () => Math.floor(Math.random() * 75) + 1)
            };

            // 📢 CRITICAL : On envoie la confirmation au joueur ET on renvoie le code à l'ADMIN
            io.to(reg.socketId).emit('registration-approved', { code: codeUniverselUnique });
            socket.emit('admin-code-generated-display', { nom: reg.nom, tel: reg.tel, code: codeUniverselUnique });
            
            pendingRegistrations.splice(idx, 1);
            
            io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations, stockFichesCount: stockFichesAdmin.length, creditOrganisateur, historiqueVentes });
        }
    });

            }

            // Génération de la clé universelle unique BingoHome
            const codeUniverselUnique = `BH-${Math.floor(1000 + Math.random() * 9000)}`;

            players[codeUniverselUnique] = {
                nom: reg.nom,
                tel: reg.tel,
                code: codeUniverselUnique,
                pions: 0,
                totalPionsRecus: 0,
                totalPionsDepenses: 0,
                nombreFiches: 0,
                seriesCartons: "",
                historiquePions: [{ date: "Système", description: "Compte certifié unique et universel", montant: "+0" }],
                online: false, socketId: null, grille: Array.from({length: 25}, () => Math.floor(Math.random() * 75) + 1)
            };

            io.to(reg.socketId).emit('registration-approved', { code: codeUniverselUnique });
            pendingRegistrations.splice(idx, 1);
            
            io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations, stockFichesCount: stockFichesAdmin.length, creditOrganisateur, historiqueVentes });
        }
    });

    // LE RESTE DES FLUX RÉSEAU DE L'ÉCOSYSTÈME BINGOHOME
    socket.on('player-login', (code) => {
        const codeVerif = code.trim().toUpperCase();
        if (players[codeVerif]) {
            players[codeVerif].online = true; players[codeVerif].socketId = socket.id;
            socket.emit('login-success-dashboard', { player: players[codeVerif], tournoiActuel: {}, liveHistory: drawnNumbers });
            socket.emit('refresh-boutique-joueurs', { boutiqueOrgaFichesEnVente, prixFichePourJoueur });
            io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations, stockFichesCount: stockFichesAdmin.length, creditOrganisateur, historiqueVentes });
        } else { socket.emit('login-error'); }
    });

    socket.on('player-buy-fiches-from-orga', ({ code, qte }) => {
        if (players[code] && fichesMatchOuvertes && boutiqueOrgaFichesEnVente >=     // 🔑 L'ADMIN CERTIFIE ET REÇOIT LE CODE UNIQUE POUR L'ENVOYER PERSONNELLEMENT
    socket.on('admin-approve-registration', (idReg) => {
        const idx = pendingRegistrations.findIndex(r => r.id === idReg);
        if (idx !== -1) {
            const reg = pendingRegistrations[idx];
            
            // Double verrou anti-doublon
            if (Object.values(players).find(p => p.tel === reg.tel)) {
                pendingRegistrations.splice(idx, 1);
                return io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations, stockFichesCount: stockFichesAdmin.length, creditOrganisateur, historiqueVentes });
            }

            // Génération de la clé universelle unique BingoHome
            const codeUniverselUnique = `BH-${Math.floor(1000 + Math.random() * 9000)}`;

            players[codeUniverselUnique] = {
                nom: reg.nom,
                tel: reg.tel,
                code: codeUniverselUnique,
                pions: 0,
                totalPionsRecus: 0,
                totalPionsDepenses: 0,
                nombreFiches: 0,
                seriesCartons: "",
                historiquePions: [{ date: "Système", description: "Compte certifié unique", montant: "+0" }],
                online: false, socketId: null, grille: Array.from({length: 25}, () => Math.floor(Math.random() * 75) + 1)
            };

            // 📢 CRITICAL : On envoie la confirmation au joueur ET on renvoie le code à l'ADMIN
            io.to(reg.socketId).emit('registration-approved', { code: codeUniverselUnique });
            socket.emit('admin-code-generated-display', { nom: reg.nom, tel: reg.tel, code: codeUniverselUnique });
            
            pendingRegistrations.splice(idx, 1);
            
            io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations, stockFichesCount: stockFichesAdmin.length, creditOrganisateur, historiqueVentes });
        }
    });
qte && players[code].pions >= (qte * prixFichePourJoueur)) {
            const coutTotal = qte * prixFichePourJoueur;
            players[code].pions -= coutTotal; players[code].totalPionsDepenses += coutTotal; boutiqueOrgaFichesEnVente -= qte;
            const livrees = fichesAcheteesOrga.splice(0, qte); players[code].nombreFiches += qte; players[code].seriesCartons = `Série ${livrees[0].serieNom} (#${livrees[0].numero})`;
            historiqueVentes.unshift({ id: Date.now(), date: "Achat Direct", nomJoueur: players[code].nom, codeJoueur: players[code].code, quantite: qte, pionsDepenses: coutTotal, infoSérie: players[code].seriesCartons });
            socket.emit('update-dashboard', players[code]);
            io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations, stockFichesCount: stockFichesAdmin.length, creditOrganisateur, historiqueVentes });
            io.emit('refresh-orga', { creditOrganisateur, fichesDisponibles: fichesAcheteesOrga.length, cataloguePrixFiche, stockAdminCount: stockFichesAdmin.length, boutiqueOrgaFichesEnVente, prixFichePourJoueur, orders, historiqueVentes });
            io.emit('refresh-boutique-joueurs', { boutiqueOrgaFichesEnVente, prixFichePourJoueur });
        }
    });

    socket.on('player-order', ({ code, type, qte, destinataire }) => {
        if (players[code]) { orders.push({ id: Date.now(), code, nom: players[code].nom, type, qte: parseInt(qte), destinataire }); io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations, stockFichesCount: stockFichesAdmin.length, creditOrganisateur, historiqueVentes }); io.emit('refresh-orga', { creditOrganisateur, fichesDisponibles: fichesAcheteesOrga.length, cataloguePrixFiche, stockAdminCount: stockFichesAdmin.length, boutiqueOrgaFichesEnVente, prixFichePourJoueur, orders, historiqueVentes }); }
    });

    socket.on('admin-validate-order', (idOrder) => {
        const idx = orders.findIndex(o => o.id === idOrder);
        if (idx !== -1) {
            const o = orders[idx];
            if (players[o.code]) { players[o.code].pions += o.qte; players[o.code].totalPionsRecus += o.qte; players[o.code].historiquePions.unshift({ date: "Caisse", description: "Recharge pions approuvée", montant: `+${o.qte}` }); if (players[o.code].socketId) io.to(players[o.code].socketId).emit('update-dashboard', players[o.code]); }
            orders.splice(idx, 1);
            io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations, stockFichesCount: stockFichesAdmin.length, creditOrganisateur, historiqueVentes });
            io.emit('refresh-orga', { creditOrganisateur, fichesDisponibles: fichesAcheteesOrga.length, cataloguePrixFiche, stockAdminCount: stockFichesAdmin.length, boutiqueOrgaFichesEnVente, prixFichePourJoueur, orders, historiqueVentes });
        }
    });

    socket.on('admin-draw', () => { if (pool.length === 0) return; const num = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]; drawnNumbers.push(num); io.emit('new-ball', { actuelle: num, historique: drawnNumbers }); });
    socket.on('player-announce-bingo', (data) => { io.emit('admin-receive-bingo', data); });
    socket.on('admin-toggle-ventes', (statut) => { fichesMatchOuvertes = statut; });
    socket.on('admin-send-flash', (msg) => { io.emit('notification', msg); });
    socket.on('admin-request-carton', (code) => { if (players[code]) socket.emit('admin-view-carton', { nom: players[code].nom, code: code, grille: players[code].grille, history: drawnNumbers }); });
    socket.on('admin-direct-reward', ({ code, montant }) => { if (players[code]) { players[code].pions += parseInt(montant); if (players[code].socketId) io.to(players[code].socketId).emit('update-dashboard', players[code]); io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations, stockFichesCount: stockFichesAdmin.length, creditOrganisateur, historiqueVentes }); } });
    socket.on('admin-add-custom-fiches', ({ nomSerie, quantite }) => { const qte = parseInt(quantite) || 1; for (let i = 0; i < qte; i++) { stockFichesAdmin.push({ serieNom: nomSerie || "Série Spéciale", numero: Math.floor(100000 + Math.random() * 900000), grille: Array.from({length: 25}, () => Math.floor(Math.random() * 75) + 1) }); } io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations, stockFichesCount: stockFichesAdmin.length, creditOrganisateur, historiqueVentes }); io.emit('refresh-orga', { creditOrganisateur, fichesDisponibles: fichesAcheteesOrga.length, cataloguePrixFiche, stockAdminCount: stockFichesAdmin.length, boutiqueOrgaFichesEnVente, prixFichePourJoueur, orders, historiqueVentes }); });
    socket.on('admin-recharge-orga', (montant) => { creditOrganisateur += parseInt(montant) || 0; io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations, stockFichesCount: stockFichesAdmin.length, creditOrganisateur, historiqueVentes }); io.emit('refresh-orga', { creditOrganisateur, fichesDisponibles: fichesAcheteesOrga.length, cataloguePrixFiche, stockAdminCount: stockFichesAdmin.length, boutiqueOrgaFichesEnVente, prixFichePourJoueur, orders, historiqueVentes }); });
    socket.on('orga-buy-fiches', (quantite) => { const qte = parseInt(quantite) || 0; const coutTotal = qte * cataloguePrixFiche; if (creditOrganisateur >= coutTotal && stockFichesAdmin.length >= qte) { creditOrganisateur -= coutTotal; fichesAcheteesOrga = fichesAcheteesOrga.concat(stockFichesAdmin.splice(0, qte)); io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations, stockFichesCount: stockFichesAdmin.length, creditOrganisateur, historiqueVentes }); io.emit('refresh-orga', { creditOrganisateur, fichesDisponibles: fichesAcheteesOrga.length, cataloguePrixFiche, stockAdminCount: stockFichesAdmin.length, boutiqueOrgaFichesEnVente, prixFichePourJoueur, orders, historiqueVentes }); } });
    socket.on('admin-reset-all', () => { players = {}; pool = Array.from({length: 75}, (_, i) => i + 1); drawnNumbers = []; orders = []; stockFichesAdmin = []; fichesAcheteesOrga = []; creditOrganisateur = 0; boutiqueOrgaFichesEnVente = 0; pendingRegistrations = []; historiqueVentes = []; io.emit('game-reset'); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Serveur BingoHome Actif`); });
