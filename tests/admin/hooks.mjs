// Loader: reemplaza firebase-admin (app / auth / firestore) por mocks en memoria.
// _lib/firebase.js se carga REAL (así se prueba requireMerchant / requireAdmin de verdad).
const here = (f) => new URL(f, import.meta.url).href;
const MOCKS = {
  "firebase-admin/firestore": here("./mock-firestore.mjs"),
  "firebase-admin/auth": here("./mock-auth.mjs"),
  "firebase-admin/app": here("./mock-app.mjs"),
};
export async function resolve(spec, ctx, next) {
  if (MOCKS[spec]) return { url: MOCKS[spec], shortCircuit: true };
  return next(spec, ctx);
}
