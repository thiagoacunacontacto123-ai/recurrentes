// Setup común de TODOS los tests del camino del cobro. Cada archivo de test lo
// importa PRIMERO y después carga el código de api/ con import() dinámico.
//
//  1. Inyecta los mocks: api/_lib/firebase.js → mock-firebase.mjs y
//     firebase-admin/firestore → mock-firestore-admin.mjs (Firestore en memoria).
//  2. Pisa las variables de entorno con valores de prueba (nunca usa los reales
//     aunque tengas un .env cargado) y borra las credenciales.
//  3. Bloquea la red: cualquier fetch que un test no haya stubeado falla.
//  4. Silencia los console.* del código (RECURRENTES_TEST_VERBOSE=1 para verlos);
//     quedan en globalThis.__testLogs por si un test quiere mirarlos.
import * as nodeModule from "node:module";

const G = globalThis;
if (!G.__recurrentesTestSetup) {
  G.__recurrentesTestSetup = true;

  const MOCK_FB = new URL("./mock-firebase.mjs", import.meta.url).href;
  const MOCK_FS = new URL("./mock-firestore-admin.mjs", import.meta.url).href;
  if (typeof nodeModule.registerHooks === "function") {
    nodeModule.registerHooks({
      resolve(spec, ctx, next) {
        if (spec === "firebase-admin/firestore") return { url: MOCK_FS, shortCircuit: true };
        const r = next(spec, ctx);
        if (r.url.startsWith("file:") && r.url.endsWith("/api/_lib/firebase.js")) return { url: MOCK_FB, shortCircuit: true };
        return r;
      },
    });
  } else {
    nodeModule.register("./hooks-async.mjs", import.meta.url);
  }

  // Entorno de prueba (valores falsos, nombres reales).
  const TEST_ENV = {
    APP_BASE_URL: "https://www.recurrentesapp.com",
    RESEND_API_KEY: "re_test_dummy",
    EMAIL_FROM: "Recurrentes <hola@recurrentesapp.com>",
    PORTAL_SECRET: "test-portal-secret",
    MP_WEBHOOK_SECRET: "test-legacy-webhook-secret",
    NODE_ENV: "test",
  };
  const WIPE = [
    "VERCEL_ENV", "MP_WEBHOOK_SIGNING_SECRET", "FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY",
    "MP_APP_ID", "MP_CLIENT_SECRET", "MP_REDIRECT_URI", "SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "CRON_SECRET",
    "GOOGLE_APPLICATION_CREDENTIALS", "KLAVIYO_API_KEY", "META_CAPI_TOKEN",
  ];
  for (const k of WIPE) delete process.env[k];
  Object.assign(process.env, TEST_ENV);
  G.__TEST_ENV = TEST_ENV;

  // Red bloqueada hasta que el test instale su router (helpers/fetch-router.mjs).
  G.fetch = async (input) => {
    const url = typeof input === "string" ? input : input?.url || String(input);
    throw new TypeError(`fetch bloqueado en tests (no hay router instalado): ${url}`);
  };

  G.__testLogs = [];
  if (process.env.RECURRENTES_TEST_VERBOSE !== "1") {
    for (const level of ["log", "info", "warn", "error", "debug"]) {
      console[level] = (...args) => { G.__testLogs.push({ level, msg: args.map(a => (typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(" ") }); };
    }
  }
}
