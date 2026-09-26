// Mock de firebase-admin/auth: tokens y usuarios en memoria (el test los carga).
export const __tokens = new Map(); // idToken -> decoded { uid, email, email_verified }
export const __users = new Map();  // uid -> UserRecord mínimo
export function getAuth() {
  return {
    verifyIdToken: async (t) => { const d = __tokens.get(t); if (!d) throw new Error("token inválido"); return { ...d }; },
    getUsers: async (ids) => ({ users: ids.map(i => __users.get(i.uid)).filter(Boolean), notFound: ids.filter(i => !__users.has(i.uid)) }),
    getUser: async (uid) => { const u = __users.get(uid); if (!u) { const e = new Error("user not found"); e.code = "auth/user-not-found"; throw e; } return u; },
    getUserByEmail: async (email) => { for (const u of __users.values()) if (u.email === email) return u; const e = new Error("user not found"); e.code = "auth/user-not-found"; throw e; },
    // Alta de una cuenta desde el Admin (pedido de demo): SIN contraseña.
    createUser: async ({ email, emailVerified = false, displayName = null, password = undefined }) => {
      if (password !== undefined) throw new Error("no se crea una cuenta con contraseña puesta por nosotros");
      for (const u of __users.values()) if (u.email === email) { const e = new Error("email exists"); e.code = "auth/email-already-exists"; throw e; }
      const uid = `u_${__users.size + 1}_${String(email).replace(/[^a-z0-9]/gi, "").slice(0, 8)}`;
      const u = { uid, email, emailVerified, displayName };
      __users.set(uid, u);
      return u;
    },
    generatePasswordResetLink: async (email, opts = {}) => `https://reset.test/?email=${encodeURIComponent(email)}&continue=${encodeURIComponent(opts.url || "")}`,
  };
}
