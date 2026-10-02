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
// serie minori viste nel log dal vivo (nomi dei file reali)
csv.E2 = ['AFC Wimbledon', 'Bristol Rvs', 'Sheffield Weds', 'Wigan']; csv.E3 = ['Bristol Rvs', 'Bristol City', 'Port Vale']; csv.SP2 = ['Sp Gijon', 'Celta B', 'Sociedad B', 'Almeria']; csv.F2 = ['St Etienne', 'Paris FC', 'Reims'];
api.E2 = [['Wimbledon', 'AFC Wimbledon'], ['Sheffield Wednesday', 'Sheffield Weds'], ['Bristol Rovers', 'Bristol Rvs']];
api.E3 = [['Bristol Rovers', 'Bristol Rvs']]; api.SP2 = [['Sporting Gijón', 'Sp Gijon'], ['Celta Fortuna', 'Celta B']]; api.F2 = [['Saint Etienne', 'St Etienne'], ['AS Saint-Étienne', 'St Etienne']];
// campionati coperti da football-data.org: nomi come li scrive football-data.org contro i nomi dei file (25/26)
csv.PL = ['Man City', 'Man United', "Nott'm Forest", 'Wolves', 'Tottenham', 'Newcastle', 'Brighton', 'West Ham', 'Leeds', 'Bournemouth', 'Crystal Palace'];
api.PL = [['Manchester City FC', 'Man City'], ['Manchester United FC', 'Man United'], ['Nottingham Forest FC', "Nott'm Forest"], ['Wolverhampton Wanderers FC', 'Wolves'], ['Tottenham Hotspur FC', 'Tottenham'],
  ['Newcastle United FC', 'Newcastle'], ['Brighton & Hove Albion FC', 'Brighton'], ['West Ham United FC', 'West Ham'], ['Leeds United FC', 'Leeds'], ['AFC Bournemouth', 'Bournemouth'], ['Crystal Palace FC', 'Crystal Palace']];
csv.PD = ['Ath Bilbao', 'Ath Madrid', 'Betis', 'Celta', 'Espanol', 'Sociedad', 'Vallecano', 'Alaves', 'Osasuna', 'Real Madrid', 'Barcelona'];
api.PD = [['Athletic Club', 'Ath Bilbao'], ['Club Atlético de Madrid', 'Ath Madrid'], ['Real Betis Balompié', 'Betis'], ['RC Celta de Vigo', 'Celta'], ['RCD Espanyol de Barcelona', 'Espanol'],
  ['Real Sociedad de Fútbol', 'Sociedad'], ['Rayo Vallecano de Madrid', 'Vallecano'], ['Deportivo Alavés', 'Alaves'], ['CA Osasuna', 'Osasuna'], ['Real Madrid CF', 'Real Madrid'], ['FC Barcelona', 'Barcelona']];
csv.FL1 = ['Paris SG', 'Lyon', 'Rennes', 'Brest', 'St Etienne', 'Marseille', 'Le Havre', 'Lille'];
api.FL1 = [['Paris Saint-Germain FC', 'Paris SG'], ['Olympique Lyonnais', 'Lyon'], ['Stade Rennais FC 1901', 'Rennes'], ['Stade Brestois 29', 'Brest'], ['AS Saint-Étienne', 'St Etienne'], ['Olympique de Marseille', 'Marseille'], ['Le Havre AC', 'Le Havre'], ['LOSC Lille', 'Lille']];
csv.BL1 = ['Bayern Munich', 'Dortmund', 'Ein Frankfurt', "M'gladbach", 'Hamburg', 'FC Koln', 'St Pauli', 'Leverkusen', 'Union Berlin', 'Mainz'];
api.BL1 = [['FC Bayern München', 'Bayern Munich'], ['Borussia Dortmund', 'Dortmund'], ['Eintracht Frankfurt', 'Ein Frankfurt'], ['Borussia Mönchengladbach', "M'gladbach"], ['Hamburger SV', 'Hamburg'],
  ['1. FC Köln', 'FC Koln'], ['FC St. Pauli 1910', 'St Pauli'], ['Bayer 04 Leverkusen', 'Leverkusen'], ['1. FC Union Berlin', 'Union Berlin'], ['1. FSV Mainz 05', 'Mainz']];
csv.DED = ['PSV Eindhoven', 'AZ Alkmaar', 'Nijmegen', 'For Sittard', 'Ajax', 'Feyenoord', 'Twente', 'Heracles'];
api.DED = [['PSV', 'PSV Eindhoven'], ['AZ', 'AZ Alkmaar'], ['NEC', 'Nijmegen'], ['Fortuna Sittard', 'For Sittard'], ['AFC Ajax', 'Ajax'], ['Feyenoord Rotterdam', 'Feyenoord'], ["FC Twente '65", 'Twente'], ['Heracles Almelo', 'Heracles']];
csv.PPL = ['Sp Lisbon', 'Sp Braga', 'Guimaraes', 'Benfica', 'Porto', 'Estrela', 'Famalicao'];
api.PPL = [['Sporting Clube de Portugal', 'Sp Lisbon'], ['SC Braga', 'Sp Braga'], ['Vitória SC', 'Guimaraes'], ['SL Benfica', 'Benfica'], ['FC Porto', 'Porto'], ['Estrela da Amadora', 'Estrela'], ['FC Famalicão', 'Famalicao']];
csv.ELC = ['QPR', 'Sheffield Weds', 'Sheffield United', 'West Brom', 'Bristol City', 'Preston', 'Hull', 'Oxford'];
api.ELC = [['Queens Park Rangers FC', 'QPR'], ['Sheffield Wednesday FC', 'Sheffield Weds'], ['Sheffield United FC', 'Sheffield United'], ['West Bromwich Albion FC', 'West Brom'], ['Bristol City FC', 'Bristol City'],
  ['Preston North End FC', 'Preston'], ['Hull City AFC', 'Hull'], ['Oxford United FC', 'Oxford']];
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
assert.strictEqual(resolveHistoryTeam('Manchester City', ['Man City', 'Man United']), 'Man City');   // abbreviazione 'Man' = Manchester (sinonimo esplicito)
assert.strictEqual(resolveHistoryTeam('Manchester City', ['Leicester City', 'Bristol City']), null);   // solo 'City' in comune: mai abbinato
assert.strictEqual(resolveHistoryTeam('Amed SK', ['Amedspor', 'Amedspor Genclik']), null);     // due candidati: ambiguo
console.log(`nomi dei 4 campionati nuovi: ${n} casi ok`);
