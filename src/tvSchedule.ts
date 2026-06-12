import { finlandClockDate, teamName, type ApiGame } from "./worldcup";
import { TEAM_FI } from "./data";

const RAW_SCHEDULE = `
Jalkapallon MM-kisojen 2026 otteluohjelma
Alkulohko
Torstai 11.6.
Meksiko – Etelä-Afrikka klo 22.00 (MTV Katsomo+ Urheilu ja MTV3)

Perjantai 12.6.
Etelä-Korea – Tshekki klo 05.00 (MTV Katsomo+ Urheilu ja MTV3)
Kanada – Bosnia ja Hertsegovina klo 22.00 (Yle Areena ja Yle TV2)

Lauantai 13.6.
Yhdysvallat – Paraguay klo 04.00 (Yle Areena ja Yle TV2)
Qatar – Sveitsi klo 22.00 (MTV Katsomo+ Urheilu ja MTV3)

Sunnuntai 14.6.
Brasilia – Marokko klo 01.00 (MTV Katsomo+ Urheilu ja MTV3)
Haiti – Skotlanti 04.00 (MTV Katsomo+ Urheilu)
Australia – Turkki klo 07.00 (MTV Katsomo+ Urheilu)
Saksa – Curaçao klo 20.00 (Yle Areena ja Yle TV2)
Hollanti – Japani klo 23.00 (Yle Areena ja Yle TV2)

Maanantai 15.6.
Norsunluurannikko – Ecuador 02.00 (Yle Areena ja Yle TV2)
Ruotsi – Tunisia klo 05.00  (Yle Areena ja Yle TV2)
Espanja – Kap Verde klo 19.00 (Katsomo+ Urheilu ja MTV3)
Belgia – Egypti klo 22.00 (MTV Katsomo+ Urheilu ja MTV3)

Tiistai 16.6.
Saudi-Arabia – Uruguay klo 01.00 (MTV Katsomo+ Urheilu)
Iran – Uusi-Seelanti klo 04.00 (MTV Katsomo+ Urheilu)
Ranska – Senegal klo 22.00 (Yle Areena ja Yle TV2)

Keskiviikko 17.6.
Irak – Norja klo 01.00 (Yle Areena ja Yle TV2)
Argentiina – Algeria klo 04.00 (Yle Areena ja Yle TV2)
Itävalta – Jordania klo 07.00 (Yle Areena ja Yle TV2)
Portugali – Kongon demokraattinen tasavalta klo 20.00 (MTV Katsomo+ Urheilu ja MTV3)
Englanti – Kroatia klo 23.00 (MTV Katsomo+ Urheilu ja MTV3)

Torstai 18.6.
Ghana – Panama klo 02.00 (MTV Katsomo+ Urheilu)
Uzbekistan – Kolumbia klo 05.00 (MTV Katsomo+ Urheilu)
Tšekki – Etelä-Afrikka klo 19.00 (Yle Areena ja Yle TV2)
Sveitsi – Bosnia ja Hertsegovina klo 20.00 (Yle Areena ja Yle TV2)

Perjantai 19.6.
Kanada – Qatar klo 01.00 (Yle Areena ja Yle TV2)
Meksiko – Etelä-Korea klo 04.00 (Yle Areena ja Yle TV2)
Yhdysvallat – Australia klo 22.00 (MTV Katsomo+ Urheilu ja MTV3)

Lauantai 20.6.
Skotlanti – Marokko klo 01.00 (MTV Katsomo+ Urheilu ja MTV3)
Brasilia – Haiti klo 03.30 (MTV Katsomo+ Urheilu)
Turkki – Paraguay klo 06.00 (MTV Katsomo+ Urheilu)
Hollanti – Ruotsi klo 20.00 (Yle Areena ja Yle TV2)
Saksa – Norsunluurannikko klo 23.00 (Yle Areena ja Yle TV2)

Sunnuntai 21.6.
Ecuador – Curaçao klo 03.00 (Yle Areena ja Yle TV2)
Tunisia – Japani klo 07.00 (Yle Areena ja Yle TV2)
Espanja – Saudi-Arabia klo 19.00 (MTV Katsomo+ Urheilu ja MTV3)
Belgia – Iran klo 22.00  (MTV Katsomo+ Urheilu ja MTV3)

Maanantai 22.6.
Uruguay – Kap Verde klo 01.00 (MTV Katsomo+ Urheilu)
Uusi-Seelanti – Egypti klo 04.00  (MTV Katsomo+ Urheilu)
Argentiina – Itävalta klo 20.00 (Yle Areena ja Yle TV2)

Tiistai 23.6.
Ranska – Irak klo 00.00 (Yle Areena ja Yle TV2)
Norja – Senegal klo 03.00 (Yle Areena ja Yle TV2)
Jordania – Algeria klo 06.00 (Yle Areena ja Yle TV2)
Portugali – Uzbekistan klo 20.00 (MTV Katsomo+ Urheilu ja MTV3)
Englanti – Ghana klo 23.00  (MTV Katsomo+ Urheilu ja MTV3)

Keskiviikko 24.6. 
Panama – Kroatia klo 02.00  (MTV Katsomo+ Urheilu)
Kolumbia – Kongon demokraattinen tasavalta klo 05.00  (MTV Katsomo+ Urheilu)
Sveitsi – Kanada klo 22.00 (Yle Areena ja Yle TV2)
Bosnia ja Hertsegovina – Qatar klo 22.00 (Yle Areena)

Torstai 25.6.
Skotlanti – Brasilia klo 01.00 (Yle Areena ja Yle TV2)
Marokko – Haiti klo 01.00 (Yle Areena)
Tšekki – Meksiko klo 04.00 (Yle Areena ja Yle TV2)
Etelä-Afrikka – Etelä-Korea klo 04.00 (Yle Areena)
Ecuador–Saksa klo 23.00 (MTV Katsomo+ Urheilu ja MTV3)
Curaçao–Norsunluurannikko klo 23.00 (MTV Katsomo+ Urheilu)

Perjantai 26.6.
Japani – Ruotsi 02.00 (MTV Katsomo+ Urheilu ja MTV3)
Tunisia – Hollanti klo 02.00 (MTV Katsomo+ Urheilu)
Turkki – Yhdysvallat klo 05.00  (MTV Katsomo+ Urheilu)
Paraguay – Australia klo 05.00 (MTV Katsomo+ Urheilu)
Norja – Ranska klo 22.00  (Yle Areena ja Yle TV2)
Senegal – Irak klo 22.00  (Yle Areena)

Lauantai 27.6.
Kap Verde – Saudi-Arabia klo 03.00  (Yle Areena)
Uruguay – Espanja klo 03.00 (Yle Areena ja Yle TV2)
Egypti – Iran klo 06.00 (Yle Areena ja Yle TV2)
Uusi-Seelanti – Belgia klo 06.00  (Yle Areena)

Sunnuntai 28.6.
Kroatia – Ghana klo 00.00 (MTV Katsomo+ Urheilu ja MTV3)
Panama – Englanti klo 00.00 (MTV Katsomo+ Urheilu)
Kolumbia – Portugali klo 02.30 (MTV Katsomo+ Urheilu ja MTV3)
Kongon demokraattinen tasavalta – Uzbekistan klo 02.30 (MTV Katsomo+ Urheilu)
Algeria – Itävalta klo 05.00  (Yle Areena ja Yle TV2)
Jordania – Argentiina klo 05.00  (Yle Areena ja Yle TV2)

1. pudotuspelikierros
Sunnuntai 28.6.
Ottelu klo 22.00 (Yle Areena ja Yle TV2)

Maanantai 29.6.
Ottelu klo 20.00 (MTV Katsomo+ Urheilu ja MTV3)
Ottelu klo 23.30 (MTV Katsomo+ Urheilu ja MTV3)

Tiistai 30.6.
Ottelu klo 04.00 (Yle Areena ja Yle TV2)
Ottelu klo 20.00 (Yle Areena ja Yle TV2)

Keskiviikko 1.7.
Ottelu klo 00.00 (Yle Areena ja Yle TV2)
Ottelu klo 04.00 (Yle Areena ja Yle TV2)
Ottelu klo 19.00 (MTV Katsomo+ Urheilu ja MTV3)
Ottelu klo 23.00 (MTV Katsomo+ Urheilu ja MTV3)

Torstai 2.7.
Ottelu klo 03.00 (MTV Katsomo+ Urheilu)
Ottelu klo 22.00 (Yle Areena ja Yle TV2)

Perjantai 3.7.
Ottelu klo 02.00 (Yle Areena ja Yle TV2)
Ottelu klo 06.00 (Yle Areena ja Yle TV2)
Ottelu klo 21.00 (MTV Katsomo+ Urheilu ja MTV3)

Lauantai 4.7.
Ottelu klo 01.00 (MTV Katsomo+ Urheilu ja MTV3)
Ottelu klo 04.30 (MTV Katsomo+ Urheilu)

Neljännesvälierät
Lauantai 4.7.
Ottelu klo 20.00 (MTV Katsomo+ Urheilu ja MTV3)

Sunnuntai 5.7.
Ottelu klo 00.00 (MTV Katsomo+ Urheilu ja MTV3)
Ottelu klo 23.00 (Yle Areena ja Yle TV2)

Maanantai 6.7.
Ottelu klo 03.00 (Yle Areena ja Yle TV2)
Ottelu klo 22.00 (MTV Katsomo+ Urheilu ja MTV3)

Tiistai 7.7
Ottelu klo 03.00 (MTV Katsomo+ Urheilu ja MTV3)
Ottelu klo 19.00 (Yle Areena ja Yle TV2)
Ottelu klo 23.00 (Yle Areena ja Yle TV2)

Puolivälierät
Torstai 9.7.
Ottelu klo 23.00 (Yle Areena ja Yle TV2)

Perjantai 10.7.
Ottelu klo 22.00 (MTV Katsomo+ Urheilu ja MTV3)

Sunnuntai 12.7.
Ottelu klo 00.00 (Yle Areena ja Yle TV2)
Ottelu klo 04.00 (MTV Katsomo+ Urheilu ja MTV3)

Välierät
Tiistai 14.7.
Ottelu klo 22.00 (Yle Areena ja Yle TV2)

Keskiviikko 15.7.
Ottelu klo 22.00 (MTV Katsomo+ Urheilu ja MTV3)

Mitalipelit
Sunnuntai 19.7.
Pronssiottelu klo 00.00 (MTV Katsomo+ Urheilu ja MTV3)
Finaali klo 22.00 (Yle Areena ja Yle TV2)
`;

