
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*"
    }
});

app.use(express.static(path.join(__dirname, "public")));

app.use(express.json());

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


const multer = require("multer");
const fs = require("fs");
const PDFDocument = require("pdfkit");


// =========================
// IMPORT DES CARTES BINGO PDF
// =========================

const uploadFolder = path.join(__dirname, "public", "uploads");

// Créer le dossier uploads s'il n'existe pas
if (!fs.existsSync(uploadFolder)) {
    fs.mkdirSync(uploadFolder, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadFolder);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + "-" + file.originalname);
    }
});

const upload = multer({ storage: storage });

let fichiersPDFBingo = [];

let cartonsGeneres = [];


const dossierBingo = path.join(__dirname, "public/uploads/bingo");

const themesBingo = [
    "classique",
    "diamond",
    "tiare",
    "lagon",
    "perle-noire",
    "cerf-volant"
];

themesBingo.forEach(theme => {

    const dossierTheme = path.join(dossierBingo, theme);

    if (!fs.existsSync(dossierTheme)) {
        fs.mkdirSync(dossierTheme, { recursive: true });
    }

});


// Route pour recevoir le PDF Bingo
app.post("/upload-pdf-bingo", upload.single("pdf"), (req, res) => {

    if (!req.file) {
        return res.status(400).send("Aucun fichier reçu");
    }

    
fichiersPDFBingo.push({
    nom: req.file.originalname,
    fichier: req.file.filename,
    date: new Date()
});

console.log("PDF reçu :", req.file.filename);

broadcastRefresh();


res.json({
    message: "PDF importé avec succès",
    fichier: req.file.filename
});


});


// =========================
// GENERATION CARTONS BINGO
// =========================




app.post("/generer-cartons-bingo", (req, res) => {

    const theme = req.body.theme || "classique";
    const nombre = Number(req.body.nombre) || 1;

    const dossier = path.join(
        __dirname,
        "public/uploads/bingo",
        theme
    );

    if (!fs.existsSync(dossier)) {
        fs.mkdirSync(dossier, { recursive: true });
    }


    for (let i = 1; i <= nombre; i++) {

        const nomFichier =
        `${theme.toUpperCase()}_${Date.now()}_${i}.pdf`;

        const chemin = path.join(dossier, nomFichier);


        const doc = new PDFDocument();

        doc.pipe(fs.createWriteStream(chemin));


        doc.fontSize(22)
        .text("🌺 PA'INA 987 BINGO", {
            align:"center"
        });


        doc.moveDown();


        doc.fontSize(16)
        .text(theme.toUpperCase(), {
            align:"center"
        });


        doc.moveDown();


        const lettres = ["B","I","N","G","O"];

        lettres.forEach((lettre, index)=>{

            doc.text(
                lettre + "     ",
                100 + index*80,
                180
            );

        });


        let y = 220;

        for(let ligne=0; ligne<5; ligne++){

            let texte = "";

            for(let colonne=0; colonne<5; colonne++){

                const numero =
                Math.floor(Math.random()*75)+1;

                texte += numero + "     ";

            }

            doc.text(
                texte,
                80,
                y
            );

            y += 50;
        }


                doc.end();

        cartonsGeneres.push({
            nom: nomFichier,
            theme: theme,
            date: new Date()
        });

    }


    res.json({
        message: `${nombre} carton(s) créé(s) pour ${theme}`
    });

});



// =========================
// DONNÉES DU JEU
// =========================


let players = {};

let pendingRegistrations = [];

let pool = Array.from(
    { length: 75 },
    (_, i) => i + 1
);

let drawnNumbers = [];

let orders = [];

let historiqueVentes = [];

let venteActive = false;

let jeuActuel = {
    titre: "EN ATTENTE DU JEU",
    prix: 100,
    orga: "ADMIN / ORGA",
    desc: "1 boule pour 1 boule"
};


// =========================
// SYNCHRONISATION ADMIN / ORGA
// =========================

function broadcastRefresh() {

    const playersArray = Object.values(players);


    io.emit("refresh-admin", {

        players: playersArray,

        history: drawnNumbers,

        orders: orders,

        historiqueVentes: historiqueVentes,

        pendingRegistrations: pendingRegistrations,

        pdfBingo: fichiersPDFBingo,

        stockFichesCount: 0,
        creditOrganisateur: 0

    });


    io.emit("refresh-orga", {

        playersList: playersArray,

        orders: orders,

        historiqueVentes: historiqueVentes

    });

}



// =========================
// CONNEXION SOCKET
// =========================

