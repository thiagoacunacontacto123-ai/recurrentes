// Hooks de resolución para Node sin module.registerHooks (fallback de register.mjs,
// vía module.register). Misma lógica que la versión sincrónica.
const MOCK_FB = new URL("./mock-firebase.mjs", import.meta.url).href;
const MOCK_FS = new URL("./mock-firestore-admin.mjs", import.meta.url).href;

export async function resolve(spec, ctx, next) {
  if (spec === "firebase-admin/firestore") return { url: MOCK_FS, shortCircuit: true };
  const r = await next(spec, ctx);
  if (r.url.startsWith("file:") && r.url.endsWith("/api/_lib/firebase.js")) return { url: MOCK_FB, shortCircuit: true };
  return r;
}
