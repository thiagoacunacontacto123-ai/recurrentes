// Reemplazo de `firebase-admin/firestore` en los tests (lo inyecta hooks.mjs).
// Exporta lo que importa el código de api/ (FieldValue, Timestamp) + getFirestore
// (lo usa el firebase.js real, que el mock re-exporta) + FieldPath.
import { fakeDb, FieldValue, Timestamp, FieldPath } from "./fake-firestore.mjs";

export { FieldValue, Timestamp, FieldPath };
export function getFirestore() { return fakeDb; }
export function initializeFirestore() { return fakeDb; }
