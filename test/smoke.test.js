/**
 * 🔎 PROVA GENERALE (20 novembre 2026). Tre controlli che i test dei singoli pezzi non fanno:
 * 1. tutti i moduli del server si caricano insieme (un errore di battitura in un file non testato fermerebbe Render);
 * 2. ogni indirizzo /api/tracker/... chiamato dall'app esiste davvero nel server (app e server allineati);
 * 3. ogni funzione esportata e' davvero una funzione o un valore (niente esportazioni di nomi che non esistono piu').
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
// 1. caricamento
const mods = {};
for (const f of fs.readdirSync(path.join(root, 'services')).filter(f => f.endsWith('.js'))) mods[f] = require(path.join(root, 'services', f));
const router = require(path.join(root, 'routes', 'tracker'));
// 2. indirizzi chiamati dall'app contro quelli del server
const routes = router.stack.filter(l => l.route).map(l => ({ path: l.route.path, methods: Object.keys(l.route.methods) }));
const toRe = p => new RegExp('^' + p.replace(/:[^/]+/g, '[^/]+') + '$');
const html = fs.readFileSync(path.join(root, 'public', 'app.html'), 'utf8');
const called = [...new Set([...html.matchAll(/['"`]\/api\/tracker(\/[a-zA-Z0-9\-\/.]*)/g)].map(m => m[1].replace(/\/$/, '')))].filter(p => p && !p.endsWith('-'));
const missing = called.filter(p => !routes.some(r => toRe(r.path).test(p) || toRe(r.path).test(p + '/x') || r.path.startsWith(p + '/')));
assert.deepStrictEqual(missing, [], 'indirizzi usati dall\'app che il server non ha: ' + missing.join(', '));
// 3. esportazioni
for (const [f, m] of Object.entries(mods)) for (const [k, v] of Object.entries(m || {})) assert.ok(v !== undefined, `${f}: esporta "${k}" che non esiste`);
console.log(`prova generale: ok (${Object.keys(mods).length} moduli, ${called.length} indirizzi dell'app tutti presenti)`);
