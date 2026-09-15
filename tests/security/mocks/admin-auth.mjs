// Mock de firebase-admin/auth. Tokens de test: "tok:<uid>" o "tok:<uid>:<email>".
export function getAuth() {
  return {
    async verifyIdToken(t) {
      const m = /^tok:([^:]+)(?::(.+))?$/.exec(String(t || ""));
      if (!m) throw new Error("invalid token");
      return { uid: m[1], email: m[2] || `${m[1]}@test.com`, email_verified: true };
    },
    async getUserByEmail() { throw new Error("no users in tests"); },
  };
}
