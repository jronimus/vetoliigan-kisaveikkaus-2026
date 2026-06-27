import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const API = process.env.WORLDCUP_DATA_SOURCE || "https://worldcup26.ir/get";
const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
const ESPN_SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary";
const outDir = join(process.cwd(), "public", "live-data");
const MATCH_TIME_TOLERANCE_MS = 14 * 60 * 60 * 1000;

const TEAM_ALIASES = {
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

const STAT_LABELS = {
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

function stripAccents(str = "") {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeTeamName(name = "") {
  const clean = stripAccents(name)
    .trim()
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return TEAM_ALIASES[clean] ?? clean;
}

async function getJson(path) {
  const res = await fetch(`${API}/${path}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
  return res.json();
}

async function fetchScoreboard(date) {
  const response = await fetch(`${ESPN_SCOREBOARD}?dates=${date}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`ESPN scoreboard ${date}: ${response.status}`);
  return response.json();
}

async function fetchSummary(eventId) {
  const response = await fetch(`${ESPN_SUMMARY}?event=${encodeURIComponent(eventId)}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`ESPN summary ${eventId}: ${response.status}`);
  return response.json();
}

function parseGameMillis(localDate) {
  const [datePart, timePart] = String(localDate || "").split(" ");
  if (!datePart || !timePart) return undefined;
  const [month, day, year] = datePart.split("/").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  if ([month, day, year, hour, minute].some((value) => !Number.isFinite(value))) return undefined;
  return Date.UTC(year, month - 1, day, hour, minute);
}

function espnDateParam(localDate) {
  const millis = parseGameMillis(localDate);
  if (!millis) return undefined;
  return espnDateParamFromMillis(millis);
}

function espnDateParamFromMillis(millis) {
  const date = new Date(millis);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function espnDateParamsAround(localDate) {
  const millis = parseGameMillis(localDate);
  if (!millis) return [];
  const day = 24 * 60 * 60 * 1000;
  return [
    espnDateParamFromMillis(millis - day),
    espnDateParamFromMillis(millis),
    espnDateParamFromMillis(millis + day),
  ];
}

function eventMillis(event) {
  if (!event?.date) return undefined;
  const millis = Date.parse(event.date);
  return Number.isFinite(millis) ? millis : undefined;
}

function sameKickoff(game, event) {
  const gameTime = parseGameMillis(game.local_date);
  const espnTime = eventMillis(event);
  if (!gameTime || !espnTime) return true;
  return Math.abs(gameTime - espnTime) <= MATCH_TIME_TOLERANCE_MS;
}

function eventTeams(event) {
  const competitors = event?.competitions?.[0]?.competitors ?? [];
  const home = competitors.find((item) => item.homeAway === "home");
  const away = competitors.find((item) => item.homeAway === "away");
  return {
    home,
    away,
    homeName: normalizeTeamName(home?.team?.displayName ?? home?.team?.shortDisplayName ?? home?.team?.name ?? ""),
    awayName: normalizeTeamName(away?.team?.displayName ?? away?.team?.shortDisplayName ?? away?.team?.name ?? ""),
  };
}

function gameTeams(game) {
  return {
    homeName: normalizeTeamName(game.home_team_name_en ?? game.home_team_label ?? ""),
    awayName: normalizeTeamName(game.away_team_name_en ?? game.away_team_label ?? ""),
  };
}

function sameTeams(game, event) {
  const gamePair = gameTeams(game);
  const eventPair = eventTeams(event);
  return gamePair.homeName === eventPair.homeName && gamePair.awayName === eventPair.awayName;
}

function findEspnEvent(game, events) {
  const matches = events
    .filter((event) => sameTeams(game, event) && sameKickoff(game, event))
    .map((event) => ({
      event,
      diff: Math.abs((parseGameMillis(game.local_date) ?? 0) - (eventMillis(event) ?? 0)),
    }))
    .sort((a, b) => a.diff - b.diff);
  return matches[0]?.event;
}

function redCardCount(details, teamId) {
  return details.filter((detail) => detail.team?.id === teamId && (
    detail.redCard ||
    String(detail.type?.type ?? "").includes("red-card") ||
    String(detail.type?.text ?? "").toLowerCase().includes("red card")
  )).length;
}

function mapStats(summary) {
  const sides = { home: [], away: [] };
  (summary.boxscore?.teams ?? []).forEach((team) => {
    const side = team.homeAway === "away" ? "away" : "home";
    sides[side] = (team.statistics ?? [])
      .filter((stat) => stat.displayValue && (STAT_LABELS[stat.name] || stat.displayName))
      .map((stat) => ({
        key: stat.name ?? stat.displayName ?? stat.shortDisplayName ?? "",
        label: STAT_LABELS[stat.name] ?? stat.displayName ?? stat.shortDisplayName ?? stat.name ?? "",
        value: stat.displayValue ?? "",
      }));
  });
  addExpectedGoalsFromLeaders(summary, sides);
  return sides;
}

function leaderStatValue(item, statName) {
  const stat = item?.statistics?.find((entry) => entry.name === statName);
  const value = stat?.displayValue ?? stat?.value;
  return value == null ? undefined : String(value);
}

function goalkeeperXgcBySide(summary) {
  const result = {};
  const competitors = summary.header?.competitions?.[0]?.competitors ?? [];
  const sideByTeamId = new Map(competitors.map((competitor) => [competitor.team?.id, competitor.homeAway]));
  const sideByTeamName = new Map(competitors.map((competitor) => [
    normalizeTeamName(competitor.team?.displayName ?? competitor.team?.shortDisplayName ?? competitor.team?.name ?? ""),
    competitor.homeAway,
  ]));
  (summary.leaders ?? []).forEach((teamBlock) => {
    const side =
      sideByTeamId.get(teamBlock.team?.id) ??
      sideByTeamName.get(normalizeTeamName(teamBlock.team?.displayName ?? teamBlock.team?.name ?? ""));
    if (side !== "home" && side !== "away") return;
    const savesCategory = (teamBlock.leaders ?? []).find((category) =>
      String(category.name ?? category.displayName ?? "").toLowerCase().includes("saves")
    );
    const xgc = savesCategory?.leaders?.map((item) => leaderStatValue(item, "expectedGoalsConceded")).find(Boolean);
    if (xgc) result[side] = xgc;
  });
  return result;
}

function teamExpectedGoalsBySide(summary) {
  const result = {};
  const competitors = summary.header?.competitions?.[0]?.competitors ?? [];
  const sideByTeamId = new Map(competitors.map((competitor) => [competitor.team?.id, competitor.homeAway]));
  const sideByTeamName = new Map(competitors.map((competitor) => [
    normalizeTeamName(competitor.team?.displayName ?? competitor.team?.shortDisplayName ?? competitor.team?.name ?? ""),
    competitor.homeAway,
  ]));
  (summary.leaders ?? []).forEach((teamBlock) => {
    const side =
      sideByTeamId.get(teamBlock.team?.id) ??
      sideByTeamName.get(normalizeTeamName(teamBlock.team?.displayName ?? teamBlock.team?.name ?? ""));
    if (side !== "home" && side !== "away") return;
    const shotsCategory = (teamBlock.leaders ?? []).find((category) =>
      String(category.name ?? category.displayName ?? "").toLowerCase().includes("shot")
    );
    const xg = shotsCategory?.leaders?.map((item) => leaderStatValue(item, "expectedGoals")).find(Boolean);
    if (xg) result[side] = xg;
  });
  return result;
}

function addExpectedGoalsFromLeaders(summary, sides) {
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

function getRegulationScoreFromLinescores(linescores) {
  if (!Array.isArray(linescores) || linescores.length < 2) return undefined;
  const p1 = Number(linescores[0]?.value ?? linescores[0]?.displayValue ?? 0);
  const p2 = Number(linescores[1]?.value ?? linescores[1]?.displayValue ?? 0);
  return p1 + p2;
}

function mapSummary(eventId, summary) {
  const competition = summary.header?.competitions?.[0];
  const competitors = competition?.competitors ?? [];
  const home = competitors.find((c) => c.homeAway === "home");
  const away = competitors.find((c) => c.homeAway === "away");
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
    broadcasts: [],
    events: [],
    stats: mapStats(summary),
    rosters: {},
    odds: [],
    homeLinescores: home?.linescores,
    awayLinescores: away?.linescores,
  };
}

await mkdir(outDir, { recursive: true });

let gamesJson, teamsJson, groupsJson, stadiumsJson;
try {
  [gamesJson, teamsJson, groupsJson, stadiumsJson] = await Promise.all([
    getJson("games"),
    getJson("teams"),
    getJson("groups"),
    getJson("stadiums"),
  ]);
} catch (err) {
  console.warn("Failed to fetch from remote API, falling back to local files:", err.message);
  const readLocal = async (name) => {
    try {
      const { readFile } = await import("node:fs/promises");
      const content = await readFile(join(outDir, `${name}.json`), "utf8");
      return JSON.parse(content);
    } catch (e) {
      console.error(`Failed to read local ${name}.json:`, e.message);
      return {};
    }
  };
  [gamesJson, teamsJson, groupsJson, stadiumsJson] = await Promise.all([
    readLocal("games"),
    readLocal("teams"),
    readLocal("groups"),
    readLocal("stadiums"),
  ]);
}

const games = gamesJson.games ?? [];
const dates = [...new Set(games.flatMap((game) => espnDateParamsAround(game.local_date)).filter(Boolean))];
const scoreboards = await Promise.all(dates.map(fetchScoreboard));
const events = scoreboards.flatMap((board) => board.events ?? []);

const enrichedGames = games.map((game) => {
  const event = findEspnEvent(game, events);
  if (!event) return game;
  const { home, away } = eventTeams(event);
  const details = event.competitions?.[0]?.details ?? [];
  return {
    ...game,
    espn_event_id: event.id,
    espn_home_red_cards: redCardCount(details, home?.team?.id),
    espn_away_red_cards: redCardCount(details, away?.team?.id),
  };
});

const summaryIds = [...new Set(
  enrichedGames
    .filter((game) => (String(game.finished).toLowerCase() === "true" || String(game.time_elapsed).toLowerCase() !== "notstarted") && game.espn_event_id)
    .map((game) => game.espn_event_id),
)];

const summaryResults = await Promise.allSettled(summaryIds.map(async (eventId) => {
  const summary = await fetchSummary(eventId);
  return mapSummary(eventId, summary);
}));

const summaryMap = {};
summaryResults.forEach((result) => {
  if (result.status === "fulfilled") {
    summaryMap[result.value.eventId] = result.value;
  }
});

const finalGames = enrichedGames.map((game) => {
  if (game.type === "group" || !game.espn_event_id) return game;
  const summary = summaryMap[game.espn_event_id];
  if (!summary) return game;

  const homeRegScore = getRegulationScoreFromLinescores(summary.homeLinescores);
  const awayRegScore = getRegulationScoreFromLinescores(summary.awayLinescores);

  if (homeRegScore !== undefined && awayRegScore !== undefined) {
    return {
      ...game,
      home_score: String(homeRegScore),
      away_score: String(awayRegScore),
    };
  }
  return game;
});

await writeFile(join(outDir, "games.json"), JSON.stringify({ games: finalGames }));
await writeFile(join(outDir, "teams.json"), JSON.stringify(teamsJson));
await writeFile(join(outDir, "groups.json"), JSON.stringify(groupsJson));
await writeFile(join(outDir, "stadiums.json"), JSON.stringify(stadiumsJson));
await writeFile(join(outDir, "espn-summaries.json"), JSON.stringify(summaryMap));

console.log(`Saved World Cup data and ${Object.keys(summaryMap).length} ESPN summaries.`);
