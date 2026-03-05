// Configurazione Firebase
const firebaseConfig = {
    apiKey: "AIzaSyAf-sM9QeA3nyFyOTIcP1kjq8yp1dHaBmM",
    authDomain: "gestione-mezzi-18343.firebaseapp.com",
    projectId: "gestione-mezzi-18343",
    storageBucket: "gestione-mezzi-18343.firebasestorage.app",
    messagingSenderId: "448747673570",
    appId: "1:448747673570:web:c2d4386c41c005a9784bbb"
};

// Inizializza Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();
