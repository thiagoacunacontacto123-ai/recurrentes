// Importa (con el firebase-admin REAL, sin conectarse) cada módulo api tocado por
// esta rama. Uso: node tests/reliability/import-check.mjs
const R = new URL("../../", import.meta.url);
const mods = [
  "api/cron.js", "api/mp/webhook.js", "api/charges.js", "api/stats.js",
  "api/_lib/health.js", "api/_lib/log.js", "api/_lib/fulfillretry.js",
  "api/_lib/shopify.js", "api/_lib/email.js",
];
let fail = 0;
for (const m of mods) {
  try { await import(new URL(m, R).href); console.log("ok  ", m); }
  catch (e) { fail++; console.error("FAIL", m, e.message); }
}
process.exit(fail ? 1 : 0);
