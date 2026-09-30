// Nomi squadra dei campionati non coperti da football-data.org, verificati sui nomi REALI dei file di football-data.co.uk.
const assert = require('assert');
const { resolveHistoryTeam, tokens } = require('../services/teamNames');
const csv = {
  T1: ['Ad. Demirspor', 'Alanyaspor', 'Antalyaspor', 'Besiktas', 'Bodrumspor', 'Buyuksehyr', 'Eyupspor', 'Fenerbahce', 'Galatasaray', 'Gaziantep', 'Genclerbirligi', 'Goztep', 'Hatayspor', 'Karagumruk', 'Kasimpasa', 'Kayserispor', 'Kocaelispor', 'Konyaspor', 'Rizespor', 'Samsunspor', 'Sivasspor', 'Trabzonspor'],
  G1: ['AEK', 'Aris', 'Asteras Tripolis', 'Athens Kallithea', 'Atromitos', 'Kifisia', 'Lamia', 'Larisa', 'Levadeiakos', 'OFI Crete', 'Olympiakos', 'PAOK', 'Panathinaikos', 'Panetolikos', 'Panserraikos', 'Volos NFC'],
  B1: ['Anderlecht', 'Antwerp', 'Beerschot VA', 'Cercle Brugge', 'Charleroi', 'Club Brugge', 'Dender', 'Genk', 'Gent', 'Kortrijk', 'Mechelen', 'Oud-Heverlee Leuven', 'RAAL La Louviere', 'St Truiden', 'St. Gilloise', 'Standard', 'Waregem', 'Westerlo'],
  SC0: ['Aberdeen', 'Celtic', 'Dundee', 'Dundee United', 'Falkirk', 'Hearts', 'Hibernian', 'Kilmarnock', 'Livingston', 'Motherwell', 'Rangers', 'Ross County', 'St Johnstone', 'St Mirren']
};
// nomi come potrebbe scriverli The Odds API (ipotesi ragionevoli: non li ho visti dal vivo, per questo il log elenca quelli non riconosciuti)
const api = {
  T1: [['Galatasaray SK', 'Galatasaray'], ['Fenerbahçe', 'Fenerbahce'], ['Beşiktaş', 'Besiktas'], ['Kasımpaşa', 'Kasimpasa'], ['Istanbul Basaksehir', 'Buyuksehyr'], ['Göztepe', 'Goztep'],
       ['Çaykur Rizespor', 'Rizespor'], ['Gaziantep FK', 'Gaziantep'], ['Bodrum FK', 'Bodrumspor'], ['Fatih Karagümrük', 'Karagumruk'], ['Trabzonspor', 'Trabzonspor'], ['Samsunspor', 'Samsunspor']],
  G1: [['Olympiacos Piraeus', 'Olympiakos'], ['AEK Athens', 'AEK'], ['PAOK Salonika', 'PAOK'], ['Aris Thessaloniki', 'Aris'], ['Larissa', 'Larisa'], ['Levadiakos', 'Levadeiakos'], ['Volos', 'Volos NFC'], ['Asteras Tripoli', 'Asteras Tripolis'], ['Panathinaikos', 'Panathinaikos']],
  B1: [['Club Brugge KV', 'Club Brugge'], ['RSC Anderlecht', 'Anderlecht'], ['Sint-Truidense', 'St Truiden'], ['Union Saint-Gilloise', 'St. Gilloise'], ['Royal Antwerp FC', 'Antwerp'], ['Beerschot', 'Beerschot VA'], ['KRC Genk', 'Genk'], ['Standard Liège', 'Standard'], ['Oud-Heverlee Leuven', 'Oud-Heverlee Leuven'], ['KVC Westerlo', 'Westerlo']],
  SC0: [['Heart of Midlothian', 'Hearts'], ['Dundee FC', 'Dundee'], ['Dundee United', 'Dundee United'], ['St Mirren', 'St Mirren'], ['Celtic', 'Celtic'], ['Rangers', 'Rangers']]
};
// nomi visti nel primo giro dal vivo: non riconosciuti prima di questa correzione
csv.T1 = [...csv.T1, 'Amedspor', 'Erzurumspor']; // ipotesi sul nome nel file (le neopromosse): il ripiego per prefisso li deve trovare
api.T1.push(['Amed SK', 'Amedspor'], ['Erzurum BB', 'Erzurumspor']);
api.G1.push(['Volos FC', 'Volos NFC']); api.B1.push(['Leuven', 'Oud-Heverlee Leuven']);
let n = 0;
for (const [lg, list] of Object.entries(api)) for (const [name, expected] of list) {
  const r = resolveHistoryTeam(name, csv[lg]); n++;
  assert.strictEqual(r, expected, `${lg}: "${name}" -> ${r} (atteso ${expected})`);
}
assert.strictEqual(resolveHistoryTeam('Dundee United', csv.SC0), 'Dundee United');   // non confondere con Dundee
assert.strictEqual(resolveHistoryTeam('Squadra Inventata', csv.T1), null);           // nel dubbio: non riconosciuto, non indovinato
assert.deepStrictEqual(tokens('Kasımpaşa'), ['kasimpasa']);
// il ripiego per prefisso non deve inventare abbinamenti
assert.strictEqual(resolveHistoryTeam('Bristol City', ['Bristol Rvs', 'Leicester City']), null);
assert.strictEqual(resolveHistoryTeam('Manchester City', ['Man City', 'Man United']), null);   // 'man' e' troppo corto: nel dubbio non riconosciuto
assert.strictEqual(resolveHistoryTeam('Amed SK', ['Amedspor', 'Amedspor Genclik']), null);     // due candidati: ambiguo
console.log(`nomi dei 4 campionati nuovi: ${n} casi ok`);
