// L'app e' un solo script: due funzioni con lo stesso nome si sovrascrivono in silenzio e rompono una scheda (successo il 14/11 con calibCard).
const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'app.html'), 'utf8');
const script = (html.match(/<script>([\s\S]*?)<\/script>/g) || []).map(s => s.replace(/<\/?script>/g, '')).sort((a, b) => b.length - a.length)[0];
const names = [...script.matchAll(/^\s*(?:async\s+)?function\s+(\w+)\s*\(/gm)].map(m => m[1]);
const dup = names.filter((n, i) => names.indexOf(n) !== i);
assert.deepStrictEqual(dup, [], 'funzioni con lo stesso nome in app.html: ' + dup.join(', '));
new Function(script);   // sintassi
console.log('app: nessuna funzione doppia: ok');
