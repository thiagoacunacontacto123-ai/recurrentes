// Firebase Admin singleton — reusado entre invocaciones de la misma instancia
// serverless de Vercel. Inicializa con credentials del env (FIREBASE_*).
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

let app;
export function initAdmin() {
  if (app || getApps().length) {
    app = getApps()[0] || app;
    return app;
  }
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // En Vercel el env multilínea viene con \n literales, hay que reemplazar.
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Faltan credenciales FIREBASE_* en env");
  }
  app = initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
  return app;
}

export function db() {
  initAdmin();
  return getFirestore();
}

// Verifica el Bearer token del header Authorization y devuelve el uid.
// Tira 401 si falta o es inválido — handlers deben llamar requireAuth(req,res)
// y usar el uid para scopear todas las queries de Firestore.
export async function requireAuth(req, res) {
  initAdmin();
  const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!auth) {
    res.status(401).json({ error: "Falta token de auth" });
    return null;
  }
  try {
    const decoded = await getAuth().verifyIdToken(auth);
    return decoded.uid;
  } catch (e) {
    res.status(401).json({ error: "Token inválido" });
    return null;
  }
}

// Devuelve el doc del merchant del uid logueado, creándolo si no existe.
// Estructura: merchants/{uid} = { email, displayName, plan, created_at, ... }
export async function getOrCreateMerchant(uid, email) {
  const ref = db().collection("merchants").doc(uid);
  const snap = await ref.get();
  if (snap.exists) return { id: uid, ...snap.data() };
  const data = {
    email: email || null,
    plan: "free",
    created_at: new Date().toISOString(),
  };
  await ref.set(data);
  return { id: uid, ...data };
}
