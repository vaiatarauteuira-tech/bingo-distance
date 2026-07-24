// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" } // Pour autoriser les connexions depuis Railway
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// État de la partie en mémoire
let gameState = {
  orgaConnected: false,
  orgaName: "Organisateur",
  numerosTires: [],
  enPause: false, // Vrai si une alerte PAINA est en cours (écran rouge)
  modeBingo: 75 // 75 ou 90
};

// --- BASE DE DONNÉES CODES D'ACCÈS (Exemple) ---
const CODES_ACCES_VALIDES = {
  "FENUA2026": { nom: "Hiro", expire: "2026-12-31" },
  "ORGA987": { nom: "Moana", expire: "2026-10-15" }
};

// Route de vérification du code d'accès Organisateur
app.post('/api/login-orga', (req, res) => {
  const { code } = req.body;
  if (CODES_ACCES_VALIDES[code]) {
    return res.json({ 
      success: true, 
      nom: CODES_ACCES_VALIDES[code].nom 
    });
  }
  return res.status(401).json({ success: false, message: "Code d'accès invalide ou expiré." });
});

// --- RÈGLES DU REAL-TIME (SOCKET.IO) ---
io.on('connection', (socket) => {
  console.log(`🔌 Nouveau client connecté : ${socket.id}`);

  // Envoyer l'état actuel de la partie au nouveau connecté
  socket.emit('INIT_GAME_STATE', gameState);

  // 1. Connexion de l'Organisateur
  socket.on('ORGA_CONNECT', (orgaName) => {
    gameState.orgaName = orgaName;
    gameState.orgaConnected = true;
    io.emit('ORGA_STATUS_CHANGED', { connected: true, name: orgaName });
  });

  // 2. L'Organisateur tire une perle
  socket.on('TIRER_PERLE', () => {
    if (gameState.enPause) return; // Sécurité si écran rouge

    let maxNum = gameState.modeBingo;
    if (gameState.numerosTires.length >= maxNum) return;

    let num;
    do {
      num = Math.floor(Math.random() * maxNum) + 1;
    } while (gameState.numerosTires.includes(num));

    gameState.numerosTires.push(num);

    // Déterminer la lettre si mode 75
    let lettre = "";
    if (gameState.modeBingo === 75) {
      if (num <= 15) lettre = "B";
      else if (num <= 30) lettre = "I";
      else if (num <= 45) lettre = "N";
      else if (num <= 60) lettre = "G";
      else lettre = "O";
    }

    // Diffuser le tirage à TOUT LE MONDE (Joueurs + Orga + Admin)
    io.emit('NOUVELLE_PERLE', { numero: num, lettre: lettre, historique: gameState.numerosTires });
  });

  // 3. Un JOUEUR crie "PAINA !"
  socket.on('DECLENCHER_PAINA', (dataJoueur) => {
    gameState.enPause = true;

    // Écran fige en ROUGE pour tout le monde
    io.emit('ALERTE_PAINA_DEBUT', {
      joueur: dataJoueur.nom,
      telephone: dataJoueur.telephone,
      fiche: dataJoueur.fiche
    });
  });

  // 4. L'ORGANISATEUR VALIDE LE PAINA
  socket.on('VALIDER_PAINA', () => {
    gameState.enPause = false;
    // Diffuser le message officiel du gain
    io.emit('PAINA_RESULTAT', {
      status: "VALIDE",
      message: "UA PAINA HIA MEAMA MA"
    });
  });

  // 5. L'ORGANISATEUR REFUSE (MALAISE / ERREUR)
  socket.on('REFUSER_PAINA', () => {
    gameState.enPause = false;
    // Diffuser le message que le jeu reprend
    io.emit('PAINA_RESULTAT', {
      status: "MALAISE",
      message: "ÇA CONTINUE !"
    });
  });

  // 6. Basculer entre Bingo 75 et Bingo 90
  socket.on('CHANGER_MODE_BINGO', (mode) => {
    gameState.modeBingo = mode;
    gameState.numerosTires = [];
    io.emit('MODE_BINGO_CHANGE', { mode: mode });
  });
});

// IMPORTANT POUR RAILWAY : Utiliser process.env.PORT
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Serveur Fenua Bingo démarré sur le port ${PORT}`);
});
