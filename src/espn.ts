import { currentFinlandClockMillis, finlandClockDate, normalizeTeamName, type ApiGame, isFinished, isLive } from "./worldcup";

const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
const ESPN_SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary";
const FINLAND_OFFSET_MS = 3 * 60 * 60 * 1000;
const MATCH_TIME_TOLERANCE_MS = 14 * 60 * 60 * 1000;

type EspnAthlete = {
  displayName?: string;
  shortName?: string;
  fullName?: string;
};

type EspnDetail = {
  clock?: { displayValue?: string };
  team?: { id?: string; displayName?: string };
  type?: { text?: string; type?: string };
  text?: string;
  shortText?: string;
  scoringPlay?: boolean;
  penaltyKick?: boolean;
  ownGoal?: boolean;
  redCard?: boolean;
  yellowCard?: boolean;
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
  linescores?: EspnPeriodScore[];
};

type EspnLeaderStat = {
  name?: string;
  displayValue?: string;
  value?: string | number;
};

type EspnLeaderItem = {
  summary?: string;
  statistics?: EspnLeaderStat[];
};

type EspnTeamLeaderBlock = {
  team?: {
    id?: string;
    displayName?: string;
    name?: string;
  };
  leaders?: Array<{
    name?: string;
    displayName?: string;
    leaders?: EspnLeaderItem[];
  }>;
};

type EspnRosterPlayer = {
  starter?: boolean;
  subbedIn?: boolean;
  subbedOut?: boolean;
  jersey?: string;
  formationPlace?: string;
  athlete?: EspnAthlete;
  position?: { abbreviation?: string; displayName?: string };
  subbedInFor?: {
    jersey?: string;
    athlete?: EspnAthlete;
  };
  plays?: Array<{
    clock?: { displayValue?: string };
    substitution?: boolean;
  }>;
};

