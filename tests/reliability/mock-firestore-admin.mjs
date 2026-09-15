// Mock mínimo de firebase-admin/firestore para tests locales (sin tocar la base real).
export const FieldValue = {
  increment: (n) => ({ __op: "inc", n }),
  delete: () => ({ __op: "del" }),
  serverTimestamp: () => new Date().toISOString(),
  arrayUnion: (...a) => ({ __op: "union", a }),
  arrayRemove: (...a) => ({ __op: "remove", a }),
};
export const Timestamp = { now: () => ({ toDate: () => new Date() }), fromMillis: (ms) => ({ toMillis: () => ms }) };
export function getFirestore() { throw new Error("no usar en tests"); }
