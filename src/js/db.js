/* VIGÍA · db.js — persistencia local en IndexedDB (esquema versionado) con respaldo en memoria.
 * Este módulo NO aplica permisos: sólo lo usa api.js, que es la única puerta de acceso (control
 * de organización, rol y auditoría). La interfaz de usuario nunca llama a db.js directamente. */
(function () {
  'use strict';
  const V = window.V;

  // Migraciones versionadas: cada versión añade almacenes/índices. Nunca se reescriben migraciones pasadas.
  const MIGRATIONS = {
    1: db => {
      const mk = (name, idx, key) => { const s = db.createObjectStore(name, { keyPath: key || 'id' }); (idx || []).forEach(i => s.createIndex(i, i, { unique: false })); return s; };
      mk('meta', [], 'k');
      mk('orgs');
      mk('users', ['email']);
      mk('memberships', ['org', 'userId']);
      mk('sites', ['org']);
      mk('zones', ['org']);
      mk('cameras', ['org']);
      mk('groups', ['org']);
      mk('recordings', ['org', 'cameraId']);
      mk('jobs', ['org', 'estado']);
      mk('frames', ['org', 'recordingId']);
      mk('detections', ['org', 'recordingId', 'cameraId']);
      mk('findings', ['org', 'cameraId', 'recordingId']);
      mk('derivatives', ['org', 'recordingId']);
      mk('chats', ['org']);
      mk('messages', ['org', 'chatId']);
      mk('cases', ['org']);
      mk('evidence', ['org', 'caseId']);
      mk('notes', ['org', 'caseId']);
      mk('reports', ['org', 'caseId']);
      mk('rules', ['org', 'cameraId']);
      mk('alerts', ['org', 'ruleId']);
      mk('audit', ['org']);
      mk('policies', ['org']);
      mk('blobs', ['org'], 'key');
    }
  };
  // v2: resultados de analítica por grabación (conteos, ocupación, puertas, mapa de calor, pistas)
  MIGRATIONS[2] = db => { const s = db.createObjectStore('analysis', { keyPath: 'id' }); s.createIndex('org', 'org', { unique: false }); s.createIndex('recordingId', 'recordingId', { unique: false }); s.createIndex('cameraId', 'cameraId', { unique: false }); };
  // v3: plano del sitio (posición, orientación y campo de visión de cada cámara)
  MIGRATIONS[3] = db => { const s = db.createObjectStore('plans', { keyPath: 'id' }); s.createIndex('org', 'org', { unique: false }); };
  const VERSION = 3;

  class DB {
    constructor(name) { this.name = name; this.db = null; this.mem = null; }
    async open() {
      if (!('indexedDB' in window)) { this._toMemory('IndexedDB no disponible'); return this; }
      try {
        this.db = await new Promise((res, rej) => {
          const r = indexedDB.open(this.name, VERSION);
          r.onupgradeneeded = e => { const db = r.result; for (let v = e.oldVersion + 1; v <= VERSION; v++) MIGRATIONS[v](db); };
          r.onsuccess = () => { r.result.onversionchange = () => r.result.close(); res(r.result); }; // otra pestaña actualiza el esquema: se libera la conexión
          r.onerror = () => rej(r.error);
          r.onblocked = () => rej(new Error('Base de datos bloqueada por otra pestaña'));
        });
        this.persistente = true;
      } catch (e) { this._toMemory(e.message); }
      return this;
    }
    _toMemory(reason) {
      console.warn('VIGÍA: almacenamiento en memoria (' + reason + ')');
      this.mem = {}; this.persistente = false; this.motivoMemoria = reason;
    }
    _mstore(s) { return (this.mem[s] = this.mem[s] || new Map()); }
    _key(store) { return store === 'meta' ? 'k' : store === 'blobs' ? 'key' : 'id'; }
    async put(store, obj) {
      if (this.mem) { this._mstore(store).set(obj[this._key(store)], structuredClone(obj)); return obj; }
      await this._tx(store, 'readwrite', s => s.put(obj)); return obj;
    }
    async putMany(store, arr) {
      if (!arr.length) return;
      if (this.mem) { arr.forEach(o => this.put(store, o)); return; }
      await new Promise((res, rej) => { const tx = this.db.transaction(store, 'readwrite'); const s = tx.objectStore(store); arr.forEach(o => s.put(o)); tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
    }
    async get(store, key) {
      if (this.mem) { const v = this._mstore(store).get(key); return v ? structuredClone(v) : undefined; }
      return this._tx(store, 'readonly', s => s.get(key));
    }
    async del(store, key) {
      if (this.mem) { this._mstore(store).delete(key); return; }
      return this._tx(store, 'readwrite', s => s.delete(key));
    }
    async all(store) {
      if (this.mem) return Array.from(this._mstore(store).values()).map(v => structuredClone(v));
      return this._tx(store, 'readonly', s => s.getAll());
    }
    async by(store, index, value) {
      if (this.mem) return (await this.all(store)).filter(o => o[index] === value);
      return this._tx(store, 'readonly', s => s.index(index).getAll(value));
    }
    async count(store, index, value) {
      if (this.mem) return (await this.by(store, index, value)).length;
      return this._tx(store, 'readonly', s => s.index(index).count(value));
    }
    _tx(store, mode, fn) {
      return new Promise((res, rej) => {
        const tx = this.db.transaction(store, mode); const r = fn(tx.objectStore(store));
        tx.oncomplete = () => res(r.result); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
      });
    }
    async destroy() {
      if (this.db) this.db.close();
      if (this.mem) { this.mem = {}; return; }
      await new Promise(res => { const r = indexedDB.deleteDatabase(this.name); r.onsuccess = r.onerror = r.onblocked = () => res(); });
    }
  }
  V.DB = DB;
  V.DB_VERSION = VERSION;
})();