type EspnRoster = {
  homeAway?: "home" | "away";
  team?: { displayName?: string };
  formation?: string;
  roster?: EspnRosterPlayer[];
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
      description?: string;
      detail?: string;
      shortDetail?: string;
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

type EspnSummary = {
  header?: {
    competitions?: Array<{
      status?: EspnEvent["status"];
      competitors?: EspnCompetitor[];
      broadcasts?: Array<{ names?: string[]; media?: { shortName?: string } }>;
    }>;
  };
  gameInfo?: {
    venue?: {
      fullName?: string;
      shortName?: string;
      address?: { city?: string; country?: string };
    };
  };
  broadcasts?: Array<{ names?: string[]; media?: { shortName?: string } }>;
  boxscore?: {
    teams?: Array<{
      homeAway?: "home" | "away";
      team?: { displayName?: string };
      statistics?: Array<{ name?: string; displayName?: string; shortDisplayName?: string; displayValue?: string }>;
    }>;
  };
  keyEvents?: EspnDetail[];
  commentary?: Array<{
    time?: { displayValue?: string };
    text?: string;
    play?: EspnDetail;
  }>;
  rosters?: EspnRoster[];
  pickcenter?: Array<{
    provider?: { displayName?: string; name?: string };
    details?: string;
    overUnder?: number;
    spread?: number;
    homeTeamOdds?: { moneyLine?: number; spreadOdds?: number; favorite?: boolean };
    awayTeamOdds?: { moneyLine?: number; spreadOdds?: number; favorite?: boolean };
    drawOdds?: { moneyLine?: number };
  }>;
  odds?: EspnSummary["pickcenter"];
  leaders?: EspnTeamLeaderBlock[];
};

export type EspnMatchEvent = {
  type: "goal" | "yellow" | "red" | "substitution" | "other";
  minute: string;
  team?: string;
  player?: string;
  assist?: string;
  text?: string;
  penalty?: boolean;
  ownGoal?: boolean;
};

export type EspnTeamStats = {
  home: Array<{ key: string; label: string; value: string }>;
  away: Array<{ key: string; label: string; value: string }>;
};

export type EspnLineupPlayer = {
  name: string;
  number?: string;
  position?: string;
  formationPlace?: string;
  subMinute?: string;
  subbedInMinute?: string;
  subbedOutMinute?: string;
  subbedInForName?: string;
  replacedByName?: string;
};

export type EspnRosterSide = {
  team?: string;
  formation?: string;
  starters: EspnLineupPlayer[];
  substitutes: EspnLineupPlayer[];
};

export type EspnOdds = {
  provider: string;
  details?: string;
  overUnder?: number;
  spread?: number;
  homeMoneyline?: string;
  awayMoneyline?: string;
  drawMoneyline?: string;
};

export type EspnPeriodScore = {
  value?: number;
  displayValue?: string;
};

export type EspnMatchSummary = {
  eventId: string;
  status?: {
    displayClock?: string;
    state?: "pre" | "in" | "post";
    completed?: boolean;
    description?: string;
    detail?: string;
    shortDetail?: string;
  };
  venue?: string;
  city?: string;
  country?: string;
  broadcasts: string[];
  events: EspnMatchEvent[];
  stats: EspnTeamStats;
  rosters: { home?: EspnRosterSide; away?: EspnRosterSide };
  odds: EspnOdds[];
  homeLinescores?: EspnPeriodScore[];
  awayLinescores?: EspnPeriodScore[];
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
  "dr congo": "democratic republic of the congo",
  "congo dr": "democratic republic of the congo",
  "democratic republic of congo": "democratic republic of the congo",
};

function canonicalTeam(name?: string) {
  const normalized = normalizeTeamName(name ?? "");
  return TEAM_ALIASES[normalized] ?? normalized;
}

function americanOddsToDecimal(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return undefined;
  const decimal = value > 0 ? value / 100 + 1 : 100 / Math.abs(value) + 1;
  return decimal.toFixed(2);
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

function redCardCount(details: EspnDetail[], teamId?: string) {
  return details.filter((detail) => detail.team?.id === teamId && (detail.redCard || detail.type?.type?.includes("red-card") || detail.type?.text?.toLowerCase().includes("red card"))).length;
}

function espnClockLabel(status?: EspnEvent["status"]) {
  const raw = [
    status?.displayClock,
    status?.type?.description,
    status?.type?.detail,
    status?.type?.shortDetail,
  ].filter(Boolean).join(" ").toLowerCase();
  if (/\b(ht|half\s*time|halftime)\b/.test(raw)) return "Puoliaika";
  return status?.displayClock || "live";
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
    time_elapsed: state === "in" ? espnClockLabel(event.status) : state === "post" ? "finished" : "notstarted",
    espn_event_id: event.id,
    espn_home_red_cards: redCardCount(details, home?.team?.id),
    espn_away_red_cards: redCardCount(details, away?.team?.id),
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

function parseLinescores(linescores?: EspnPeriodScore[]): {
  regulation: number;
  final: number;
  shootout?: number;
} | undefined {
  if (!Array.isArray(linescores) || linescores.length < 2) return undefined;
  const p1 = Number(linescores[0]?.value ?? linescores[0]?.displayValue ?? 0);
  const p2 = Number(linescores[1]?.value ?? linescores[1]?.displayValue ?? 0);
  const regulation = p1 + p2;
  
  if (linescores.length === 2) {
    return { regulation, final: regulation };
  }
  
  const p3 = Number(linescores[2]?.value ?? linescores[2]?.displayValue ?? 0);
  const p4 = Number(linescores[3]?.value ?? linescores[3]?.displayValue ?? 0);
  const final = regulation + p3 + p4;
  
  if (linescores.length === 5) {
    const shootout = Number(linescores[4]?.value ?? linescores[4]?.displayValue ?? 0);
    return { regulation, final, shootout };
  }
  
  return { regulation, final };
}

export async function enrichGamesWithEspn(games: ApiGame[]): Promise<ApiGame[]> {
  const now = currentFinlandClockMillis();
  const dates = new Set<string>();
  for (let offset = -1; offset <= 2; offset++) {
    dates.add(dateParamFromFinlandMillis(now + offset * 24 * 60 * 60 * 1000));
  }

  const scoreboards = await Promise.all([...dates].map(fetchScoreboard));
  const events = scoreboards.flatMap((board) => board.events ?? []);

  const baseEnriched = games.map((game) => {
    const event = findEspnEvent(game, events);
    return event ? applyEspnEvent(game, event) : game;
  });

  const knockoutActiveOrFinished = baseEnriched.filter(
    (game) =>
      game.type !== "group" &&
      game.espn_event_id &&
      (isFinished(game) || isLive(game))
  );

  if (knockoutActiveOrFinished.length > 0) {
    try {
      const summaries = await Promise.allSettled(
        knockoutActiveOrFinished.map((game) => fetchEspnMatchSummary(game.espn_event_id!))
      );

      const summaryMap = new Map<string, EspnMatchSummary>();
      summaries.forEach((res) => {
        if (res.status === "fulfilled") {
          summaryMap.set(res.value.eventId, res.value);
        }
      });

      return baseEnriched.map((game) => {
        if (game.type === "group" || !game.espn_event_id) return game;
        const summary = summaryMap.get(game.espn_event_id);
        if (!summary) return game;

        const homeParsed = parseLinescores(summary.homeLinescores);
        const awayParsed = parseLinescores(summary.awayLinescores);

        if (homeParsed && awayParsed) {
          const gameUpdate: Partial<ApiGame> = {
            home_score: String(homeParsed.regulation),
            away_score: String(awayParsed.regulation),
          };

          if (summary.homeLinescores && summary.homeLinescores.length > 2) {
            gameUpdate.home_score_final = String(homeParsed.final);
            gameUpdate.away_score_final = String(awayParsed.final);

            if (homeParsed.shootout !== undefined && awayParsed.shootout !== undefined) {
              gameUpdate.shootout_home_score = String(homeParsed.shootout);
              gameUpdate.shootout_away_score = String(awayParsed.shootout);
              gameUpdate.finished_type = "pen";
            } else {
              gameUpdate.finished_type = "aet";
            }
          }

          return {
            ...game,
            ...gameUpdate,
          };
        }
        return game;
      });
    } catch (e) {
      console.error("Failed to enrich regulation scores:", e);
    }
  }

  return baseEnriched;
}

function athleteName(athlete?: EspnAthlete) {
  return athlete?.shortName || athlete?.displayName || athlete?.fullName;
}

function eventType(detail: EspnDetail): EspnMatchEvent["type"] {
  const rawType = (detail.type?.type ?? "").toLowerCase();
  const rawText = `${detail.type?.text ?? ""} ${detail.text ?? ""}`.toLowerCase();
  if (detail.scoringPlay || rawType === "goal" || rawType === "own-goal" || rawType === "penalty---scored") return "goal";
  if (detail.redCard || rawText.includes("red card") || rawType.includes("red-card")) return "red";
  if (detail.yellowCard || rawText.includes("yellow card") || rawType.includes("yellow-card")) return "yellow";
  if (rawText.includes("substitution") || rawType.includes("substitution")) return "substitution";
  return "other";
}

function mapEvent(detail: EspnDetail): EspnMatchEvent {
  const participants = detail.participants ?? detail.athletesInvolved?.map((athlete) => ({ athlete })) ?? [];
  const type = eventType(detail);
  return {
    type,
    minute: detail.clock?.displayValue ?? "",
    team: detail.team?.displayName,
    player: athleteName(participants[0]?.athlete),
    assist: type === "goal" ? athleteName(participants[1]?.athlete) : undefined,
    text: detail.shortText || detail.text,
    penalty: detail.penaltyKick,
    ownGoal: detail.ownGoal,
  };
}

const STAT_LABELS: Record<string, string> = {
  possessionPct: "Pallonhallinta",
  expectedGoals: "xG",
  totalShots: "Laukaukset",
  shotsOnTarget: "Maalia kohti",
  shotPct: "Laukaisu%",
  accuratePasses: "Onnistuneet syötöt",
  passPct: "Syöttö%",
  yellowCards: "Keltaiset",
  wonCorners: "Kulmat",
  blockedShots: "Blokatut laukaukset",
  saves: "Torjunnat",
  redCards: "Punaiset",
  foulsCommitted: "Rikkeet",
  offsides: "Paitsiot",
  totalPasses: "Syötöt",
  accurateCrosses: "Onnistuneet keskitykset",
  totalCrosses: "Keskitykset",
  crossPct: "Keskitys%",
  accurateLongBalls: "Onnistuneet pitkät",
  totalLongBalls: "Pitkät pallot",
  longballPct: "Pitkä pallo %",
  effectiveTackles: "Onnistuneet taklaukset",
  totalTackles: "Taklaukset",
  interceptions: "Katkot",
  totalClearance: "Purkupallot",
};

function mapStats(summary: EspnSummary): EspnTeamStats {
  const sides: EspnTeamStats = { home: [], away: [] };
  (summary.boxscore?.teams ?? []).forEach((team) => {
    const side = team.homeAway === "away" ? "away" : "home";
    sides[side] = (team.statistics ?? [])
      .filter((stat) => stat.displayValue && (STAT_LABELS[stat.name ?? ""] || stat.displayName))
      .map((stat) => ({
        key: stat.name ?? stat.displayName ?? stat.shortDisplayName ?? "",
        label: STAT_LABELS[stat.name ?? ""] ?? stat.displayName ?? stat.shortDisplayName ?? stat.name ?? "",
        value: stat.displayValue ?? "",
      }));
  });
  addExpectedGoalsFromLeaders(summary, sides);
  return sides;
}

function leaderStatValue(item: EspnLeaderItem | undefined, statName: string) {
  const stat = item?.statistics?.find((entry) => entry.name === statName);
  const value = stat?.displayValue ?? stat?.value;
  return value == null ? undefined : String(value);
}

function goalkeeperXgcBySide(summary: EspnSummary) {
  const result: Partial<Record<"home" | "away", string>> = {};
  const competitors = summary.header?.competitions?.[0]?.competitors ?? [];
  const sideByTeamId = new Map(competitors.map((competitor) => [competitor.team?.id, competitor.homeAway]));
  const sideByTeamName = new Map(competitors.map((competitor) => [
    canonicalTeam(competitor.team?.displayName ?? competitor.team?.shortDisplayName ?? competitor.team?.name ?? ""),
    competitor.homeAway,
  ]));

  (summary.leaders ?? []).forEach((teamBlock) => {
    const side =
      sideByTeamId.get(teamBlock.team?.id) ??
      sideByTeamName.get(canonicalTeam(teamBlock.team?.displayName ?? teamBlock.team?.name ?? ""));
    if (side !== "home" && side !== "away") return;
    const savesCategory = (teamBlock.leaders ?? []).find((category) =>
      String(category.name ?? category.displayName ?? "").toLowerCase().includes("saves")
    );
    const xgc = savesCategory?.leaders?.map((item) => leaderStatValue(item, "expectedGoalsConceded")).find(Boolean);
    if (xgc) result[side] = xgc;
  });

  return result;
}

function teamExpectedGoalsBySide(summary: EspnSummary) {
  const result: Partial<Record<"home" | "away", string>> = {};
  const competitors = summary.header?.competitions?.[0]?.competitors ?? [];
  const sideByTeamId = new Map(competitors.map((competitor) => [competitor.team?.id, competitor.homeAway]));
  const sideByTeamName = new Map(competitors.map((competitor) => [
    canonicalTeam(competitor.team?.displayName ?? competitor.team?.shortDisplayName ?? competitor.team?.name ?? ""),
    competitor.homeAway,
  ]));

  (summary.leaders ?? []).forEach((teamBlock) => {
    const side =
      sideByTeamId.get(teamBlock.team?.id) ??
      sideByTeamName.get(canonicalTeam(teamBlock.team?.displayName ?? teamBlock.team?.name ?? ""));
    if (side !== "home" && side !== "away") return;
    const shotsCategory = (teamBlock.leaders ?? []).find((category) =>
      String(category.name ?? category.displayName ?? "").toLowerCase().includes("shot")
    );
    const xg = shotsCategory?.leaders?.map((item) => leaderStatValue(item, "expectedGoals")).find(Boolean);
    if (xg) result[side] = xg;
  });

  return result;
}

function addExpectedGoalsFromLeaders(summary: EspnSummary, sides: EspnTeamStats) {
  const directXg = teamExpectedGoalsBySide(summary);
  const xgc = goalkeeperXgcBySide(summary);
  const homeXg = xgc.away ?? directXg.home;
  const awayXg = xgc.home ?? directXg.away;
  if (homeXg && !sides.home.some((stat) => stat.key === "expectedGoals")) {
    sides.home.splice(1, 0, { key: "expectedGoals", label: "xG", value: homeXg });
  }
  if (awayXg && !sides.away.some((stat) => stat.key === "expectedGoals")) {
    sides.away.splice(1, 0, { key: "expectedGoals", label: "xG", value: awayXg });
  }
}

function mapRosterSide(side: EspnRoster): EspnRosterSide {
  const players = side.roster ?? [];
  const substitutionMinute = (player: EspnRosterPlayer) =>
    player.plays?.find((play) => play.substitution)?.clock?.displayValue;
  const lineupPlayer = (player: EspnRosterPlayer): EspnLineupPlayer | undefined => {
    const name = athleteName(player.athlete);
    if (!name) return undefined;
    const subMinute = substitutionMinute(player);
    return {
      name,
      number: player.jersey,
      position: player.position?.abbreviation ?? player.position?.displayName,
      formationPlace: player.formationPlace,
      subMinute,
      subbedInMinute: player.subbedIn ? subMinute : undefined,
      subbedOutMinute: player.subbedOut ? subMinute : undefined,
      subbedInForName: athleteName(player.subbedInFor?.athlete),
    };
  };
  const starters = players.filter((player) => player.starter).map(lineupPlayer).filter((player): player is EspnLineupPlayer => !!player);
  const substitutes = players.filter((player) => !player.starter).map(lineupPlayer).filter((player): player is EspnLineupPlayer => !!player);
  const starterByName = new Map(starters.map((player) => [canonicalTeam(player.name), player]));
  substitutes.forEach((substitute) => {
    if (!substitute.subbedInForName || !substitute.subMinute) return;
    const starter = starterByName.get(canonicalTeam(substitute.subbedInForName));
    if (!starter) return;
    starter.subbedOutMinute = substitute.subMinute;
    starter.replacedByName = substitute.name;
    substitute.subbedInMinute = substitute.subMinute;
  });
  return {
    team: side.team?.displayName,
    formation: side.formation,
    starters,
    substitutes,
  };
}

function mapBroadcasts(summary: EspnSummary) {
  return [...(summary.broadcasts ?? []), ...(summary.header?.competitions?.[0]?.broadcasts ?? [])]
    .flatMap((broadcast) => broadcast.names ?? [broadcast.media?.shortName ?? ""])
    .filter(Boolean);
}

export async function fetchEspnMatchSummary(eventId: string): Promise<EspnMatchSummary> {
  const response = await fetch(`${ESPN_SUMMARY}?event=${encodeURIComponent(eventId)}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`ESPN summary ${eventId} HTTP ${response.status}`);
  const summary = (await response.json()) as EspnSummary;
  const keyEvents = (summary.keyEvents ?? []).map(mapEvent).filter((event) => event.type !== "other");
  const commentaryEvents = (summary.commentary ?? [])
    .map((item) => item.play ? mapEvent({ ...item.play, clock: item.play.clock ?? item.time, text: item.play.text ?? item.text }) : undefined)
    .filter((event): event is EspnMatchEvent => !!event && event.type !== "other");
  const eventKeys = new Set<string>();
  const events = [...keyEvents, ...commentaryEvents].filter((event) => {
    const key = `${event.type}|${event.minute}|${event.team}|${event.player}|${event.text}`;
    if (eventKeys.has(key)) return false;
    eventKeys.add(key);
    return true;
  });
  const rosters = summary.rosters ?? [];
  const homeRoster = rosters.find((roster) => roster.homeAway === "home");
  const awayRoster = rosters.find((roster) => roster.homeAway === "away");
  const competition = summary.header?.competitions?.[0];
  const oddsKeys = new Set<string>();
  const odds = [...(summary.pickcenter ?? []), ...(summary.odds ?? [])]
    .map((item) => ({
      provider: item.provider?.displayName ?? item.provider?.name ?? "ESPN",
      details: item.details,
      overUnder: item.overUnder,
      spread: item.spread,
      homeMoneyline: americanOddsToDecimal(item.homeTeamOdds?.moneyLine),
      awayMoneyline: americanOddsToDecimal(item.awayTeamOdds?.moneyLine),
      drawMoneyline: americanOddsToDecimal(item.drawOdds?.moneyLine),
    }))
    .filter((item) => {
      const key = `${item.provider}|${item.homeMoneyline}|${item.drawMoneyline}|${item.awayMoneyline}`;
      if (oddsKeys.has(key)) return false;
      oddsKeys.add(key);
      return !!(item.homeMoneyline || item.drawMoneyline || item.awayMoneyline);
    });

  const competitors = competition?.competitors ?? [];
  const homeCompetitor = competitors.find((c) => c.homeAway === "home");
  const awayCompetitor = competitors.find((c) => c.homeAway === "away");

  return {
    eventId,
    status: {
      displayClock: competition?.status?.displayClock,
      state: competition?.status?.type?.state,
      completed: competition?.status?.type?.completed,
      description: competition?.status?.type?.description,
      detail: competition?.status?.type?.detail,
      shortDetail: competition?.status?.type?.shortDetail,
    },
    venue: summary.gameInfo?.venue?.fullName ?? summary.gameInfo?.venue?.shortName,
    city: summary.gameInfo?.venue?.address?.city,
    country: summary.gameInfo?.venue?.address?.country,
    broadcasts: [...new Set(mapBroadcasts(summary))],
    events,
    stats: mapStats(summary),
    rosters: {
      home: homeRoster ? mapRosterSide(homeRoster) : undefined,
      away: awayRoster ? mapRosterSide(awayRoster) : undefined,
    },
    odds,
    homeLinescores: homeCompetitor?.linescores,
    awayLinescores: awayCompetitor?.linescores,
  };
}
