// scripts/cleanup-all.mjs — Borra TODO de Recurrentes:
//   - plans (suscripciones que armaste para productos)
//   - subscribers (clientes con sub activa/pasada)
//   - charges (cobros registrados)
//
// NO borra:
//   - merchant doc (settings del widget, tokens Shopify/MP — siguen ahí)
//   - preapproval_plans en MP (eso queda en la cuenta MP, hay que cancelarlos
//     desde mercadopago.com.ar/subscriptions)
//
// Uso:  node scripts/cleanup-all.mjs
import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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
const merchants = await db.collection("merchants").get();
console.log(`🔍 ${merchants.size} merchants encontrados\n`);

let totalPlans = 0, totalSubs = 0, totalCharges = 0;

for (const m of merchants.docs) {
  console.log(`📦 Merchant ${m.id} (${m.data().email || "sin email"})`);

  const plans = await db.collection("merchants").doc(m.id).collection("plans").get();
  for (const p of plans.docs) { await p.ref.delete(); totalPlans++; }
  console.log(`   ✕ ${plans.size} plans borrados`);

  const subs = await db.collection("merchants").doc(m.id).collection("subscribers").get();
  for (const s of subs.docs) { await s.ref.delete(); totalSubs++; }
  console.log(`   ✕ ${subs.size} subscribers borrados`);

  const charges = await db.collection("merchants").doc(m.id).collection("charges").get();
  for (const c of charges.docs) { await c.ref.delete(); totalCharges++; }
  console.log(`   ✕ ${charges.size} charges borrados`);
}

console.log(`\n✅ Total: ${totalPlans} plans + ${totalSubs} subscribers + ${totalCharges} charges borrados.`);
console.log("\n⚠️  Recordá cancelar las subs activas en MP también:");
console.log("   https://www.mercadopago.com.ar/subscriptions");
process.exit(0);
