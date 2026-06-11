import { finlandClockDate, teamName, type ApiGame } from "./worldcup";
import { TEAM_FI } from "./data";

const RAW_SCHEDULE = `
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

Sunnuntai 19.7.
Pronssiottelu klo 00.00 (MTV Katsomo+ Urheilu ja MTV3)
Finaali klo 22.00 (Yle Areena ja Yle TV2)
`;

const TEAM_ALIASES: Record<string, string> = {
  ...TEAM_FI,
  Tshekki: "Tsekki",
  "Tšekki": "Tsekki",
  "Bosnia ja Hertsegovina": "Bosnia ja Hertsegovina",
  "Kongon demokraattinen tasavalta": "Kongon demokraattinen tasavalta",
  "Norsunluurannikko": "Norsunluurannikko",
  Curaçao: "Curaçao",
  "Kap Verde": "Kap Verde",
  "Uusi-Seelanti": "Uusi-Seelanti",
};

type TvEntry = { home: string; away: string; time: string; channels: string[] };

function normalize(text: string) {
  return text.replace(/\s+/g, " ").replace(/[.]/g, "").trim();
}

function normalizeTeamFi(name: string) {
  return TEAM_ALIASES[name] ?? name;
}

const tvEntries: TvEntry[] = RAW_SCHEDULE
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.includes("(") && line.includes(")") && line.includes("–"))
  .map((line) => {
    const match = line.match(/^(.*?)\s+–\s+(.*?)\s+(?:klo\s+)?(\d{1,2}\.\d{2})\s+\((.*?)\)$/);
    if (!match) return null;
    const [, home, away, time, channels] = match;
    return {
      home: normalizeTeamFi(normalize(home)),
      away: normalizeTeamFi(normalize(away)),
      time,
      channels: channels.split(/\s+ja\s+/).map((item) => normalize(item)),
    };
  })
  .filter((item): item is TvEntry => Boolean(item));

export function tvChannelsForGame(game: ApiGame) {
  const kickoff = finlandClockDate(game);
  const time = kickoff
    ? new Intl.DateTimeFormat("fi-FI", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(kickoff).replace(":", ".")
    : "";
  const home = normalizeTeamFi(teamName(game, "home"));
  const away = normalizeTeamFi(teamName(game, "away"));

  const exact = tvEntries.find((entry) => entry.home === home && entry.away === away && entry.time === time);
  if (exact) return exact.channels;

  if (game.type === "final") {
    const finalEntry = tvEntries.find((entry) => entry.home === "Pronssiottelu");
    const properFinal = tvEntries.find((entry) => entry.home === "Finaali" || entry.away === "Finaali");
    return properFinal?.channels ?? finalEntry?.channels ?? [];
  }

  return [];
}
