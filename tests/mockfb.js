// 시험용 가짜 파이어베이스 — 앱이 쓰는 함수만 메모리로 흉내 낸다
const G = globalThis.__MOCK || (globalThis.__MOCK = { store: new Map(), user: null, listeners: [], seq: 0, calls: [] });
const TS = () => { const ms = Date.now() + (G.seq++); return { toMillis: () => ms, __ts: ms }; };
const norm = segs => segs.flatMap(s => String(s).split('/')).filter(Boolean);
class DocRef { constructor(p){ this.path = p.join('/'); this.id = p[p.length-1]; this._p = p; } }
class ColRef { constructor(p){ this.path = p.join('/'); this._p = p; this.q = { where: [], order: null, limit: 0 }; } }
function applyOps(old, data, merge){
  const out = merge || old ? Object.assign({}, old || {}) : {};
  for(const [k, v] of Object.entries(data)){
    if(v && v.__op === 'ts') out[k] = TS();
    else if(v && v.__op === 'inc') out[k] = (out[k] || 0) + v.n;
    else if(v && v.__op === 'union') out[k] = [...new Set([...(out[k] || []), ...v.v])];
    else if(v && v.__op === 'remove') out[k] = (out[k] || []).filter(x => v.v.indexOf(x) < 0);
    else out[k] = (v && typeof v === 'object' && !Array.isArray(v) && !v.toMillis) ? JSON.parse(JSON.stringify(v)) : v;
  }
  return out;
}
const snap = (ref, data) => ({ id: ref.id, ref, exists: () => data !== undefined, data: () => data });
export const fs = {
  initializeFirestore: () => ({}), getFirestore: () => ({}), persistentLocalCache: () => ({}),
  collection: (db, ...s) => new ColRef(norm(s)),
  doc: (a, ...s) => {
    if(a instanceof ColRef){ const id = s.length ? s[0] : 'id' + (++G.seq); return new DocRef(a._p.concat([id])); }
    return new DocRef(norm(s));
  },
  getDoc: async r => { G.calls.push('get ' + r.path); return snap(r, G.store.get(r.path)); },
  query: (c, ...cons) => { const q = new ColRef(c._p); for(const x of cons) x(q.q); return q; },
  where: (f, op, v) => q => q.where.push([f, op, v]),
  orderBy: (f, d) => q => { q.order = [f, d || 'asc']; },
  limit: n => q => { q.limit = n; },
  getDocs: async c => {
    const depth = c._p.length + 1, pre = c.path + '/';
    let rows = [...G.store.entries()].filter(([k]) => k.startsWith(pre) && k.split('/').length === depth);
    for(const [f, , v] of c.q.where) rows = rows.filter(([, d]) => d[f] === v);
    if(c.q.order){ const [f, d] = c.q.order; const val = x => x[f] && x[f].toMillis ? x[f].toMillis() : x[f];
      rows.sort((a, b) => (val(a[1]) > val(b[1]) ? 1 : -1) * (d === 'desc' ? -1 : 1)); }
    if(c.q.limit) rows = rows.slice(0, c.q.limit);
    const docs = rows.map(([k, d]) => snap(new DocRef(k.split('/')), d));
    return { docs, size: docs.length };
  },
  addDoc: async (c, d) => { const r = fs.doc(c); G.store.set(r.path, applyOps(null, d)); return r; },
  setDoc: async (r, d, o) => { G.store.set(r.path, applyOps(o && o.merge ? G.store.get(r.path) : null, d, o && o.merge)); },
  updateDoc: async (r, d) => { if(!G.store.has(r.path)) throw new Error('not-found ' + r.path); G.store.set(r.path, applyOps(G.store.get(r.path), d)); },
  deleteDoc: async r => { G.store.delete(r.path); },
  writeBatch: () => { const ops = []; return {
    set: (r, d) => ops.push(() => fs.setDoc(r, d)), update: (r, d) => ops.push(() => fs.updateDoc(r, d)),
    delete: r => ops.push(() => fs.deleteDoc(r)), commit: async () => { for(const o of ops) await o(); } }; },
  serverTimestamp: () => ({ __op: 'ts' }), increment: n => ({ __op: 'inc', n }),
  arrayUnion: (...v) => ({ __op: 'union', v }), arrayRemove: (...v) => ({ __op: 'remove', v })
};
const fire = () => G.listeners.forEach(f => setTimeout(() => f(G.user), 0));
export const au = {
  getAuth: () => ({ get currentUser(){ return G.user; } }),
  onAuthStateChanged: (a, f) => { G.listeners.push(f); setTimeout(() => f(G.user), 0); },
  GoogleAuthProvider: class {},
  signInWithPopup: async () => { G.user = { uid: 'uG', email: 'g@test' }; fire(); },
  signInWithEmailAndPassword: async (a, e, p) => { if(p !== 'secret1') { const er = new Error('x'); er.code = 'auth/invalid-credential'; throw er; } G.user = { uid: 'u_' + e.replace(/\W/g, ''), email: e }; fire(); },
  createUserWithEmailAndPassword: async (a, e, p) => { if(p.length < 6){ const er = new Error('x'); er.code = 'auth/weak-password'; throw er; } G.user = { uid: 'u_' + e.replace(/\W/g, ''), email: e }; fire(); },
  sendPasswordResetEmail: async () => {},
  signOut: async () => { G.user = null; fire(); },
  deleteUser: async () => { G.user = null; fire(); }
};
export const st = {
  getStorage: () => ({}), ref: (s, p) => ({ p }), uploadBytes: async () => {}, getDownloadURL: async r => 'data:image/gif;base64,R0lGODlhAQABAAAAACw=#' + r.p
};
export const fn = {
  getFunctions: () => ({}),
  httpsCallable: (f, name) => async d => { G.calls.push('fn ' + name); return { data: { text: '[' + d.to + '] ' + d.text } }; }
};
