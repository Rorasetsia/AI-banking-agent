import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createSeed, PRODUCT_CATALOG } from './seed.mjs';
import { ensureOwnFunds } from './own-funds.mjs';
import { ensureServices } from './service-operations.mjs';

export { appendAudit } from './seed.mjs';

const hashSid = (sid) => createHash('sha256').update(String(sid)).digest('hex');
const clone = (value) => structuredClone(value);

export class Store {
  #closed = false;
  #db;
  #statements;

  constructor(path = 'data/bank.sqlite') {
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, stateJson TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, userId TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS private_records (key TEXT PRIMARY KEY, valueJson TEXT NOT NULL);
    `);
    this.#statements = {
      insertUser: this.#db.prepare('INSERT INTO users (id, stateJson) VALUES (?, ?)'),
      getUser: this.#db.prepare('SELECT stateJson FROM users WHERE id = ?'),
      updateUser: this.#db.prepare('UPDATE users SET stateJson = ? WHERE id = ?'),
      insertSession: this.#db.prepare('INSERT INTO sessions (hash, userId) VALUES (?, ?)'),
      getSession: this.#db.prepare('SELECT userId FROM sessions WHERE hash = ?')
    };
  }

  #assertOpen() {
    if (this.#closed) throw new Error('STORE_CLOSED');
  }

  #immediate(fn) {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.#db.exec('COMMIT');
      return value;
    } catch (error) {
      try { this.#db.exec('ROLLBACK'); } catch { /* transaction already closed */ }
      throw error;
    }
  }

  createSession() {
    this.#assertOpen();
    const sid = randomBytes(32).toString('hex');
    const userId = `u_${randomUUID()}`;
    const state = createSeed(userId);
    this.#immediate(() => {
      this.#statements.insertUser.run(userId, JSON.stringify(state));
      this.#statements.insertSession.run(hashSid(sid), userId);
    });
    return { sid, userId };
  }

  getSession(sid) {
    this.#assertOpen();
    if (typeof sid !== 'string' || sid.length === 0) return null;
    const row = this.#statements.getSession.get(hashSid(sid));
    return row ? { userId: row.userId } : null;
  }

  read(userId) {
    this.#assertOpen();
    const row = this.#statements.getUser.get(userId);
    if (!row) return null;
    const state = clone(JSON.parse(row.stateJson));
    state.products = clone(PRODUCT_CATALOG);
    ensureOwnFunds(state);
    ensureServices(state);
    return state;
  }

  update(userId, fn) {
    this.#assertOpen();
    if (typeof fn !== 'function') throw new TypeError('update requires a synchronous function');
    return this.#immediate(() => {
      const row = this.#statements.getUser.get(userId);
      if (!row) throw new Error('USER_NOT_FOUND');
      const state = JSON.parse(row.stateJson);
      state.products = clone(PRODUCT_CATALOG);
      ensureOwnFunds(state);
      ensureServices(state);
      const result = fn(state);
      if (result && typeof result.then === 'function') {
        if (typeof result.catch === 'function') result.catch(() => {});
        throw new Error('update callback must be synchronous');
      }
      this.#statements.updateUser.run(JSON.stringify(state), userId);
      return result === undefined ? undefined : clone(result);
    });
  }

  reset(userId) {
    return this.update(userId, (state) => {
      const fresh = createSeed(userId);
      if(state.familyLinks)fresh.familyLinks=state.familyLinks;
      if(state.alertPreferences)fresh.alertPreferences=state.alertPreferences;
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, fresh);
      return fresh;
    });
  }

  privateRead(key) {
    this.#assertOpen();
    const row = this.#db.prepare('SELECT valueJson FROM private_records WHERE key = ?').get(key);
    return row ? JSON.parse(row.valueJson) : null;
  }

  privateWrite(key, value) {
    this.#assertOpen();
    this.#db.prepare('INSERT INTO private_records (key, valueJson) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET valueJson = excluded.valueJson').run(key, JSON.stringify(value));
  }

  withUsers(userIds, fn) {
    this.#assertOpen();
    const ids = [...new Set(userIds)];
    return this.#immediate(() => {
      const states = ids.map(id => {
        const row = this.#statements.getUser.get(id);
        if (!row) throw new Error('USER_NOT_FOUND');
        const state = JSON.parse(row.stateJson);
        state.products = clone(PRODUCT_CATALOG);
        ensureOwnFunds(state);
        ensureServices(state);
        return state;
      });
      const result = fn(states);
      if (result && typeof result.then === 'function') throw new Error('withUsers callback must be synchronous');
      states.forEach(state => this.#statements.updateUser.run(JSON.stringify(state), state.userId));
      return result === undefined ? undefined : clone(result);
    });
  }

  updateWithSecurity(userId, fn) {
    return this.withUsers([userId], ([state]) => {
      const security = this.privateRead(`security:${userId}`) ?? {};
      const result = fn(state, security);
      this.privateWrite(`security:${userId}`, security);
      return result;
    });
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#db.close();
  }
}
