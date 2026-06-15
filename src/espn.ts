import { currentFinlandClockMillis, finlandClockDate, normalizeTeamName, type ApiGame } from "./worldcup";

const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
const FINLAND_OFFSET_MS = 3 * 60 * 60 * 1000;
const MATCH_TIME_TOLERANCE_MS = 4 * 60 * 60 * 1000;

type EspnAthlete = {
  displayName?: string;
  shortName?: string;
  fullName?: string;
};

type EspnDetail = {
  clock?: { displayValue?: string };
  team?: { id?: string };
  scoringPlay?: boolean;
  penaltyKick?: boolean;
  ownGoal?: boolean;
  athletesInvolved?: EspnAthlete[];
  participants?: { athlete?: EspnAthlete }[];
};

type EspnCompetitor = {
  homeAway?: "home" | "away";
  score?: string;
  team?: {
    id?: string;
    displayName?: string;
    shortDisplayName?: string;
    name?: string;
  };
};

type EspnEvent = {
  id: string;
  name?: string;
  date?: string;
  status?: {
    displayClock?: string;
    type?: {
      state?: "pre" | "in" | "post";
      completed?: boolean;
    };
  };
  competitions?: {
    competitors?: EspnCompetitor[];
    details?: EspnDetail[];
  }[];
};

type EspnScoreboard = {
  events?: EspnEvent[];
};

const TEAM_ALIASES: Record<string, string> = {
  turkiye: "turkey",
  usa: "united states",
  us: "united states",
  "cote d ivoire": "ivory coast",
  curacao: "curacao",
  "bosnia herzegovina": "bosnia and herzegovina",
  "bosnia hertsegovina": "bosnia and herzegovina",
  czechia: "czech republic",
  "korea republic": "south korea",
};

function canonicalTeam(name?: string) {
  const normalized = normalizeTeamName(name ?? "");
  return TEAM_ALIASES[normalized] ?? normalized;
}

function dateParamFromFinlandMillis(millis: number) {
  const date = new Date(millis - FINLAND_OFFSET_MS);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function espnFinlandMillis(event: EspnEvent) {
  if (!event.date) return undefined;
  const utcMillis = Date.parse(event.date);
  if (!Number.isFinite(utcMillis)) return undefined;
  return utcMillis + FINLAND_OFFSET_MS;
}

function eventTeams(event: EspnEvent) {
  const competitors = event.competitions?.[0]?.competitors ?? [];
  const home = competitors.find((item) => item.homeAway === "home");
  const away = competitors.find((item) => item.homeAway === "away");
  return {
    home,
    away,
    homeName: canonicalTeam(home?.team?.displayName ?? home?.team?.shortDisplayName ?? home?.team?.name),
    awayName: canonicalTeam(away?.team?.displayName ?? away?.team?.shortDisplayName ?? away?.team?.name),
  };
}

function gameTeams(game: ApiGame) {
  return {
    homeName: canonicalTeam(game.home_team_name_en ?? game.home_team_label),
    awayName: canonicalTeam(game.away_team_name_en ?? game.away_team_label),
  };
}

function sameTeams(game: ApiGame, event: EspnEvent) {
  const gamePair = gameTeams(game);
  const eventPair = eventTeams(event);
  return gamePair.homeName === eventPair.homeName && gamePair.awayName === eventPair.awayName;
}

function sameKickoff(game: ApiGame, event: EspnEvent) {
  const gameTime = finlandClockDate(game)?.getTime();
  const eventTime = espnFinlandMillis(event);
  if (!gameTime || !eventTime) return true;
  return Math.abs(gameTime - eventTime) <= MATCH_TIME_TOLERANCE_MS;
}

function findEspnEvent(game: ApiGame, events: EspnEvent[]) {
  return events.find((event) => sameTeams(game, event) && sameKickoff(game, event));
}

function quoteScorer(name: string, minute: string, marker: string) {
  const safeName = name.replace(/"/g, "'");
  return `"${safeName} ${minute}${marker}"`;
}

function scorerPayload(details: EspnDetail[], teamId?: string) {
  const scorers = details
    .filter((detail) => detail.scoringPlay && detail.team?.id === teamId)
    .map((detail) => {
      const athlete = detail.athletesInvolved?.[0] ?? detail.participants?.[0]?.athlete;
      const name = athlete?.shortName || athlete?.displayName || athlete?.fullName;
      if (!name) return undefined;
      const minute = detail.clock?.displayValue || "";
      const marker = detail.ownGoal ? "(OG)" : detail.penaltyKick ? "(p)" : "";
      return quoteScorer(name, minute, marker);
    })
    .filter(Boolean);

  return scorers.length ? `{${scorers.join(",")}}` : "null";
}

function applyEspnEvent(game: ApiGame, event: EspnEvent): ApiGame {
  const competition = event.competitions?.[0];
  const details = competition?.details ?? [];
  const { home, away } = eventTeams(event);
  const status = event.status?.type;
  const state = status?.state;

  return {
    ...game,
    home_score: home?.score ?? game.home_score,
    away_score: away?.score ?? game.away_score,
    home_scorers: scorerPayload(details, home?.team?.id),
    away_scorers: scorerPayload(details, away?.team?.id),
    finished: status?.completed || state === "post" ? "TRUE" : "FALSE",
    time_elapsed: state === "in" ? (event.status?.displayClock || "live") : state === "post" ? "finished" : "notstarted",
  };
}

async function fetchScoreboard(date: string) {
  const response = await fetch(`${ESPN_SCOREBOARD}?dates=${date}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`ESPN ${date} HTTP ${response.status}`);
  return (await response.json()) as EspnScoreboard;
}

export async function enrichGamesWithEspn(games: ApiGame[]): Promise<ApiGame[]> {
  const now = currentFinlandClockMillis();
  const dates = new Set<string>();
  for (let offset = -1; offset <= 2; offset++) {
    dates.add(dateParamFromFinlandMillis(now + offset * 24 * 60 * 60 * 1000));
  }

  const scoreboards = await Promise.all([...dates].map(fetchScoreboard));
  const events = scoreboards.flatMap((board) => board.events ?? []);

  return games.map((game) => {
    const event = findEspnEvent(game, events);
    return event ? applyEspnEvent(game, event) : game;
  });
}
