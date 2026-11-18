// Minimal JSON-file persistence. Production: PostgreSQL + Redis + Kafka (see blueprint section 13).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { seed } = require('./seed');

const DATA_DIR = process.env.DXP_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');

let db;
let timer = null;

function load({ reset = false } = {}) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!reset && fs.existsSync(FILE)) {
    db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } else {
    db = seed();
    saveNow();
  }
  return db;
}
function saveNow() { fs.writeFileSync(FILE, JSON.stringify(db, null, 1)); }
function save() { if (timer) return; timer = setTimeout(() => { timer = null; saveNow(); }, 200); }
const get = () => db;

const id = (prefix) => `${prefix}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
const sha = (obj) => 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);

// Hash-chained, append-only audit log
function audit(actor, action, entity, detail = {}) {
  const prev = db.audit.length ? db.audit[db.audit.length - 1].hash : 'GENESIS';
  const rec = { ts: new Date().toISOString(), actor, action, entity, detail };
  rec.hash = crypto.createHash('sha256').update(prev + JSON.stringify(rec)).digest('hex').slice(0, 24);
  rec.prevHash = prev;
  db.audit.push(rec);
  save();
  return rec;
}

// Event store (append-only). Production: Kafka -> Postgres (360) + ClickHouse (analytics)
function recordEvent(ev) {
  db.seq += 1;
  const rec = { eventId: id('EV'), seq: db.seq, ts: ev.ts || new Date().toISOString(), configVersion: db.active.configVersion, ...ev };
  db.events.push(rec);
  if (db.events.length > 20000) db.events.splice(0, db.events.length - 20000);
  save();
  return rec;
}

module.exports = { load, get, save, saveNow, id, sha, audit, recordEvent };
