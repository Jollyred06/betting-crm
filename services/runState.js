/** Stato del giro giornaliero rispetto all'orologio italiano. */
function romeParts(d) {
  const o = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(d)).forEach(x => { o[x.type] = x.value; });
  return { ymd: `${o.year}-${o.month}-${o.day}`, mins: Number(o.hour) * 60 + Number(o.minute) };
}

/** Oggi (ora italiana) c'e' gia' un giro riuscito, partito dalle 10:50 in poi? Serve al giro di riserva. */
async function ranToday(pool, now = new Date()) {
  const { rows } = await pool.query(`SELECT run_at FROM run_logs WHERE success = TRUE ORDER BY run_at DESC LIMIT 1`);
  if (!rows[0]) return false;
  const n = romeParts(now), l = romeParts(rows[0].run_at);
  return l.ymd === n.ymd && l.mins >= 10 * 60 + 50;
}

module.exports = { romeParts, ranToday };
