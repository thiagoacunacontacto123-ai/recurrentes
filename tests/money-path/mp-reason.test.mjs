// (k) El `reason` que viaja a Mercado Pago no puede pasar los 60 caracteres.
//
// 22-sept-2026, caso Wellfresh. Su producto se llama "Well Fresh™ | Gotas
// naturales para el mal aliento" (49 chars) y con el sufijo se iba a 64 al
// crear el plan y a 89 en el checkout. MP responde:
//   HTTP 400 {"message":"Reason has more than 60 characters"}
// Efecto: no se podía crear el plan NI suscribir a un solo cliente.
//
// Lo que protege: que el reason entre siempre, y que lo que se recorte sea el
// TÍTULO y nunca el "cada N días" (es lo que le dice al cliente que es
// recurrente, y es lo que ve en su resumen de MP).
import "../helpers/register.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mpReason, MP_REASON_MAX } from "../../api/_lib/mp.js";

const LARGO = "Well Fresh™ | Gotas naturales para el mal aliento";

test("(k) un título largo se recorta y el reason entra en 60", () => {
  const r = mpReason(LARGO, " — cada 30 días");
  assert.ok(r.length <= MP_REASON_MAX, `${r.length} chars: ${r}`);
  assert.match(r, / — cada 30 días$/, "el sufijo tiene que quedar entero");
  assert.match(r, /^Well Fresh/, "y se reconoce de qué producto es");
});

test("(k) el reason del checkout (con pack) también entra", () => {
  const r = mpReason(LARGO, " — LLEVE 3 WELLFRESH (×3) — cada 90 días");
  assert.ok(r.length <= MP_REASON_MAX, `${r.length} chars: ${r}`);
  assert.match(r, /cada 90 días$/);
});

test("(k) un título corto no se toca", () => {
  assert.equal(mpReason("Gotas", " — cada 30 días"), "Gotas — cada 30 días");
});

test("(k) nunca supera el límite, por largo que sea todo", () => {
  const casos = [
    ["A".repeat(300), " — cada 7 días"],
    [LARGO, " — " + "B".repeat(80) + " — cada 15 días"],
    ["", " — cada 30 días"],
    ["Sólo título sin sufijo", ""],
  ];
  for (const [t, suf] of casos) {
    const r = mpReason(t, suf);
    assert.ok(r.length <= MP_REASON_MAX, `${r.length} chars con ${JSON.stringify([t.slice(0, 20), suf])}`);
  }
});

test("(k) los dos endpoints que llaman a MP usan el helper", async () => {
  const fs = await import("node:fs");
  for (const f of ["api/plans.js", "api/checkout/init.js"]) {
    const src = fs.readFileSync(f, "utf8");
    assert.ok(/mpReason\(/.test(src), `${f} tiene que armar el reason con mpReason`);
    assert.ok(!/reason: `\$\{product_title\} —/.test(src), `${f} no puede volver al template suelto`);
  }
});
