// Mock de firebase-admin/firestore: getFirestore() devuelve la base en memoria.
import { _db } from "./store.mjs";
export function getFirestore() { return _db; }
export const FieldValue = {
  increment: (n) => ({ __op: "inc", n }),
  delete: () => ({ __op: "del" }),
  serverTimestamp: () => new Date().toISOString(),
  arrayUnion: (...a) => ({ __op: "union", a }),
  arrayRemove: (...a) => ({ __op: "remove", a }),
};
export const Timestamp = {
  now: () => ({ toDate: () => new Date() }),
  fromMillis: (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) }),
};
