// Loader: reemplaza firebase-admin (app / auth / firestore) por los mocks en memoria.
// El api/_lib/firebase.js REAL del proyecto se testea tal cual.
const FS = new URL("./mock-firestore.mjs", import.meta.url).href;
const ADMIN = new URL("./mock-admin.mjs", import.meta.url).href;
export async function resolve(spec, ctx, next) {
  if (spec === "firebase-admin/firestore") return { url: FS, shortCircuit: true };
  if (spec === "firebase-admin/app" || spec === "firebase-admin/auth") return { url: ADMIN, shortCircuit: true };
  return next(spec, ctx);
}
