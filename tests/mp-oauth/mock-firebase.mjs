// Firestore en memoria con la API que usan los módulos del motor de flujos.
const store = new Map();
export const __store = store;
let reads = 0;
export const __reads = () => reads;
let autoN = 0;
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const getPath = (o, f) => f.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);

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
    if (v && typeof v === "object" && !Array.isArray(v) && !v.__op) o[last] = {}; // update reemplaza el mapa entero
    applyVal(o, last, v);
  }
}
const snap = (ref, d) => ({ id: ref.id, ref, exists: d !== undefined, data: () => clone(d) });

class DocRef {
  constructor(path) { this.path = path; this.id = path.split("/").pop(); }
  collection(n) { return new ColRef(`${this.path}/${n}`); }
  async get() { reads++; return snap(this, store.get(this.path)); }
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
  constructor(colPath, filters = [], order = null, lim = null) { this.colPath = colPath; this.filters = filters; this.order = order; this.lim = lim; }
  where(f, op, v) { return new Query(this.colPath, [...this.filters, [f, op, v]], this.order, this.lim); }
  orderBy(f, dir = "asc") { return new Query(this.colPath, this.filters, [f, dir], this.lim); }
  limit(n) { return new Query(this.colPath, this.filters, this.order, n); }
  _docs() {
    const prefix = this.colPath + "/";
    let out = [];
    for (const [p, d] of store) {
      if (!p.startsWith(prefix) || p.slice(prefix.length).includes("/")) continue;
      out.push([p, d]);
    }
    for (const [f, op, v] of this.filters) {
      out = out.filter(([, d]) => {
        const x = getPath(d, f);
        if (op === "==") return x === v;
        if (op === "!=") return x !== undefined && x !== v;
        if (x === undefined || x === null || typeof x !== typeof v) return false; // rango: mismo tipo
        if (op === "<=") return x <= v; if (op === ">=") return x >= v; if (op === "<") return x < v; if (op === ">") return x > v;
        return false;
      });
    }
    if (this.order) { const [f, dir] = this.order; out.sort((a, b) => (getPath(a[1], f) > getPath(b[1], f) ? 1 : -1) * (dir === "desc" ? -1 : 1)); }
    if (this.lim != null) out = out.slice(0, this.lim);
    return out;
  }
  async get() { const docs = this._docs().map(([p, d]) => { reads++; return snap(new DocRef(p), d); }); return { docs, empty: !docs.length, size: docs.length }; }
  count() { return { get: async () => ({ data: () => ({ count: this._docs().length }) }) }; }
}
class ColRef extends Query {
  constructor(path) { super(path); this.path = path; }
  doc(id) { return new DocRef(`${this.path}/${id || "auto" + (++autoN)}`); }
  async add(data) { const r = this.doc(); await r.set(data); return r; }
}

const _db = {
  collection: (n) => new ColRef(n),
  runTransaction: async (fn) => fn({ get: (r) => r.get(), set: (r, d, o) => r.set(d, o), update: (r, d) => r.update(d), create: (r, d) => r.create(d) }),
};
export function db() { return _db; }
export async function requireMerchant() { throw new Error("no usar en tests"); }
// cron.js importa _lib/health.js, que usa initAdmin (Firebase Auth) solo en ?action=health.
export function initAdmin() {}