const TEAM_ALIASES: Record<string, string> = {
  Tshekki: "Tšekki",
  Tsekki: "Tšekki",
  Yhdysvallat: "USA",
  "Kap Verde": "Kap Verde",
  "Uusi-Seelanti": "Uusi-Seelanti",
};

type TvEntry = { dateStr?: string; home?: string; away?: string; type?: string; time: string; channels: string[] };

function normalize(text: string) {
  return text.replace(/\s+/g, " ").replace(/[.]/g, "").trim();
}

function normalizeTeamFi(name: string) {
  return TEAM_ALIASES[name] ?? name;
}

const tvEntries: TvEntry[] = [];
let currentDate = "";

for (let line of RAW_SCHEDULE.split("\n")) {
  line = line.trim();
  if (!line) continue;

  const dateMatch = line.match(/^[a-zäöå]+\s+(\d{1,2}\.\d{1,2}\.?)$/i);
  if (dateMatch) {
    let d = dateMatch[1];
    if (!d.endsWith(".")) d += ".";
    currentDate = d;
    continue;
  }

  // Ecuador–Saksa klo 23.00 OR Haiti – Skotlanti 04.00
  let m = line.match(/^(.*?)\s*[–-]\s*(.*?)\s+(?:klo\s+)?(\d{1,2}\.\d{2})\s+\((.*?)\)$/);
  if (m) {
    tvEntries.push({
      dateStr: currentDate,
      home: normalizeTeamFi(normalize(m[1])),
      away: normalizeTeamFi(normalize(m[2])),
      time: m[3],
      channels: m[4].split(/\s+ja\s+/).map((item) => normalize(item)),
    });
    continue;
  }

  m = line.match(/^(Ottelu|Pronssiottelu|Finaali)\s+(?:klo\s+)?(\d{1,2}\.\d{2})\s+\((.*?)\)$/i);
  if (m) {
    tvEntries.push({
      dateStr: currentDate,
      type: m[1],
      time: m[2],
      channels: m[3].split(/\s+ja\s+/).map((item) => normalize(item)),
    });
  }
}

export function tvChannelsForGame(game: ApiGame) {
  const kickoff = finlandClockDate(game);
  if (!kickoff) return [];

  const time = new Intl.DateTimeFormat("fi-FI", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })
    .format(kickoff)
    .replace(":", ".");
  const dateStr = `${kickoff.getUTCDate()}.${kickoff.getUTCMonth() + 1}.`;

  const homeEn = teamName(game, "home");
  const awayEn = teamName(game, "away");
  const home = normalizeTeamFi(TEAM_FI[homeEn] ?? homeEn);
  const away = normalizeTeamFi(TEAM_FI[awayEn] ?? awayEn);

  const exact = tvEntries.find((entry) => entry.home === home && entry.away === away && entry.time === time);
  if (exact) return exact.channels;

  if (game.type !== "group") {
    const playoff = tvEntries.find((entry) => entry.type && entry.dateStr === dateStr && entry.time === time);
    if (playoff) return playoff.channels;
  }

  return [];
}
