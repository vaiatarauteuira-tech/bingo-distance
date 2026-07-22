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


const multer = require("multer");
const fs = require("fs");


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
