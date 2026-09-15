// Firestore EN MEMORIA para los tests (reemplaza a firebase-admin/firestore).
//
// Cubre la API que usa el código de api/: doc/collection/collectionGroup,
// get/set(merge)/update(dotted paths)/create/delete, queries (where con
// == != < <= > >= in not-in array-contains array-contains-any, orderBy, limit,
// offset, startAfter/startAt/endAt/endBefore, select, count()), batch(),
// runTransaction() y FieldValue (delete, increment, arrayUnion, arrayRemove,
// serverTimestamp) + Timestamp (now, fromMillis, fromDate).
//
// Fidelidad que importa para el camino del cobro:
//   · runTransaction es SERIALIZABLE: guarda la versión de cada doc leído y, si
//     otro proceso lo escribió antes del commit, reintenta la función (como el
//     Admin SDK). Así dos webhooks en paralelo sobre el mismo pago se pisan igual
//     que en producción → el test de chargeclaim es real.
//   · `undefined` en un write LANZA (production usa getFirestore() sin
//     ignoreUndefinedProperties): un campo undefined es un bug de verdad.
//   · update() de un doc inexistente lanza NOT_FOUND (code 5); create() de uno
//     existente lanza ALREADY_EXISTS (code 6).
//
// Para los asserts: `stats` (lecturas / escrituras + log con paths), `rawGet`,
// `rawList`, `seedDoc`, `resetFirestore`.

const store = new Map();     // path → data (objeto plano)
const versions = new Map();  // path → n (sube en cada escritura)
let autoN = 0;

export const stats = {
  readOps: 0,        // operaciones de lectura (get de doc, query, count)
  docReads: 0,       // documentos devueltos (≈ lecturas facturadas)
  writeOps: 0,
  readLog: [],       // [{ op, path }]
  writeLog: [],      // [{ op, path }]
};

export function resetFirestore() {
  store.clear();
  versions.clear();
  autoN = 0;
  resetStats();
}
export function resetStats() {
  stats.readOps = 0; stats.docReads = 0; stats.writeOps = 0;
  stats.readLog.length = 0; stats.writeLog.length = 0;
}

// ── Timestamp / FieldValue ─────────────────────────────────────────────────
export class Timestamp {
  constructor(seconds, nanoseconds = 0) { this.seconds = seconds; this.nanoseconds = nanoseconds; }
  static now() { return Timestamp.fromMillis(Date.now()); }
  static fromMillis(ms) { return new Timestamp(Math.floor(ms / 1000), Math.round((ms % 1000) * 1e6)); }
  static fromDate(d) { return Timestamp.fromMillis(d.getTime()); }
  toMillis() { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); }
  toDate() { return new Date(this.toMillis()); }
  isEqual(o) { return o instanceof Timestamp && o.toMillis() === this.toMillis(); }
  valueOf() { return String(this.toMillis()).padStart(16, "0"); }
  toJSON() { return { _seconds: this.seconds, _nanoseconds: this.nanoseconds }; }
}

class Sentinel { constructor(op, arg) { this.op = op; this.arg = arg; } }
export const FieldValue = {
  delete: () => new Sentinel("delete"),
  increment: (n) => new Sentinel("increment", n),
  arrayUnion: (...a) => new Sentinel("arrayUnion", a),
  arrayRemove: (...a) => new Sentinel("arrayRemove", a),
  serverTimestamp: () => new Sentinel("serverTimestamp"),
};
export const FieldPath = { documentId: () => "__name__" };

const DEL = Symbol("delete");
const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
  && !(v instanceof Timestamp) && !(v instanceof Sentinel) && !(v instanceof DocRef) && !(v instanceof Date);

function assertNoUndefined(v, path) {
  if (v === undefined) {
    const e = new Error(`Value for argument "data" is not a valid Firestore document. Cannot use "undefined" as a Firestore value (found in field "${path}"). If you want to ignore undefined values, enable \`ignoreUndefinedProperties\`.`);
    e.code = 3;
    throw e;
  }
  if (Array.isArray(v)) v.forEach((x, i) => assertNoUndefined(x, `${path}.${i}`));
  else if (isPlain(v)) for (const [k, x] of Object.entries(v)) assertNoUndefined(x, path ? `${path}.${k}` : k);
}

