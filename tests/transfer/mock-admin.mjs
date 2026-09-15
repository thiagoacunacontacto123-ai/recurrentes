// Mocks de firebase-admin/app y firebase-admin/auth para tests locales.
// Los tokens de login se registran en globalThis.__authTokens (token → decoded).
const apps = [];
export function getApps() { return apps; }
export function initializeApp(opts) { const a = { name: "[DEFAULT]", options: opts }; apps.push(a); return a; }
export function cert(x) { return x; }

export function getAuth() {
  return {
    async verifyIdToken(tok) {
      const d = globalThis.__authTokens?.get(tok);
      if (!d) throw new Error("auth/argument-error");
      return { ...d };
    },
    async deleteUser() {},
  };
}
