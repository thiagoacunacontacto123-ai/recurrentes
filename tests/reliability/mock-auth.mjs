// Mock de firebase-admin/auth: los tests registran tokens válidos en globalThis.__ID_TOKENS
// ({ token: { uid, email, email_verified } }). Cualquier otro token → inválido.
export function getAuth() {
  return {
    verifyIdToken: async (t) => {
      const d = (globalThis.__ID_TOKENS || {})[t];
      if (!d) { const e = new Error("auth/argument-error: token inválido"); e.code = "auth/argument-error"; throw e; }
      return d;
    },
  };
}
