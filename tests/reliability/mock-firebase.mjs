// Firestore en memoria (reemplaza api/_lib/firebase.js en los tests). Basado en el
// mock de los tests de flujos + select(), == null, transacciones SERIALIZADAS (como
// Firestore real) y un interruptor para simular "falta el índice compuesto".
const store = new Map();
export const __store = store;
let reads = 0;
export const __reads = () => reads;
export const __resetReads = () => { reads = 0; };
let autoN = 0;
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const getPath = (o, f) => f.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);
const setPath = (o, f, v) => { const p = f.split("."); let x = o; for (let i = 0; i < p.length - 1; i++) { x[p[i]] = x[p[i]] && typeof x[p[i]] === "object" ? x[p[i]] : {}; x = x[p[i]]; } x[p[p.length - 1]] = v; };

// Queries que "no tienen índice": predicado sobre (colPath, filters) → lanza FAILED_PRECONDITION.
let missingIndex = () => false;
export const __setMissingIndex = (fn) => { missingIndex = fn || (() => false); };

function applyVal(obj, key, v) {
  if (v && v.__op === "del") { delete obj[key]; return; }
  if (v && v.__op === "inc") { obj[key] = (Number(obj[key]) || 0) + v.n; return; }
  if (v && v.__op === "union") { obj[key] = [...new Set([...(obj[key] || []), ...v.a])]; return; }
  if (v && v.__op === "remove") { obj[key] = (obj[key] || []).filter(x => !v.a.includes(x)); return; }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    obj[key] = obj[key] && typeof obj[key] === "object" && !Array.isArray(obj[key]) ? obj[key] : {};
    for (const [k2, v2] of Object.entries(v)) applyVal(obj[key], k2, v2);
    return;
  }
  obj[key] = clone(v);
}
function applyUpdate(target, data) {
  for (const [k, v] of Object.entries(data)) {
    const parts = k.split(".");
    let o = target;
    for (let i = 0; i < parts.length - 1; i++) { o[parts[i]] = o[parts[i]] && typeof o[parts[i]] === "object" ? o[parts[i]] : {}; o = o[parts[i]]; }
    const last = parts[parts.length - 1];
    if (v && typeof v === "object" && !Array.isArray(v) && !v.__op) o[last] = {};
    applyVal(o, last, v);
  }
}
const snap = (ref, d) => ({ id: ref.id, ref, exists: d !== undefined, data: () => clone(d) });

class DocRef {
  constructor(path) { this.path = path; this.id = path.split("/").pop(); }
  collection(n) { return new ColRef(`${this.path}/${n}`); }
  async get() {
    if (globalThis.__FS_DOWN) { const e = new Error("14 UNAVAILABLE: no connection"); e.code = "UNAVAILABLE"; throw e; }
    reads++; return snap(this, store.get(this.path));
  }
  async set(data, opts = {}) {
    const cur = opts.merge ? (clone(store.get(this.path)) || {}) : {};
    for (const [k, v] of Object.entries(data)) applyVal(cur, k, v);
    store.set(this.path, cur);
  }
  async update(data) {
    const cur = store.get(this.path);
    if (!cur) { const e = new Error("5 NOT_FOUND"); e.code = 5; throw e; }
    applyUpdate(cur, data);
  }
  async create(data) {
    if (store.has(this.path)) { const e = new Error("6 ALREADY_EXISTS: Document already exists"); e.code = 6; throw e; }
    const cur = {};
    for (const [k, v] of Object.entries(data)) applyVal(cur, k, v);
    store.set(this.path, cur);
  }
  async delete() { store.delete(this.path); }
}

class Query {
  constructor(colPath, filters = [], order = null, lim = null, fields = null) { this.colPath = colPath; this.filters = filters; this.order = order; this.lim = lim; this.fields = fields; }
  where(f, op, v) { return new Query(this.colPath, [...this.filters, [f, op, v]], this.order, this.lim, this.fields); }
  orderBy(f, dir = "asc") { return new Query(this.colPath, this.filters, [f, dir], this.lim, this.fields); }
  limit(n) { return new Query(this.colPath, this.filters, this.order, n, this.fields); }
  select(...f) { return new Query(this.colPath, this.filters, this.order, this.lim, f); }
  _docs() {
    if (missingIndex(this.colPath, this.filters)) {
      const e = new Error("9 FAILED_PRECONDITION: The query requires an index."); e.code = 9; throw e;
    }
    const prefix = this.colPath + "/";
    let out = [];
    for (const [p, d] of store) {
      if (!p.startsWith(prefix) || p.slice(prefix.length).includes("/")) continue;
      out.push([p, d]);
    }
    for (const [f, op, v] of this.filters) {
      out = out.filter(([, d]) => {
        const x = getPath(d, f);
        if (op === "==") return x === v;           // == null solo matchea null explícito
        if (op === "!=") return x !== undefined && x !== v;
        if (op === "in") return v.includes(x);
        if (x === undefined || x === null || typeof x !== typeof v) return false;
        if (op === "<=") return x <= v; if (op === ">=") return x >= v; if (op === "<") return x < v; if (op === ">") return x > v;
        return false;
      });
    }
    if (this.order) { const [f, dir] = this.order; out.sort((a, b) => (getPath(a[1], f) > getPath(b[1], f) ? 1 : -1) * (dir === "desc" ? -1 : 1)); }
    if (this.lim != null) out = out.slice(0, this.lim);
    return out;
  }
  async get() {
    const docs = this._docs().map(([p, d]) => {
      reads++;
      let data = d;
      if (this.fields) { data = {}; for (const f of this.fields) { const v = getPath(d, f); if (v !== undefined) setPath(data, f, clone(v)); } }
      return snap(new DocRef(p), data);
    });
    return { docs, empty: !docs.length, size: docs.length };
  }
  count() { return { get: async () => ({ data: () => ({ count: this._docs().length }) }) }; }
}
class ColRef extends Query {
  constructor(path) { super(path); this.path = path; this.id = path.split("/").pop(); }
  doc(id) { return new DocRef(`${this.path}/${id || "auto" + (++autoN)}`); }
  async add(data) { const r = this.doc(); await r.set(data); return r; }
}

// Transacciones serializadas (Firestore real reintenta ante conflicto → efecto serial).
let txChain = Promise.resolve();
const _db = {
  collection: (n) => new ColRef(n),
  runTransaction: (fn) => {
    const run = txChain.then(() => fn({ get: (r) => r.get(), set: (r, d, o) => r.set(d, o), update: (r, d) => r.update(d), create: (r, d) => r.create(d) }));
    txChain = run.catch(() => {});
    return run;
  },
};
export function db() { return _db; }
export function initAdmin() { return {}; }
export async function requireMerchant() { throw new Error("no usar en tests"); }
export async function requireAuth() { throw new Error("no usar en tests"); }
export function clearMerchantCache() {}
export async function resolveMerchantAccess() { return { ok: false }; }
export async function getOrCreateMerchant(id) { const s = await _db.collection("merchants").doc(id).get(); return { id, ...(s.data() || {}) }; }