function clone(v) {
  if (v === null || typeof v !== "object") return v;
  if (v instanceof Timestamp || v instanceof DocRef) return v;
  if (v instanceof Date) return Timestamp.fromDate(v); // Firestore guarda Date como Timestamp
  if (Array.isArray(v)) return v.map(clone);
  const o = {};
  for (const [k, x] of Object.entries(v)) o[k] = clone(x);
  return o;
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (a instanceof Timestamp || b instanceof Timestamp) return a instanceof Timestamp && b instanceof Timestamp && a.isEqual(b);
  if (a instanceof DocRef || b instanceof DocRef) return a instanceof DocRef && b instanceof DocRef && a.path === b.path;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isPlain(a) && isPlain(b)) {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => deepEqual(a[k], b[k]));
  }
  return false;
}

// Valor nuevo de un campo a partir del actual (resuelve sentinels).
function resolveValue(cur, v) {
  if (v instanceof Sentinel) {
    switch (v.op) {
      case "delete": return DEL;
      case "increment": return (typeof cur === "number" ? cur : 0) + v.arg;
      case "arrayUnion": {
        const base = Array.isArray(cur) ? cur.slice() : [];
        for (const x of v.arg) if (!base.some(y => deepEqual(x, y))) base.push(clone(x));
        return base;
      }
      case "arrayRemove": return Array.isArray(cur) ? cur.filter(y => !v.arg.some(x => deepEqual(x, y))) : [];
      case "serverTimestamp": return Timestamp.now();
      default: throw new Error("sentinel desconocido " + v.op);
    }
  }
  if (isPlain(v)) {
    const o = {};
    for (const [k, x] of Object.entries(v)) { const r = resolveValue(undefined, x); if (r !== DEL) o[k] = r; }
    return o;
  }
  return clone(v);
}

function mergeInto(target, data) {
  for (const [k, v] of Object.entries(data)) {
    if (isPlain(v) && isPlain(target[k])) { mergeInto(target[k], v); continue; }
    const r = resolveValue(target[k], v);
    if (r === DEL) delete target[k]; else target[k] = r;
  }
}

function getField(obj, field) {
  if (obj == null) return undefined;
  return String(field).split(".").reduce((a, k) => (a == null ? undefined : a[k]), obj);
}

// ── Escrituras (sincrónicas; las llaman DocRef, batch y transacciones) ──────
function bump(path, op) {
  versions.set(path, (versions.get(path) || 0) + 1);
  stats.writeOps++;
  stats.writeLog.push({ op, path });
}
function notFound(path) { const e = new Error(`5 NOT_FOUND: No document to update: ${path}`); e.code = 5; return e; }
function alreadyExists(path) { const e = new Error(`6 ALREADY_EXISTS: Document already exists: ${path}`); e.code = 6; return e; }

function checkWrite(kind, path, data) {
  if (kind === "update" && !store.has(path)) throw notFound(path);
  if (kind === "create" && store.has(path)) throw alreadyExists(path);
  if (data !== undefined) {
    if (!isPlain(data)) throw new Error(`Firestore ${kind}: data debe ser un objeto (${path})`);
    assertNoUndefined(data, "");
  }
}
function applyWrite(kind, path, data, opts = {}) {
  checkWrite(kind, path, data);
  if (kind === "delete") { if (store.has(path)) store.delete(path); bump(path, "delete"); return; }
  if (kind === "set" && opts.merge) {
    const cur = clone(store.get(path)) || {};
    mergeInto(cur, data);
    store.set(path, cur);
  } else if (kind === "set" || kind === "create") {
    const cur = {};
    for (const [k, v] of Object.entries(data)) { const r = resolveValue(undefined, v); if (r !== DEL) cur[k] = r; }
    store.set(path, cur);
  } else if (kind === "update") {
    const cur = clone(store.get(path));
    for (const [key, v] of Object.entries(data)) {
      const parts = key.split(".");
      let o = cur;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!isPlain(o[parts[i]])) o[parts[i]] = {};
        o = o[parts[i]];
      }
      const last = parts[parts.length - 1];
      const r = resolveValue(o[last], v); // un mapa en update REEMPLAZA el campo entero
      if (r === DEL) delete o[last]; else o[last] = r;
    }
    store.set(path, cur);
  }
  bump(path, kind);
}

