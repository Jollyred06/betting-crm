// Difese del server: intestazioni, freno alle scritture ripetute, rete di sicurezza. Senza rete e senza database.
const assert = require('assert');
const H = require('../services/hardening');
const res = () => { const r = { h: {}, code: 200, body: null, set(o, v) { if (typeof o === 'string') this.h[o] = v; else Object.assign(this.h, o); return this; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; return r; };

// intestazioni
let r = res(), called = false; H.securityHeaders({}, r, () => { called = true; });
assert.ok(called && r.h['X-Content-Type-Options'] === 'nosniff' && r.h['X-Frame-Options'] === 'DENY' && r.h['Referrer-Policy'] === 'no-referrer');

// freno: le letture passano sempre, le scritture si fermano dopo il massimo e ripartono dopo la finestra
let t = 0; const lim = H.writeLimiter({ max: 3, windowMs: 60000, now: () => t });
const go = (method, ip = '1.1.1.1') => { const rr = res(); let ok = false; lim({ method, ip }, rr, () => { ok = true; }); return { ok, code: rr.code, rr }; };
for (let i = 0; i < 100; i++) assert.ok(go('GET').ok);
assert.ok(go('POST').ok && go('POST').ok && go('DELETE').ok);
const blocked = go('POST'); assert.ok(!blocked.ok && blocked.code === 429 && blocked.rr.h['Retry-After'] === '60');
assert.ok(go('POST', '2.2.2.2').ok, 'un altro indirizzo non e\' bloccato');
t = 61000; assert.ok(go('POST').ok, 'dopo la finestra riparte');

// rete di sicurezza: registra i gestori e non lancia
const handlers = {}, logs = []; H.installProcessGuards({ on: (n, f) => { handlers[n] = f; } }, { error: (...a) => logs.push(a.join(' ')) });
handlers.unhandledRejection(new Error('x')); handlers.uncaughtException(new Error('y'));
assert.strictEqual(logs.length, 2);
console.log('difese del server: ok');
