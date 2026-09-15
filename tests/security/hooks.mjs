// Loader de tests: reemplaza firebase-admin/{app,auth,firestore} por mocks en
// memoria. El api/_lib/firebase.js REAL corre encima (requireMerchant,
// resolveMerchantAccess), así los tests de permisos prueban el código de verdad.
const here = (f) => new URL(f, import.meta.url).href;
const MAP = {
  "firebase-admin/app": here("./mocks/admin-app.mjs"),
  "firebase-admin/auth": here("./mocks/admin-auth.mjs"),
  "firebase-admin/firestore": here("./mocks/admin-firestore.mjs"),
};
export async function resolve(spec, ctx, next) {
  if (MAP[spec]) return { url: MAP[spec], shortCircuit: true };
  return next(spec, ctx);
}
