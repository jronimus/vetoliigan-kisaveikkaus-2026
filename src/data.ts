export const PLAYERS = ["Santeri", "Sami", "Ilpo", "Joni"] as const;

export type PlayerName = (typeof PLAYERS)[number];

export type Prediction = {
  matchId: string;
  home: number;
  away: number;
  locked: boolean;
};

export type BonusPicks = {
  champion: string;
  topScorer: string;
  surprise: string;
  flop: string;
};

export type PlayerState = {
  name: PlayerName;
  predictions: Prediction[];
  bonus: BonusPicks;
};

export const LOCK_DATE_LABEL = "12.06. klo 22.00 Suomen aikaa";

export const SEEDED_PLAYERS: PlayerState[] = [
  {
    name: "Santeri",
    predictions: [
      { matchId: "1", home: 2, away: 1, locked: true },
      { matchId: "2", home: 1, away: 1, locked: true },
    ],
    bonus: { champion: "", topScorer: "", surprise: "", flop: "" },
  },
  {
    name: "Sami",
    predictions: [
      { matchId: "1", home: 2, away: 0, locked: true },
      { matchId: "2", home: 1, away: 2, locked: true },
    ],
    bonus: { champion: "", topScorer: "", surprise: "", flop: "" },
  },
  {
    name: "Ilpo",
    predictions: [
      { matchId: "1", home: 5, away: 1, locked: true },
      { matchId: "2", home: 2, away: 2, locked: true },
    ],
    bonus: { champion: "", topScorer: "", surprise: "", flop: "" },
  },
  {
    name: "Joni",
    predictions: [
      { matchId: "1", home: 3, away: 0, locked: true },
      { matchId: "2", home: 2, away: 2, locked: true },
    ],
    bonus: { champion: "", topScorer: "", surprise: "", flop: "" },
  },
];

export const TEAM_FI: Record<string, string> = {
  Mexico: "Meksiko",
  "South Africa": "Etelä-Afrikka",
  "South Korea": "Etelä-Korea",
  "Czech Republic": "Tsekki",
  Canada: "Kanada",
  "Bosnia and Herzegovina": "Bosnia ja Hertsegovina",
  "United States": "Yhdysvallat",
  Paraguay: "Paraguay",
  Brazil: "Brasilia",
  Morocco: "Marokko",
  Germany: "Saksa",
  Netherlands: "Hollanti",
  Japan: "Japani",
  Spain: "Espanja",
  France: "Ranska",
  Argentina: "Argentiina",
  Portugal: "Portugali",
  England: "Englanti",
  Scotland: "Skotlanti",
  Turkey: "Turkki",
  "Ivory Coast": "Norsunluurannikko",
  "Cape Verde": "Kap Verde",
  Tunisia: "Tunisia",
  Egypt: "Egypti",
  Iraq: "Irak",
  Uzbekistan: "Uzbekistan",
  Colombia: "Kolumbia",
  Ecuador: "Ecuador",
  "New Zealand": "Uusi-Seelanti",
  "Saudi Arabia": "Saudi-Arabia",
  Austria: "Itävalta",
  Ghana: "Ghana",
  Norway: "Norja",
  "Democratic Republic of the Congo": "Kongon demokraattinen tasavalta",
  Qatar: "Qatar",
  Switzerland: "Sveitsi",
  Curaçao: "Curacao",
  Sweden: "Ruotsi",
  Algeria: "Algeria",
  Jordan: "Jordania",
  Haiti: "Haiti",
  Australia: "Australia",
  Belgium: "Belgia",
  Iran: "Iran",
  Croatia: "Kroatia",
};
