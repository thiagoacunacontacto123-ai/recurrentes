// Loader: reemplaza firebase.js del proyecto y firebase-admin/firestore por los mocks.
const MOCK_FB = new URL("./mock-firebase.mjs", import.meta.url).href;
const MOCK_FS = new URL("./mock-firestore-admin.mjs", import.meta.url).href;
export async function resolve(spec, ctx, next) {
  if (spec === "firebase-admin/firestore") return { url: MOCK_FS, shortCircuit: true };
  const r = await next(spec, ctx);
  if (r.url.endsWith("/api/_lib/firebase.js")) return { url: MOCK_FB, shortCircuit: true };
  return r;
}
