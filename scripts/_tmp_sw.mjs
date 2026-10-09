import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
const env = {};
for (const line of readFileSync(".env.local","utf-8").split("\n")) { const i=line.indexOf("="); if(i<0||line.trim().startsWith("#")) continue; let v=line.slice(i+1).trim(); if(v.startsWith('"')&&v.endsWith('"')) v=v.slice(1,-1); env[line.slice(0,i).trim()]=v; }
initializeApp({ credential: cert({ projectId: env.FIREBASE_PROJECT_ID, clientEmail: env.FIREBASE_CLIENT_EMAIL, privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g,"\n") }) });
const db = getFirestore();
const hb = (await db.doc("system/cron_heartbeat").get()).data() || {};
console.log("stock-watch:", JSON.stringify(hb["stock-watch"] || null));
const pol = await db.collection("merchants").where("stock_policy.on_missing","==","pause").get();
console.log("tiendas con 'No cobrar' explícito:", pol.docs.map(d=>d.data().store_name||d.id));
