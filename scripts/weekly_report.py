"""Analisi settimanale dei segnali del CRM (sola lettura, nessuna chiave).
Uso: python3 scripts/weekly_report.py [URL]   (predefinito: https://betting-crm.onrender.com)
Stampa per F, F2, F3, I, B: segnali misurati, valore medio contro la chiusura, fascia al 95%, quota sopra la chiusura;
sia su tutto lo storico sia sugli ultimi 7 giorni. Poi bookmaker, richieste odss e stato dei risultati."""
import json, math, sys, urllib.request
from datetime import datetime, timedelta, timezone

URL = (sys.argv[1] if len(sys.argv) > 1 else 'https://betting-crm.onrender.com').rstrip('/') + '/api/tracker/italia-export'
d = json.load(urllib.request.urlopen(URL, timeout=120))
S = d['signals']
now = datetime.now(timezone.utc)
week = now - timedelta(days=7)
ts = lambda s: datetime.fromisoformat(s.replace('Z', '+00:00'))

def stat(rows):
    v = [float(r['clv_pct']) for r in rows if r.get('clv_pct') is not None]
    n = len(v)
    if n == 0: return 'nessuno misurato'
    m = sum(v) / n
    if n < 5: return f'{n} misurati, media {m:+.2f}% (pochi dati)'
    sd = math.sqrt(sum((x - m) ** 2 for x in v) / (n - 1)); h = 1.96 * sd / math.sqrt(n)
    pos = 100 * sum(x > 0 for x in v) / n
    verdict = 'SOPRA ZERO' if m - h > 0 else ('SOTTO ZERO' if m + h < 0 else 'incerto')
    return f'{n} misurati, {m:+.2f}% (da {m-h:+.1f} a {m+h:+.1f}) {verdict}, positivi {pos:.0f}%'

nd = lambda r: not r.get('dup')   # le riletture vicino al calcio d'inizio contano solo per la F2
groups = [('F', lambda r: r['f']), ('F2', lambda r: r['f2']), ('F3', lambda r: r['f3']),
          ('I', lambda r: r['strategy'] == 'I' and nd(r)), ('B', lambda r: r['strategy'] == 'B' and nd(r))]
print(f"Analisi del {now:%d/%m/%Y %H:%M} UTC, {len(S)} segnali in totale\n")
for name, f in groups:
    rows = [r for r in S if f(r)]
    recent = [r for r in rows if ts(r['created_at']) >= week]
    print(f"{name:3} totale:  {stat(rows)}")
    print(f"{'':3} 7 giorni: {stat(recent)}")
print('\nBookmaker (strategia I):')
S1 = [r for r in S if nd(r)]
for b in sorted({r['book'] for r in S1 if r['strategy'] == 'I'}):
    print(f"  {b:12} {stat([r for r in S1 if r['strategy'] == 'I' and r['book'] == b])}")
print('\nEsiti (strategia I):')
for k, lab in [('home', '1'), ('draw', 'X'), ('away', '2')]:
    print(f"  {lab}  {stat([r for r in S1 if r['strategy'] == 'I' and r['selection'] == k])}")
nw = [{'clv_pct': r['netwin_clv_pct']} for r in S1 if r['strategy'] == 'I' and r.get('netwin_clv_pct') is not None]
print(f"\nNetwin sempre: {stat(nw)}")
print(f"\nRichieste odss rimaste: {d.get('quotaRemaining')} | ultimi giorni: " + ', '.join(f"{x['day'][5:]}={x['n']}" for x in d.get('requestsByDay', [])))
lr = d.get('lastResults') or []
print('Risultati: ' + ('; '.join(f"{x['src']} {'ok' if x['ok'] else 'errore: ' + str(x.get('note'))[:60]}" for x in lr) or 'nessuna lettura'))
