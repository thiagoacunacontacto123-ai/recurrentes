import fs from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^"|"$/g,""); }
initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: (process.env.FIREBASE_PRIVATE_KEY||"").replace(/\\n/g,"\n") })});
const d = await getFirestore().collection("merchants").doc("y7dPia7O1bOgV75v1JkpmoUUyLu1").collection("subscribers").doc("XB1qc86mATRgNOXo9VUp").get();
const x = d.data();
console.log("URL=https://www.recurrentesapp.com/#/checkout-success?sub=XB1qc86mATRgNOXo9VUp&token=" + encodeURIComponent(x.portal_token || ""));
process.exit(0);
