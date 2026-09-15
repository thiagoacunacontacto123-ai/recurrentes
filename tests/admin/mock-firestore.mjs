// Firestore en memoria para los tests del panel admin (reemplaza
// firebase-admin/firestore). API mínima que usan _lib/firebase.js, _lib/admin.js
// y merchant.js: doc/collection/get/set(merge)/update(field paths)/add, where
// (== != in not-in array-contains < <= > >=), orderBy, limit, select (proyecta
// los campos: si el código lee algo que no pidió en select, el test lo nota) y count().
// Nunca toca la base real.
export const __store = new Map();
let reads = 0;
export const __reads = () => reads;
let autoN = 0;
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const getPath = (o, f) => f.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);
const setPath = (o, f, v) => {
  const parts = f.split(".");
  let x = o;
  for (let i = 0; i < parts.length - 1; i++) { x[parts[i]] = x[parts[i]] && typeof x[parts[i]] === "object" ? x[parts[i]] : {}; x = x[parts[i]]; }
  x[parts[parts.length - 1]] = v;
};
const project = (d, fields) => {
  if (d === undefined) return undefined;
  const out = {};
  for (const f of fields) { const v = getPath(d, f); if (v !== undefined) setPath(out, f, clone(v)); }
  return out;
};

function applyVal(obj, key, v) {
  if (v && v.__op === "del") { delete obj[key]; return; }
  if (v && v.__op === "inc") { obj[key] = (Number(obj[key]) || 0) + v.n; return; }
  if (v && v.__op === "union") { const cur = obj[key] || []; const seen = new Set(cur.map(x => JSON.stringify(x))); obj[key] = [...cur, ...v.a.filter(x => !seen.has(JSON.stringify(x)))].map(clone); return; }
  if (v && v.__op === "remove") { const rm = new Set(v.a.map(x => JSON.stringify(x))); obj[key] = (obj[key] || []).filter(x => !rm.has(JSON.stringify(x))); return; }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    obj[key] = obj[key] && typeof obj[key] === "object" && !Array.isArray(obj[key]) ? obj[key] : {};
    for (const [k2, v2] of Object.entries(v)) applyVal(obj[key], k2, v2);
    return;
  }
  obj[key] = clone(v);
}
// update(): cada clave es un field path; el valor REEMPLAZA ese campo entero.
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
const snap = (ref, d, fields) => ({ id: ref.id, ref, exists: d !== undefined, data: () => (fields ? project(d, fields) : clone(d)) });

class DocRef {
  constructor(path) { this.path = path; this.id = path.split("/").pop(); }
  collection(n) { return new ColRef(`${this.path}/${n}`); }
  async get() { reads++; return snap(this, __store.get(this.path)); }
  async set(data, opts = {}) {
    const cur = opts.merge ? (clone(__store.get(this.path)) || {}) : {};
    for (const [k, v] of Object.entries(data)) applyVal(cur, k, v);
    __store.set(this.path, cur);
  }
  async update(data) {
    const cur = __store.get(this.path);
    if (!cur) { const e = new Error("5 NOT_FOUND"); e.code = 5; throw e; }
    applyUpdate(cur, data);
  }
  async create(data) {
    if (__store.has(this.path)) { const e = new Error("6 ALREADY_EXISTS"); e.code = 6; throw e; }
    const cur = {};
    for (const [k, v] of Object.entries(data)) applyVal(cur, k, v);
    __store.set(this.path, cur);
  }
  async delete() { __store.delete(this.path); }
}

class Query {
  constructor(colPath, filters = [], orders = [], lim = null, fields = null) { Object.assign(this, { colPath, filters, orders, lim, fields }); }
  _with(p) { return new Query(this.colPath, p.filters ?? this.filters, p.orders ?? this.orders, p.lim !== undefined ? p.lim : this.lim, p.fields !== undefined ? p.fields : this.fields); }
  where(f, op, v) { return this._with({ filters: [...this.filters, [f, op, v]] }); }
  orderBy(f, dir = "asc") { return this._with({ orders: [...this.orders, [f, dir]] }); }
  limit(n) { return this._with({ lim: n }); }
  select(...fields) { return this._with({ fields }); }
  _docs() {
    const prefix = this.colPath + "/";
    let out = [];
    for (const [p, d] of __store) {
      if (!p.startsWith(prefix) || p.slice(prefix.length).includes("/")) continue;
      out.push([p, d]);
    }
    for (const [f, op, v] of this.filters) {
      out = out.filter(([, d]) => {
        const x = getPath(d, f);
        if (op === "==") return x === v;
        if (op === "!=") return x !== undefined && x !== v;
        if (op === "in") return Array.isArray(v) && v.includes(x);
        if (op === "not-in") return x !== undefined && Array.isArray(v) && !v.includes(x);
        if (op === "array-contains") return Array.isArray(x) && x.includes(v);
        if (x === undefined || x === null || typeof x !== typeof v) return false;
        if (op === "<=") return x <= v; if (op === ">=") return x >= v; if (op === "<") return x < v; if (op === ">") return x > v;
        return false;
      });
    }
    for (const [f] of this.orders) out = out.filter(([, d]) => getPath(d, f) !== undefined); // orderBy excluye docs sin el campo
    if (this.orders.length) {
      out.sort((a, b) => {
        for (const [f, dir] of this.orders) {
          const x = getPath(a[1], f), y = getPath(b[1], f);
          if (x === y) continue;
          return (x > y ? 1 : -1) * (dir === "desc" ? -1 : 1);
        }
        return 0;
      });
    }
    if (this.lim != null) out = out.slice(0, this.lim);
    return out;
  }
  async get() {
    const docs = this._docs().map(([p, d]) => { reads++; return snap(new DocRef(p), d, this.fields); });
    return { docs, empty: !docs.length, size: docs.length };
  }
  count() { return { get: async () => { reads++; return { data: () => ({ count: this._docs().length }) }; } }; }
}
class ColRef extends Query {
  constructor(path) { super(path); this.path = path; this.id = path.split("/").pop(); }
  doc(id) { return new DocRef(`${this.path}/${id || "auto" + (++autoN)}`); }
  async add(data) { const r = this.doc(); await r.set(data); return r; }
}

const _db = {
  collection: (n) => new ColRef(n),
  doc: (p) => new DocRef(p),
  runTransaction: async (fn) => fn({ get: (r) => r.get(), set: (r, d, o) => r.set(d, o), update: (r, d) => r.update(d), create: (r, d) => r.create(d), delete: (r) => r.delete() }),
  batch: () => { const ops = []; return { set: (r, d, o) => ops.push(() => r.set(d, o)), update: (r, d) => ops.push(() => r.update(d)), delete: (r) => ops.push(() => r.delete()), commit: async () => { for (const op of ops) await op(); } }; },
};
export function getFirestore() { return _db; }
export const FieldValue = {
  increment: (n) => ({ __op: "inc", n }),
  delete: () => ({ __op: "del" }),
  serverTimestamp: () => new Date().toISOString(),
  arrayUnion: (...a) => ({ __op: "union", a }),
  arrayRemove: (...a) => ({ __op: "remove", a }),
};
export const Timestamp = { now: () => ({ toDate: () => new Date(), toMillis: () => Date.now() }), fromDate: (d) => ({ toDate: () => d, toMillis: () => d.getTime() }) };
export class FieldPath { constructor(...s) { this.segments = s; } static documentId() { return "__name__"; } }
