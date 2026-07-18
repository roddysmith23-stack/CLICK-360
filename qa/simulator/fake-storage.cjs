'use strict';

const crypto = require('node:crypto');

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function hash(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

class FakeLocalStore {
  constructor({ quotaBytes = Number.MAX_SAFE_INTEGER, blocked = false } = {}) {
    this.quotaBytes = quotaBytes;
    this.blocked = blocked;
    this.map = new Map();
  }

  setItem(key, value) {
    if (this.blocked) {
      const error = new Error('Fake localStorage blocked');
      error.name = 'QuotaExceededError';
      throw error;
    }
    const text = String(value);
    if (Buffer.byteLength(text, 'utf8') > this.quotaBytes) {
      const error = new Error('Fake localStorage quota exceeded');
      error.name = 'QuotaExceededError';
      throw error;
    }
    this.map.set(String(key), text);
  }

  getItem(key) {
    return this.map.has(String(key)) ? this.map.get(String(key)) : null;
  }

  removeItem(key) {
    this.map.delete(String(key));
  }
}

class FakeCloud {
  constructor(initialState) {
    this.revision = 0;
    this.state = JSON.parse(JSON.stringify(initialState));
    this.history = [{ revision: this.revision, hash: hash(this.state) }];
  }

  read() {
    return { revision: this.revision, state: JSON.parse(JSON.stringify(this.state)), hash: hash(this.state) };
  }

  write(nextState, { expectedRevision = this.revision, reason = 'qa_write' } = {}) {
    if (expectedRevision !== this.revision) {
      return { ok: false, reason: 'revision_conflict', current: this.read() };
    }
    this.revision += 1;
    this.state = JSON.parse(JSON.stringify(nextState));
    const entry = { revision: this.revision, hash: hash(this.state), reason };
    this.history.push(entry);
    return { ok: true, ...entry };
  }
}

module.exports = { FakeCloud, FakeLocalStore, hash, stableJson };
