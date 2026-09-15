// Firebase client (web SDK) — solo para auth y reads del admin.
// Las escrituras importantes pasan por /api/* con el Admin SDK.
import { initializeApp, getApps } from "firebase/app";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Login con Google en el dominio propio: el handler de Firebase (/__/auth/*) se sirve
// por un proxy de Vercel (vercel.json), así Google muestra "recurrentesapp.com" y no
// recurrentes-16fbd.firebaseapp.com. En local (vite, sin proxy) sigue el authDomain del env.
// Requiere https://<host>/__/auth/handler en las URIs de redirección del cliente OAuth de Google.
const PROXIED_AUTH_HOST = /(^|\.)recurrentesapp\.com$|^recurrentess\.vercel\.app$/;
const host = typeof window !== "undefined" ? window.location.hostname : "";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: PROXIED_AUTH_HOST.test(host) ? window.location.host : import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// HMR seguro: evitar reinicialización en dev.
export const app = getApps().length ? getApps()[0] : initializeApp(config);
export const auth = getAuth(app);
export const db = getFirestore(app);
export { onAuthStateChanged };