io.on("connection", (socket) => {


    console.log("Utilisateur connecté :", socket.id);



    socket.on("admin-init", () => {

        broadcastRefresh();

    });



    socket.on("orga-init", () => {

        broadcastRefresh();

    });

    // =========================
    // DEMANDE DE CRÉATION DE CODE JOUEUR
    // =========================

    socket.on("player-request-registration", ({ nom, tel }) => {

        const nomClean = (nom || "").trim();
        const telClean = (tel || "").trim();


        if (!nomClean || !telClean) return;


        const demande = {

            id: Date.now(),

            nom: nomClean,

            tel: telClean,

            socketId: socket.id,

            statut: "en attente"

        };


        pendingRegistrations.push(demande);


        io.emit(
            "notification-staff",
            `📝 Nouvelle demande de code : ${nomClean}`
        );


        broadcastRefresh();

    });



    // =========================
    // VALIDATION ADMIN DU CODE
    // =========================

    socket.on("admin-approve-registration", (id) => {


        const index = pendingRegistrations.findIndex(
            r => r.id === id
        );


        if (index === -1) return;



        const demande = pendingRegistrations[index];



        let code;


        do {

            code = `BH-${Math.floor(1000 + Math.random() * 9000)}`;

        } while (players[code]);



        players[code] = {

            nom: demande.nom,

            tel: demande.tel,

            code: code,

            pions: 0,

            nombreFiches: 0,

            seriesCartons: "",

            pdfUrl: null,

            pagesInfo: "",

            online: false,

            socketId: null

        };



        io.to(demande.socketId).emit(
            "registration-approved",
            {
                code: code
            }
        );



        socket.emit(
            "admin-code-generated-display",
            {
                nom: demande.nom,

                tel: demande.tel,

                code: code
            }
        );



        pendingRegistrations.splice(index, 1);



        broadcastRefresh();


    });




    // =========================
    // CONNEXION JOUEUR
    // =========================

    socket.on("player-login", (code) => {


        if (!code) {

            socket.emit(
                "login-error",
                "❌ Saisis ton code"
            );

            return;

        }



        const codeClean = code
            .trim()
            .toUpperCase();



        if (players[codeClean]) {


            players[codeClean].online = true;

            players[codeClean].socketId = socket.id;



            socket.emit(
                "login-success-dashboard",
                {
                    player: players[codeClean],

                    liveHistory: drawnNumbers
                }
            );



            socket.emit(
                "sync-vente-status",
                {
                    active: venteActive,

                    jeu: jeuActuel
                }
            );



            broadcastRefresh();



        } else {


            socket.emit(
                "login-error",
                "❌ Code joueur inexistant"
            );


        }


    });


    // =========================
    // DEMANDE DE PIONS
    // =========================

    socket.on("player-request-pions", ({ code, qte }) => {

        const codeClean = (code || "")
            .trim()
            .toUpperCase();


        const quantite = Number(qte) || 0;


        if (players[codeClean] && quantite > 0) {


            const demande = {

                id: Date.now(),

                code: codeClean,

                nom: players[codeClean].nom,

                qte: quantite,

                heure: new Date()
                    .toLocaleTimeString("fr-FR")

            };


            orders.unshift(demande);


            io.emit(
                "notification-staff",
                `🪙 ${demande.nom} demande ${quantite} pions`
            );


            broadcastRefresh();

        }

    });





    // =========================
    // VALIDATION DES PIONS
    // =========================

    socket.on("admin-validate-order", (idOrder) => {


        const index = orders.findIndex(
            o => o.id === idOrder
        );


        if (index === -1) return;



        const commande = orders[index];


        if (players[commande.code]) {


            players[commande.code].pions += Number(
                commande.qte
            );


            if(players[commande.code].socketId){


                io.to(players[commande.code].socketId)
                .emit(
                    "update-dashboard",
                    players[commande.code]
                );


                io.to(players[commande.code].socketId)
                .emit(
                    "notification",
                    `🎁 +${commande.qte} pions ajoutés`
                );

            }


        }



        orders.splice(index,1);


        broadcastRefresh();


    });





    // =========================
    // LIVRAISON PDF CARTONS
    // =========================

    socket.on(
        "orga-deliver-pdf",
        ({code, serie, fichierUrl, pageDebut, pageFin}) => {


        const codeClean = code
        .trim()
        .toUpperCase();



        if(players[codeClean]){


            players[codeClean].pdfUrl = fichierUrl;

            players[codeClean].seriesCartons = serie;


            players[codeClean].pagesInfo =
            pageDebut === pageFin
            ? `Page ${pageDebut}`
            : `Pages ${pageDebut} à ${pageFin}`;



            if(players[codeClean].socketId){

                io.to(players[codeClean].socketId)
                .emit(
                    "update-dashboard",
                    players[codeClean]
                );

            }


            broadcastRefresh();

        }

    });





    // =========================
    // TIRAGE BINGO
    // =========================

    socket.on("admin-draw", () => {


        if(pool.length === 0) return;



        const index = Math.floor(
            Math.random() * pool.length
        );


        const numero = pool.splice(index,1)[0];


        drawnNumbers.push(numero);



        io.emit(
            "new-ball",
            {
                actuelle: numero,

                historique: drawnNumbers
            }
        );


    });





    // =========================
    // BINGO ANNONCÉ
    // =========================

    socket.on(
        "player-announce-bingo",
        (data)=>{

            io.emit(
                "admin-receive-bingo",
                data
            );

        }
    );





    // =========================
    // MESSAGE ADMIN
    // =========================

    socket.on(
        "admin-send-flash",
        (message)=>{

            io.emit(
                "notification",
                message
            );

        }
    );





    // =========================
    // RESET JEU
    // =========================

    socket.on("admin-reset-all", ()=>{


        players = {};

        pendingRegistrations = [];

        pool = Array.from(
            {length:75},
            (_,i)=>i+1
        );

        drawnNumbers = [];

        orders = [];

        historiqueVentes = [];

        venteActive = false;



        io.emit(
            "game-reset"
        );


        broadcastRefresh();


    });



    socket.on("disconnect", ()=>{


        Object.values(players).forEach(player=>{


            if(player.socketId === socket.id){

                player.online = false;

                player.socketId = null;

            }


        });


        broadcastRefresh();


    });


});





// =========================
// LANCEMENT SERVEUR
// =========================

const PORT = process.env.PORT || 3000;


server.listen(PORT, ()=>{

    console.log(
        `🎱🌺🥥 PA'INA 987 🥥🌺 serveur actif sur le port ${PORT}`
    );

});