// ── Snapshots / refs / queries ──────────────────────────────────────────────
function makeSnap(ref, data) {
  const d = data === undefined ? undefined : clone(data);
  return {
    id: ref.id,
    ref,
    exists: d !== undefined,
    data: () => (d === undefined ? undefined : clone(d)),
    get: (f) => getField(d, f),
    createTime: undefined,
    updateTime: undefined,
    readTime: Timestamp.now(),
  };
}
function querySnap(docs) {
  return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) };
}

function newAutoId() {
  autoN++;
  return ("AutoId" + String(autoN).padStart(14, "0")).slice(0, 20);
}

export class DocRef {
  constructor(path) {
    const segs = path.split("/");
    if (segs.length % 2 !== 0) throw new Error(`Ruta de documento inválida: ${path}`);
    this.path = path;
    this.id = segs[segs.length - 1];
    this.firestore = fakeDb;
  }
  get parent() { return new ColRef(this.path.split("/").slice(0, -1).join("/")); }
  collection(name) { return new ColRef(`${this.path}/${name}`); }
  isEqual(o) { return o instanceof DocRef && o.path === this.path; }
  _readSync(op = "get") {
    stats.readOps++; stats.docReads++;
    stats.readLog.push({ op, path: this.path });
    return { snap: makeSnap(this, store.get(this.path)), version: versions.get(this.path) || 0 };
  }
  async get() { return this._readSync().snap; }
  async set(data, opts = {}) { applyWrite("set", this.path, data, opts); return { writeTime: Timestamp.now() }; }
  async update(data) { applyWrite("update", this.path, data); return { writeTime: Timestamp.now() }; }
  async create(data) { applyWrite("create", this.path, data); return { writeTime: Timestamp.now() }; }
  async delete() { applyWrite("delete", this.path); return { writeTime: Timestamp.now() }; }
  async listCollections() {
    const pre = this.path + "/";
    const names = new Set();
    for (const p of store.keys()) if (p.startsWith(pre)) names.add(p.slice(pre.length).split("/")[0]);
    return [...names].map(n => this.collection(n));
  }
}

const TYPE_RANK = (v) => (v === null ? 0 : typeof v === "boolean" ? 1 : typeof v === "number" ? 2
  : v instanceof Timestamp ? 3 : typeof v === "string" ? 4 : v instanceof DocRef ? 6 : Array.isArray(v) ? 8 : 9);
function cmpValues(a, b) {
  const ra = TYPE_RANK(a), rb = TYPE_RANK(b);
  if (ra !== rb) return ra - rb;
  if (a instanceof Timestamp) return a.toMillis() - b.toMillis();
  if (typeof a === "number" || typeof a === "boolean") return Number(a) - Number(b);
  if (typeof a === "string") return a < b ? -1 : a > b ? 1 : 0;
  if (a instanceof DocRef) return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  return 0;
}

function matchFilter(id, data, [field, op, value]) {
  const x = field === "__name__" ? id : getField(data, field);
  switch (op) {
    case "==": return x !== undefined && deepEqual(x, value);
    case "!=": return x !== undefined && x !== null && !deepEqual(x, value);
    case "in": return x !== undefined && Array.isArray(value) && value.some(v => deepEqual(x, v));
    case "not-in": return x !== undefined && x !== null && Array.isArray(value) && !value.some(v => deepEqual(x, v));
    case "array-contains": return Array.isArray(x) && x.some(v => deepEqual(v, value));
    case "array-contains-any": return Array.isArray(x) && Array.isArray(value) && x.some(v => value.some(w => deepEqual(v, w)));
    case "<": case "<=": case ">": case ">=": {
      if (x === undefined || x === null || TYPE_RANK(x) !== TYPE_RANK(value)) return false; // rango: mismo tipo
      const c = cmpValues(x, value);
      return op === "<" ? c < 0 : op === "<=" ? c <= 0 : op === ">" ? c > 0 : c >= 0;
    }
    default: throw new Error(`Operador de query no soportado por el mock: ${op}`);
  }
}

