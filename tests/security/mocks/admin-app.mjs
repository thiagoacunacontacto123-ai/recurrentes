// Mock de firebase-admin/app.
const apps = [];
export function initializeApp(opts) { const a = { name: "[DEFAULT]", options: opts }; apps.push(a); return a; }
export function getApps() { return apps; }
export function cert(x) { return x; }
