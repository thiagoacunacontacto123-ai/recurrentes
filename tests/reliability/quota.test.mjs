// 9-oct-2026: Google frenó Firestore en la cuota gratis (facturación en mora) y la
// plataforma quedó caída sin aviso. Lo que protege: el error se reconoce, el heartbeat
// de los crons lo escala al admin, y los crons leen menos (payment_failed cada 15 min,
// pendientes cada 10) para no vivir al borde de la franja gratis.
import "../helpers/register.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { isQuotaError } from "../../api/_lib/quotaGuard.js";
import { ADMIN_EVENT_LABEL } from "../../api/_lib/adminAlerts.js";
import { createWorld, loadApi, subscriber } from "../helpers/world.mjs";
import { seedDoc } from "../helpers/fake-firestore.mjs";

test("isQuotaError reconoce el 8 RESOURCE_EXHAUSTED de Firestore y nada más", () => {
  assert.equal(isQuotaError(Object.assign(new Error("8 RESOURCE_EXHAUSTED: Quota exceeded."), { code: 8 })), true);
  assert.equal(isQuotaError(new Error("Quota exceeded.")), true);
  assert.equal(isQuotaError(new Error("5 NOT_FOUND")), false);
  assert.equal(isQuotaError(null), false);
  assert.ok(ADMIN_EVENT_LABEL.firestore_quota, "hay evento de aviso al admin");
});

test("collectDueGlobal: las rechazadas solo cada 15 min y los pendientes cada 10 (menos lecturas)", async () => {
  createWorld();
  const { collectDueGlobal } = await loadApi("api/cron.js");
  const ago = (ms) => new Date(Date.now() - ms).toISOString();
  seedDoc("merchants/lumina_uid_test/subscribers/s_fail", subscriber({ status: "payment_failed", updated_at: ago(3600e3) }));
  seedDoc("merchants/lumina_uid_test/subscribers/s_pend", subscriber({ status: "pending", updated_at: ago(3600e3), created_at: ago(3600e3) }));
  const m5 = await collectDueGlobal(Date.now(), 5);
  assert.equal(m5.failed.length, 0); assert.equal(m5.pendings.length, 0);
  const m10 = await collectDueGlobal(Date.now(), 10);
  assert.equal(m10.failed.length, 0); assert.equal(m10.pendings.length, 1);
  const m0 = await collectDueGlobal(Date.now(), 0);
  assert.equal(m0.failed.length, 1); assert.equal(m0.pendings.length, 1);
});
