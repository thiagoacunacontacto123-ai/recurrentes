// scripts/cleanup-subs.mjs — Borra TODOS los subscribers + charges del/los
// merchants que existan en Firestore. Útil para limpiar datos de prueba
// antes de un test real.
//
// Uso:  node scripts/cleanup-subs.mjs
//
// Lee las credenciales de Firebase Admin desde .env.local (no requiere npm
// install de dotenv — parsea el archivo a mano).
import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Parser manual de .env.local
const env = {};
try {
  const raw = readFileSync(".env.local", "utf-8");
  for (const line of raw.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    env[key] = val;
  }
} catch (e) {
  console.error("✕ No pude leer .env.local. Corré el script desde ~/Downloads/recurrentes/.");
  process.exit(1);
}

if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
  console.error("✕ Faltan FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL o FIREBASE_PRIVATE_KEY en .env.local");
  process.exit(1);
}

initializeApp({
  credential: cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});

const db = getFirestore();

console.log("🔍 Buscando merchants…");
const merchants = await db.collection("merchants").get();
console.log(`   Encontrados: ${merchants.size}`);
console.log("");

let totalSubs = 0, totalCharges = 0;

for (const m of merchants.docs) {
  const md = m.data();
  console.log(`📦 Merchant ${m.id} (${md.email || "sin email"})`);

  // Borrar subscribers
  const subs = await db.collection("merchants").doc(m.id).collection("subscribers").get();
  for (const s of subs.docs) {
    await s.ref.delete();
    totalSubs += 1;
  }
  console.log(`   ✕ ${subs.size} subscribers borrados`);

  // Borrar charges
  const charges = await db.collection("merchants").doc(m.id).collection("charges").get();
  for (const c of charges.docs) {
    await c.ref.delete();
    totalCharges += 1;
  }
  console.log(`   ✕ ${charges.size} charges borrados`);
}

console.log("");
console.log(`✅ Listo. Total: ${totalSubs} subscribers + ${totalCharges} charges borrados.`);
process.exit(0);
