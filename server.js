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
let fichesMatchOuvertes = true;

// --- SYSTÈME DE COMMERCE ADMIN -> ORGANISATEUR -> JOUEURS ---
let stockFichesAdmin = []; 
let creditOrganisateur = 0; 
let fichesAcheteesOrga = []; // Réserve brute de l'organisateur
let cataloguePrixFiche = 50; 

// Nouvelle gestion de la boutique de l'organisateur pour les joueurs
let boutiqueOrgaFichesEnVente = 0; // Nombre de fiches de sa réserve que l'orga met sur le marché
let prixFichePourJoueur = 5;       // Prix d'une fiche en pions pour le joueur

io.on('connection', (socket) => {
    
    socket.on('admin-init', () => {
        socket.emit('refresh-admin', { 
            players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations,
            stockFichesCount: stockFichesAdmin.length, creditOrganisateur
        });
    });

    socket.on('orga-init', () => {
        socket.emit('refresh-orga', {
            creditOrganisateur,
            fichesDisponibles: fichesAcheteesOrga.length,
            cataloguePrixFiche,
            stockAdminCount: stockFichesAdmin.length,
            boutiqueOrgaFichesEnVente,
            prixFichePourJoueur
        });
    });

    // ADMIN AJOUTE DES FICHES AU CATALOGUE
    socket.on('admin-add-custom-fiches', ({ nomSerie, quantite }) => {
        const qte = parseInt(quantite) || 1;
        for (let i = 0; i < qte; i++) {
            stockFichesAdmin.push({
                serieNom: nomSerie || "Série Spéciale",
                numero: Math.floor(100000 + Math.random() * 900000),
                grille: Array.from({length: 25}, () => Math.floor(Math.random() * 75) + 1)
            });
        }
        io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations, stockFichesCount: stockFichesAdmin.length, creditOrganisateur });
        io.emit('refresh-orga', { creditOrganisateur, fichesDisponibles: fichesAcheteesOrga.length, cataloguePrixFiche, stockAdminCount: stockFichesAdmin.length, boutiqueOrgaFichesEnVente, prixFichePourJoueur });
    });

    socket.on('admin-recharge-orga', (montant) => {
        creditOrganisateur += parseInt(montant) || 0;
        io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations, stockFichesCount: stockFichesAdmin.length, creditOrganisateur });
        io.emit('refresh-orga', { creditOrganisateur, fichesDisponibles: fichesAcheteesOrga.length, cataloguePrixFiche, stockAdminCount: stockFichesAdmin.length, boutiqueOrgaFichesEnVente, prixFichePourJoueur });
    });

    // ORGANISATEUR ACHÈTE À L'ADMIN
    socket.on('orga-buy-fiches', (quantite) => {
        const qte = parseInt(quantite) || 0;
        const coutTotal = qte * cataloguePrixFiche;
        if (creditOrganisateur >= coutTotal && stockFichesAdmin.length >= qte) {
            creditOrganisateur -= coutTotal;
            const fichesPrises = stockFichesAdmin.splice(0, qte);
            fichesAcheteesOrga = fichesAcheteesOrga.concat(fichesPrises);
            socket.emit('orga-notification', `✅ Achat réussi ! +${qte} fiches en réserve.`);
            io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations, stockFichesCount: stockFichesAdmin.length, creditOrganisateur });
            io.emit('refresh-orga', { creditOrganisateur, fichesDisponibles: fichesAcheteesOrga.length, cataloguePrixFiche, stockAdminCount: stockFichesAdmin.length, boutiqueOrgaFichesEnVente, prixFichePourJoueur });
        } else {
            socket.emit('orga-notification', "❌ Erreur : Crédit ou stock insuffisant.");
        }
    });

    // 🎪 ORGANISATEUR MET EN VENTE DES FICHES POUR LES JOUEURS
    socket.on('orga-set-vende-fiches', ({ quantite, prix }) => {
        const qte = parseInt(quantite) || 0;
        const p = parseInt(prix) || 5;
        if (fichesAcheteesOrga.length >= qte) {
            boutiqueOrgaFichesEnVente = qte;
            prixFichePourJoueur = p;
            socket.emit('orga-notification', `📢 Boutique mise à jour : ${qte} fiches sur le marché à ${p} pions l'unité !`);
            
            // On notifie immédiatement tous les joueurs de la mise à jour de la boutique
            io.emit('refresh-boutique-joueurs', { boutiqueOrgaFichesEnVente, prixFichePourJoueur });
            io.emit('refresh-orga', { creditOrganisateur, fichesDisponibles: fichesAcheteesOrga.length, cataloguePrixFiche, stockAdminCount: stockFichesAdmin.length, boutiqueOrgaFichesEnVente, prixFichePourJoueur });
        } else {
            socket.emit('orga-notification', "❌ Vous n'avez pas assez de fiches dans votre réserve pour en vendre autant.");
        }
    });

    // 👤 JOUEUR ACHÈTE UNE FICHE À L'ORGANISATEUR
    socket.on('player-buy-fiches-from-orga', ({ code, qte }) => {
        if (!players[code]) return;
        if (!fichesMatchOuvertes) return socket.emit('notification', "🔒 Les ventes de fiches sont clôturées pour ce match.");
        if (boutiqueOrgaFichesEnVente < qte) return socket.emit('notification', "❌ Plus assez de fiches disponibles dans la boutique de l'animateur.");

        const coutTotal = qte * prixFichePourJoueur;
        if (players[code].pions >= coutTotal) {
            // Débit du joueur
            players[code].pions -= coutTotal;
            players[code].totalPionsDepenses += coutTotal;

            // Retrait des fiches de la boutique et de la réserve orga
            boutiqueOrgaFichesEnVente -= qte;
            const fichesLivreels = fichesAcheteesOrga.splice(0, qte);

            // Attribution au joueur
            players[code].nombreFiches += qte;
            const debut = players[code].nombreFiches - qte + 1;
            players[code].seriesCartons = `Série ${fichesLivreels[0].serieNom} (#${fichesLivreels[0].numero})`;

            players[code].historiquePions.unshift({ 
                date: "Achat Boutique", 
                description: `Achat de ${qte} fiches personnalisées à l'animateur`, 
                montant: `-${coutTotal}` 
            });

            socket.emit('update-dashboard', players[code]);
            socket.emit('notification', `🎉 Fiches obtenues auprès de l'organisateur !`);
            
            // Mise à jour globale
            io.emit('refresh-boutique-joueurs', { boutiqueOrgaFichesEnVente, prixFichePourJoueur });
            io.emit('refresh-orga', { creditOrganisateur, fichesDisponibles: fichesAcheteesOrga.length, cataloguePrixFiche, stockAdminCount: stockFichesAdmin.length, boutiqueOrgaFichesEnVente, prixFichePourJoueur });
            io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations, stockFichesCount: stockFichesAdmin.length, creditOrganisateur });
        } else {
            socket.emit('notification', `❌ Pions insuffisants. Il vous faut ${coutTotal} pions.`);
        }
    });

    // CONNEXION ET AUTRES PROTOCOLES
    socket.on('player-login', (code) => {
        const codeVerif = code.trim().toUpperCase();
        if (players[codeVerif]) {
            players[codeVerif].online = true; players[codeVerif].socketId = socket.id;
            socket.emit('login-success-dashboard', { player: players[codeVerif], tournoiActuel: {}, liveHistory: drawnNumbers });
            socket.emit('refresh-boutique-joueurs', { boutiqueOrgaFichesEnVente, prixFichePourJoueur });
        } else { socket.emit('login-error'); }
    });

    socket.on('player-request-registration', ({ nom, tel }) => {
        const telNettoye = tel.trim().replace(/[^0-9]/g, "");
        if (Object.values(players).find(p => p.tel === telNettoye)) return socket.emit('registration-status', { status: 'already_active' });
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
                historiquePions: [{ date: "Système", description: "Accès autorisé", montant: "+0" }],
                online: false, socketId: null, grille: Array.from({length: 25}, () => Math.floor(Math.random() * 75) + 1)
            };
            io.to(reg.socketId).emit('registration-approved', { code: codeSecurise });
            pendingRegistrations.splice(idx, 1);
            io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations, stockFichesCount: stockFichesAdmin.length, creditOrganisateur });
        }
    });

    socket.on('player-order', ({ code, type, qte }) => {
        if (!players[code]) return;
        orders.push({ id: Date.now(), code, nom: players[code].nom, type: type, qte: parseInt(qte) });
        io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations, stockFichesCount: stockFichesAdmin.length, creditOrganisateur });
    });

    socket.on('admin-validate-order', (idOrder) => {
        const idx = orders.findIndex(o => o.id === idOrder);
        if (idx !== -1) {
            const o = orders[idx];
            if (players[o.code]) {
                players[o.code].pions += o.qte; players[o.code].totalPionsRecus += o.qte;
                players[o.code].historiquePions.unshift({ date: "Caisse", description: "Approvisionnement approuvé", montant: `+${o.qte}` });
                if (players[o.code].socketId) io.to(players[o.code].socketId).emit('update-dashboard', players[o.code]);
            }
            orders.splice(idx, 1);
            io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations, stockFichesCount: stockFichesAdmin.length, creditOrganisateur });
        }
    });

    socket.on('player-announce-bingo', (data) => { io.emit('admin-receive-bingo', data); });
    socket.on('admin-toggle-ventes', (statut) => { fichesMatchOuvertes = statut; io.emit('refresh-orga', { creditOrganisateur, fichesDisponibles: fichesAcheteesOrga.length, cataloguePrixFiche, stockAdminCount: stockFichesAdmin.length, boutiqueOrgaFichesEnVente, prixFichePourJoueur }); });
    socket.on('admin-request-carton', (code) => { if (players[code]) socket.emit('admin-view-carton', { nom: players[code].nom, code: code, grille: players[code].grille, history: drawnNumbers }); });
    socket.on('admin-direct-reward', ({ code, montant }) => {
        if (players[code]) {
            const m = parseInt(montant); players[code].pions += m; players[code].totalPionsRecus += m;
            players[code].historiquePions.unshift({ date: "Gain", description: "Gain Bingo", montant: `+${m}` });
            if (players[code].socketId) io.to(players[code].socketId).emit('update-dashboard', players[code]);
            io.emit('refresh-admin', { players: Object.values(players), history: drawnNumbers, orders, pendingRegistrations, stockFichesCount: stockFichesAdmin.length, creditOrganisateur });
        }
    });

    socket.on('admin-reset-all', () => {
        players = {}; pool = Array.from({length: 75}, (_, i) => i + 1); drawnNumbers = []; orders = []; stockFichesAdmin = []; fichesAcheteesOrga = []; creditOrganisateur = 0; boutiqueOrgaFichesEnVente = 0; pendingRegistrations = [];
        io.emit('game-reset');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Serveur BingoHome Prêt`); });
