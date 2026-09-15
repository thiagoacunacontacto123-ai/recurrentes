// Mock de firebase-admin/app (initAdmin de _lib/firebase.js).
const apps = [];
export function initializeApp(options) { const a = { name: "[DEFAULT]", options }; apps.push(a); return a; }
export function getApps() { return apps; }
export function cert(x) { return x; }
