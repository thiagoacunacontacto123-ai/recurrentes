// Mock de firebase-admin/auth: tokens y usuarios en memoria (el test los carga).
export const __tokens = new Map(); // idToken -> decoded { uid, email, email_verified }
export const __users = new Map();  // uid -> UserRecord mínimo
export function getAuth() {
  return {
    verifyIdToken: async (t) => { const d = __tokens.get(t); if (!d) throw new Error("token inválido"); return { ...d }; },
    getUsers: async (ids) => ({ users: ids.map(i => __users.get(i.uid)).filter(Boolean), notFound: ids.filter(i => !__users.has(i.uid)) }),
    getUser: async (uid) => { const u = __users.get(uid); if (!u) { const e = new Error("user not found"); e.code = "auth/user-not-found"; throw e; } return u; },
    getUserByEmail: async (email) => { for (const u of __users.values()) if (u.email === email) return u; const e = new Error("user not found"); e.code = "auth/user-not-found"; throw e; },
  };
}