export class Query {
  constructor(colPath, { group = false, filters = [], orders = [], lim = null, off = 0, cursor = null } = {}) {
    this._colPath = colPath; this._group = group;
    this._filters = filters; this._orders = orders; this._lim = lim; this._off = off; this._cursor = cursor;
    this.firestore = fakeDb;
  }
  _with(p) { return new Query(this._colPath, { group: this._group, filters: this._filters, orders: this._orders, lim: this._lim, off: this._off, cursor: this._cursor, ...p }); }
  where(field, op, value) {
    if (typeof field === "object" && field && !Array.isArray(field)) throw new Error("Filter compuesto no soportado por el mock");
    return this._with({ filters: [...this._filters, [String(field), op, value]] });
  }
  orderBy(field, dir = "asc") { return this._with({ orders: [...this._orders, [String(field), dir]] }); }
  limit(n) { return this._with({ lim: n }); }
  limitToLast(n) { return this._with({ lim: -n }); }
  offset(n) { return this._with({ off: n }); }
  select() { return this; }
  startAfter(...v) { return this._with({ cursor: ["startAfter", v] }); }
  startAt(...v) { return this._with({ cursor: ["startAt", v] }); }
  endBefore(...v) { return this._with({ cursor: ["endBefore", v] }); }
  endAt(...v) { return this._with({ cursor: ["endAt", v] }); }

  _matches(path) {
    const segs = path.split("/");
    if (this._group) return segs.length >= 2 && segs[segs.length - 2] === this._colPath;
    const pre = this._colPath + "/";
    return path.startsWith(pre) && !path.slice(pre.length).includes("/");
  }
  _run() {
    let out = [];
    for (const [p, d] of store) if (this._matches(p)) out.push([p, d]);
    for (const f of this._filters) out = out.filter(([p, d]) => matchFilter(p.split("/").pop(), d, f));
    if (this._orders.length) {
      out = out.filter(([p, d]) => this._orders.every(([f]) => f === "__name__" || getField(d, f) !== undefined));
      out.sort((a, b) => {
        for (const [f, dir] of this._orders) {
          const va = f === "__name__" ? a[0] : getField(a[1], f);
          const vb = f === "__name__" ? b[0] : getField(b[1], f);
          const c = cmpValues(va, vb);
          if (c) return dir === "desc" ? -c : c;
        }
        return a[0] < b[0] ? -1 : 1;
      });
    } else {
      out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    }
    if (this._cursor) {
      const [kind, vals] = this._cursor;
      const f = this._orders[0]?.[0] || "__name__";
      const dir = this._orders[0]?.[1] || "asc";
      let cv = vals[0];
      if (cv && typeof cv === "object" && "exists" in cv && typeof cv.data === "function") cv = f === "__name__" ? cv.ref.path : getField(cv.data(), f);
      const keyOf = ([p, d]) => (f === "__name__" ? p : getField(d, f));
      const sign = dir === "desc" ? -1 : 1;
      out = out.filter((row) => {
        const c = cmpValues(keyOf(row), cv) * sign;
        return kind === "startAfter" ? c > 0 : kind === "startAt" ? c >= 0 : kind === "endBefore" ? c < 0 : c <= 0;
      });
    }
    if (this._off) out = out.slice(this._off);
    if (this._lim != null) out = this._lim >= 0 ? out.slice(0, this._lim) : out.slice(this._lim);
    return out;
  }
  _readSync() {
    const rows = this._run();
    stats.readOps++; stats.docReads += Math.max(1, rows.length);
    stats.readLog.push({ op: "query", path: this._group ? `**/${this._colPath}` : this._colPath });
    return rows.map(([p, d]) => ({ snap: makeSnap(new DocRef(p), d), version: versions.get(p) || 0 }));
  }
  async get() { return querySnap(this._readSync().map(r => r.snap)); }
  count() {
    return {
      get: async () => {
        const n = this._run().length;
        stats.readOps++; stats.docReads += 1;
        stats.readLog.push({ op: "count", path: this._group ? `**/${this._colPath}` : this._colPath });
        return { data: () => ({ count: n }) };
      },
    };
  }
}

export class ColRef extends Query {
  constructor(path) {
    super(path);
    this.path = path;
    this.id = path.split("/").pop();
  }
  get parent() { const s = this.path.split("/"); return s.length > 1 ? new DocRef(s.slice(0, -1).join("/")) : null; }
  doc(id) {
    const docId = id === undefined ? newAutoId() : String(id);
    if (!docId) throw new Error("doc(): id vacío");
    return new DocRef(`${this.path}/${docId}`);
  }
  async add(data) { const r = this.doc(); await r.set(data); return r; }
  async listDocuments() {
    const ids = new Set();
    const pre = this.path + "/";
    for (const p of store.keys()) if (p.startsWith(pre)) ids.add(p.slice(pre.length).split("/")[0]);
    return [...ids].map(id => this.doc(id));
  }
}

// ── Batch / transacciones ───────────────────────────────────────────────────
function commitWrites(writes) {
  // Validar todo ANTES de aplicar (atómico: todo o nada).
  const exists = new Map();
  const has = (p) => (exists.has(p) ? exists.get(p) : store.has(p));
  for (const [kind, ref, data] of writes) {
    if (kind === "update" && !has(ref.path)) throw notFound(ref.path);
    if (kind === "create" && has(ref.path)) throw alreadyExists(ref.path);
    if (data !== undefined) assertNoUndefined(data, "");
    exists.set(ref.path, kind !== "delete");
  }
  for (const [kind, ref, data, opts] of writes) applyWrite(kind, ref.path, data, opts);
}

function makeWriter(writes) {
  const w = {
    set: (ref, data, opts = {}) => { writes.push(["set", ref, data, opts]); return w; },
    update: (ref, data) => { writes.push(["update", ref, data]); return w; },
    create: (ref, data) => { writes.push(["create", ref, data]); return w; },
    delete: (ref) => { writes.push(["delete", ref]); return w; },
  };
  return w;
}

export let transactionStats = { attempts: 0, retries: 0 };

async function runTransaction(fn, opts = {}) {
  const max = opts.maxAttempts || 5;
  for (let attempt = 1; ; attempt++) {
    transactionStats.attempts++;
    const readVersions = new Map();
    const writes = [];
    const tx = makeWriter(writes);
    tx.get = async (target) => {
      if (writes.length) throw new Error("Firestore transactions require all reads to be executed before all writes.");
      if (target instanceof DocRef) {
        const { snap, version } = target._readSync("tx.get");
        readVersions.set(target.path, version);
        return snap;
      }
      const rows = target._readSync();
      for (const r of rows) readVersions.set(r.snap.ref.path, r.version);
      return querySnap(rows.map(r => r.snap));
    };
    tx.getAll = async (...refs) => Promise.all(refs.map(r => tx.get(r)));
    const result = await fn(tx);
    // Commit sincrónico: nadie puede meterse entre el chequeo y la escritura.
    const conflict = [...readVersions].some(([p, v]) => (versions.get(p) || 0) !== v);
    if (conflict) {
      if (attempt >= max) { const e = new Error("10 ABORTED: Too much contention on these documents."); e.code = 10; throw e; }
      transactionStats.retries++;
      continue;
    }
    commitWrites(writes);
    return result;
  }
}

export const fakeDb = {
  collection: (name) => new ColRef(name),
  collectionGroup: (id) => new Query(id, { group: true }),
  doc: (path) => new DocRef(path),
  batch() {
    const writes = [];
    const b = makeWriter(writes);
    b.commit = async () => { commitWrites(writes); return writes.map(() => ({ writeTime: Timestamp.now() })); };
    return b;
  },
  runTransaction,
  getAll: async (...refs) => refs.map(r => r._readSync().snap),
  settings: () => {},
};

// ── Helpers de test (NO cuentan lecturas) ───────────────────────────────────
export function seedDoc(path, data) {
  assertNoUndefined(data, "");
  store.set(path, clone(data));
  versions.set(path, (versions.get(path) || 0) + 1);
}
export function rawGet(path) { const d = store.get(path); return d === undefined ? undefined : clone(d); }
export function rawList(colPath) {
  const q = new ColRef(colPath);
  const out = [];
  for (const [p, d] of store) if (q._matches(p)) out.push({ id: p.split("/").pop(), path: p, data: clone(d) });
  return out.sort((a, b) => (a.path < b.path ? -1 : 1));
}
export function rawPaths() { return [...store.keys()].sort(); }
