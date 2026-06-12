import { TEAM_FI } from "./data";

export type ApiGame = {
  id: string;
  home_score: string;
  away_score: string;
  home_scorers: string;
  away_scorers: string;
  group: string;
  matchday: string;
  local_date: string;
  finished: string;
  time_elapsed: string;
  type: string;
  home_team_name_en?: string;
  away_team_name_en?: string;
  home_team_label?: string;
  away_team_label?: string;
  home_team_id: string;
  away_team_id: string;
  stadium_id: string;
  fallback_source?: string;
};

export type ApiTeam = {
  id: string;
  name_en: string;
  flag: string;
  fifa_code: string;
  groups: string;
};

export type ApiGroupTeam = {
  team_id: string;
  mp: string;
  w: string;
  l: string;
  d: string;
  pts: string;
  gf: string;
  ga: string;
  gd: string;
};

export type ApiGroup = {
  name: string;
  teams: ApiGroupTeam[];
};

export type ApiStadium = {
  id: string;
  name_en: string;
  fifa_name: string;
  city_en: string;
  country_en: string;
};

export type WorldCupState = {
  games: ApiGame[];
  teams: ApiTeam[];
  groups: ApiGroup[];
  stadiums: ApiStadium[];
  lastUpdated?: Date;
  error?: string;
  source?: "direct" | "proxy" | "fallback" | "cache";
};

const API = import.meta.env.VITE_WORLDCUP_API_BASE || "https://worldcup26.ir/get";
const CACHE_KEY = "vetoliiga.worldcup-cache";
const STATIC_DATA = "/live-data";

export const FALLBACK_TEAMS: ApiTeam[] = [
  { id: "1", name_en: "Mexico", flag: "https://flagcdn.com/w80/mx.png", fifa_code: "MEX", groups: "A" },
  { id: "2", name_en: "South Africa", flag: "https://flagcdn.com/w80/za.png", fifa_code: "RSA", groups: "A" },
  { id: "3", name_en: "South Korea", flag: "https://flagcdn.com/w80/kr.png", fifa_code: "KOR", groups: "A" },
  { id: "4", name_en: "Czech Republic", flag: "https://flagcdn.com/w80/cz.png", fifa_code: "CZE", groups: "A" },
];

export const FALLBACK_GAMES: ApiGame[] = [
  {
    id: "1",
    home_team_id: "1",
    away_team_id: "2",
    home_score: "2",
    away_score: "0",
    home_scorers: "{J. Quinones 9', R. Jimenez 67'}",
    away_scorers: "null",
    group: "A",
    matchday: "1",
    local_date: "06/11/2026 13:00",
    stadium_id: "1",
    finished: "TRUE",
    time_elapsed: "finished",
    type: "group",
    home_team_name_en: "Mexico",
    away_team_name_en: "South Africa",
  },
  {
    id: "2",
    home_team_id: "3",
    away_team_id: "4",
    home_score: "0",
    away_score: "0",
    home_scorers: "null",
    away_scorers: "null",
    group: "A",
    matchday: "1",
    local_date: "06/11/2026 20:00",
    stadium_id: "2",
    finished: "FALSE",
    time_elapsed: "notstarted",
    type: "group",
    home_team_name_en: "South Korea",
    away_team_name_en: "Czech Republic",
  },
];

export const FALLBACK_GROUPS: ApiGroup[] = [
  {
    name: "A",
    teams: [
      { team_id: "1", mp: "1", w: "1", l: "0", d: "0", pts: "3", gf: "2", ga: "0", gd: "2" },
      { team_id: "3", mp: "0", w: "0", l: "0", d: "0", pts: "0", gf: "0", ga: "0", gd: "0" },
      { team_id: "4", mp: "0", w: "0", l: "0", d: "0", pts: "0", gf: "0", ga: "0", gd: "0" },
      { team_id: "2", mp: "1", w: "0", l: "1", d: "0", pts: "0", gf: "0", ga: "2", gd: "-2" },
    ],
  },
];

export const FALLBACK_STADIUMS: ApiStadium[] = [
  { id: "1", name_en: "Estadio Azteca", fifa_name: "Mexico City Stadium", city_en: "Mexico City", country_en: "Mexico" },
  { id: "2", name_en: "Estadio Akron", fifa_name: "Estadio Guadalajara", city_en: "Guadalajara (Zapopan)", country_en: "Mexico" },
];

function cleanJinaPayload(raw: string) {
  const marker = "Markdown Content:";
  const start = raw.indexOf(marker);
  if (start < 0) return raw.trim();
  return raw.slice(start + marker.length).trim();
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function fetchStatic<T>(path: string): Promise<T> {
  return fetchJson<T>(`${STATIC_DATA}/${path}`, { cache: "no-store" });
}

async function fetchViaJina<T>(url: string): Promise<T> {
  const response = await fetch(`https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Jina HTTP ${response.status}`);
  const text = await response.text();
  return JSON.parse(cleanJinaPayload(text)) as T;
}

const GAME_OVERRIDES: Record<string, Partial<ApiGame>> = {
  // If the South Korea vs Czech Republic game (id: "2") fails to update, we can override its values here.
  // Example:
  // "2": { home_score: "1", away_score: "1", finished: "TRUE", time_elapsed: "finished", home_scorers: "{Son 45'}", away_scorers: "{Schick 80'}" }
};

export function applyGameOverrides(games: ApiGame[]): ApiGame[] {
  return games.map((game) => {
    const override = GAME_OVERRIDES[game.id];
    if (override) {
      return { ...game, ...override };
    }
    return game;
  });
}

function buildState(games: ApiGame[], teams: ApiTeam[], groups: ApiGroup[], stadiums: ApiStadium[], source: WorldCupState["source"]) {
  return { games: applyGameOverrides(games), teams, groups, stadiums, lastUpdated: new Date(), source };
}

export function loadCachedWorldCup() {
  const saved = localStorage.getItem(CACHE_KEY);
  if (!saved) return undefined;
  try {
    const parsed = JSON.parse(saved) as WorldCupState;
    return {
      ...parsed,
      games: applyGameOverrides(parsed.games ?? []),
      lastUpdated: parsed.lastUpdated ? new Date(parsed.lastUpdated) : undefined,
      source: "cache" as const,
    };
  } catch {
    return undefined;
  }
}

export function saveCachedWorldCup(state: WorldCupState) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(state));
}

export async function fetchWorldCup(): Promise<WorldCupState> {
  let state: WorldCupState;

  try {
    const [gamesJson, teamsJson, groupsJson, stadiumsJson] = await Promise.all([
      fetchStatic<{ games: ApiGame[] }>("games.json"),
      fetchStatic<{ teams: ApiTeam[] }>("teams.json"),
      fetchStatic<{ groups: ApiGroup[] }>("groups.json"),
      fetchStatic<{ stadiums: ApiStadium[] }>("stadiums.json"),
    ]);
    state = buildState(gamesJson.games ?? [], teamsJson.teams ?? [], groupsJson.groups ?? [], stadiumsJson.stadiums ?? [], "direct");
  } catch {
    try {
      const [gamesJson, teamsJson, groupsJson, stadiumsJson] = await Promise.all([
        fetchJson<{ games: ApiGame[] }>(`${API}/games`, { cache: "no-store" }),
        fetchJson<{ teams: ApiTeam[] }>(`${API}/teams`, { cache: "force-cache" }),
        fetchJson<{ groups: ApiGroup[] }>(`${API}/groups`, { cache: "no-store" }),
        fetchJson<{ stadiums: ApiStadium[] }>(`${API}/stadiums`, { cache: "force-cache" }),
      ]);
      state = buildState(gamesJson.games ?? [], teamsJson.teams ?? [], groupsJson.groups ?? [], stadiumsJson.stadiums ?? [], "direct");
    } catch {
      const [gamesJson, teamsJson, groupsJson, stadiumsJson] = await Promise.all([
        fetchViaJina<{ games: ApiGame[] }>("https://worldcup26.ir/get/games"),
        fetchViaJina<{ teams: ApiTeam[] }>("https://worldcup26.ir/get/teams"),
        fetchViaJina<{ groups: ApiGroup[] }>("https://worldcup26.ir/get/groups"),
        fetchViaJina<{ stadiums: ApiStadium[] }>("https://worldcup26.ir/get/stadiums"),
      ]);
      state = buildState(gamesJson.games ?? [], teamsJson.teams ?? [], groupsJson.groups ?? [], stadiumsJson.stadiums ?? [], "proxy");
    }
  }

  try {
    const yleMatches = await fetchYleFallback(state.teams.map((t) => t.name_en));
    if (yleMatches && yleMatches.length > 0) {
      state.games = overlayYleMatches(state.games, state.teams, yleMatches);
    }
  } catch (err) {
    console.warn("Failed to overlay Yle Teletext matches:", err);
  }

  return state;
}

export function isFinished(game: ApiGame) {
  return String(game.finished).toLowerCase() === "true" || String(game.time_elapsed).toLowerCase() === "finished";
}

export function isLive(game: ApiGame) {
  const elapsed = String(game.time_elapsed).toLowerCase();
  return elapsed === "live" || (!isFinished(game) && elapsed !== "notstarted");
}

export function teamName(game: ApiGame, side: "home" | "away") {
  if (side === "home") return game.home_team_name_en || game.home_team_label || "TBD";
  return game.away_team_name_en || game.away_team_label || "TBD";
}

export function parseScore(value: string) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

export function parseScorers(value: string) {
  if (!value || value === "null") return [];
  return value
    .replace(/[{}“”"]/g, "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/\s+\d+'\s*$/g, "").trim());
}

export function finlandClockDate(game: ApiGame) {
  const match = game.local_date.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!match) return undefined;

  const [, month, day, year, hour, minute] = match;
  const baseUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  return new Date(baseUtc + (STADIUM_TO_FINLAND_HOURS[game.stadium_id] ?? 0) * 60 * 60 * 1000);
}

export function currentFinlandClockMillis() {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Helsinki",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

const STADIUM_TO_FINLAND_HOURS: Record<string, number> = {
  "1": 9,
  "2": 9,
  "3": 9,
  "4": 8,
  "5": 8,
  "6": 8,
  "7": 7,
  "8": 7,
  "9": 7,
  "10": 7,
  "11": 7,
  "12": 7,
  "13": 10,
  "14": 10,
  "15": 10,
  "16": 10,
};

export function finnishKickoff(game: ApiGame) {
  const finlandTime = finlandClockDate(game);
  if (!finlandTime) return game.local_date;

  return new Intl.DateTimeFormat("fi-FI", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(finlandTime);
}

export function predictionLocked(game: ApiGame) {
  if (isFinished(game) || isLive(game)) return true;
  const kickoff = finlandClockDate(game);
  if (!kickoff) return false;
  return currentFinlandClockMillis() >= kickoff.getTime();
}

export function archivedMatch(game: ApiGame) {
  if (!isFinished(game)) return false;
  const kickoff = finlandClockDate(game);
  if (!kickoff) return false;
  const archiveAfter = kickoff.getTime() + 12 * 60 * 60 * 1000;
  return currentFinlandClockMillis() >= archiveAfter;
}

export function scorerTable(games: ApiGame[]) {
  const counts = new Map<string, { goals: number; teamId: string }>();
  games.forEach((game) => {
    parseScorers(game.home_scorers).forEach((name) => {
      const current = counts.get(name);
      counts.set(name, {
        goals: (current?.goals ?? 0) + 1,
        teamId: game.home_team_id,
      });
    });
    parseScorers(game.away_scorers).forEach((name) => {
      const current = counts.get(name);
      counts.set(name, {
        goals: (current?.goals ?? 0) + 1,
        teamId: game.away_team_id,
      });
    });
  });
  return [...counts.entries()]
    .map(([name, { goals, teamId }]) => ({ name, goals, teamId }))
    .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name));
}

export function isBonusLocked() {
  const lockTime = Date.UTC(2026, 5, 12, 18, 55, 0); // 12.06.2026 klo 21.55 Suomen aikaa (UTC+3, so 18:55 UTC)
  return Date.now() >= lockTime;
}

export function normalizeTeamName(name: string): string {
  let n = name.toLowerCase().trim();
  n = n.replace(/ä/g, "a").replace(/ö/g, "o").replace(/å/g, "a").replace(/é/g, "e").replace(/ç/g, "c");
  n = n.replace(/[^a-z0-9]/g, " ");
  n = n.replace(/\s+/g, " ").trim();
  return n;
}

export const YLE_TEAM_ALIAS: Record<string, string> = {
  "usa": "United States",
  "tshekki": "Czech Republic",
  "hollanti": "Netherlands",
  "bosnia hertsegovina": "Bosnia and Herzegovina",
  "kongo": "Democratic Republic of the Congo",
  "kongon dem tasavalta": "Democratic Republic of the Congo",
};

export function getTeamEnName(finnishName: string, allEnglishNames: string[]): string | null {
  const norm = normalizeTeamName(finnishName);

  if (YLE_TEAM_ALIAS[norm]) {
    return YLE_TEAM_ALIAS[norm];
  }

  for (const en of allEnglishNames) {
    const fi = TEAM_FI[en];
    if (fi && normalizeTeamName(fi) === norm) {
      return en;
    }
    if (normalizeTeamName(en) === norm) {
      return en;
    }
  }

  for (const en of allEnglishNames) {
    const fi = TEAM_FI[en];
    if (fi) {
      const normFi = normalizeTeamName(fi);
      if (normFi.includes(norm) || norm.includes(normFi)) {
        return en;
      }
    }
    const normEn = normalizeTeamName(en);
    if (normEn.includes(norm) || norm.includes(normEn)) {
      return en;
    }
  }

  return null;
}

export type YleParsedMatch = {
  home_team: string;
  away_team: string;
  home_score: string;
  away_score: string;
  home_scorers: string[];
  away_scorers: string[];
  finished: boolean;
};

type YleRun = {
  fg?: string;
  bg?: string;
  length?: string;
  Text?: string;
};

type YleTeletextStructuredLine = {
  number?: string;
  run?: YleRun | YleRun[];
};

type YleTeletextLine = {
  number?: string;
  Text?: string;
};

type YleTeletextContentItem = {
  type?: string;
  line?: (YleTeletextLine | YleTeletextStructuredLine)[];
};

type YleTeletextSubpage = {
  content?: YleTeletextContentItem[];
};

type YleTeletextResponse = {
  teletext?: {
    page?: {
      subpage?: YleTeletextSubpage[];
    };
  };
};

function getStructuredRuns(line: YleTeletextStructuredLine): YleRun[] {
  if (!line.run) return [];
  return Array.isArray(line.run) ? line.run : [line.run];
}

function parseYleTeletextJson(json: YleTeletextResponse, allEnglishNames: string[]): YleParsedMatch[] {
  const subpage = json?.teletext?.page?.subpage?.[0];
  if (!subpage?.content) return [];

  // Use structured content which has fg color information
  const structuredContent = subpage.content.find((c) => c.type === "structured");
  if (!structuredContent?.line) return [];

  // Build per-line objects: { text: string, scoreColor: 'green'|'cyan'|null, runs: YleRun[] }
  type ParsedLine = { text: string; scoreColor: string | null; runs: YleRun[] };
  const lineMap = new Map<number, ParsedLine>();

  for (const rawLine of structuredContent.line as YleTeletextStructuredLine[]) {
    const lineNum = rawLine.number ? parseInt(rawLine.number, 10) : NaN;
    if (Number.isNaN(lineNum) || lineNum < 1 || lineNum > 24) continue;

    const runs = getStructuredRuns(rawLine);
    let fullText = "";
    let scoreColor: string | null = null;

    for (const run of runs) {
      const t = run.Text || "";
      fullText += t;
      // Detect score color — the run containing "X-Y" with a color tells us live vs finished
      if (run.fg && (run.fg === "green" || run.fg === "cyan") && /\d+-\d+/.test(t)) {
        scoreColor = run.fg;
      }
    }

    lineMap.set(lineNum, { text: fullText.padEnd(40, " "), scoreColor, runs });
  }

  const parsedMatches: YleParsedMatch[] = [];
  let currentMatch: YleParsedMatch | null = null;

  // Match header: " Meksiko       - Etelä-Afrikka 2-0 (1-0)"
  // Team names may have hyphens (Bosnia-Hertsegovina), so we match greedily up to " - "
  const matchHeaderRegex = /^\s*(.+?)\s+-\s+(.+?)\s+(\d+-\d+(?:\s+\(\d+-\d+\))?)\s*$/;
  const scorerRegex = /^([^#0-9]+?)\s+(#\s*)?(\d+(?:\+\d+)?)\s*$/;

  for (let i = 1; i <= 24; i++) {
    const entry = lineMap.get(i);
    if (!entry) continue;
    const { text: line, scoreColor } = entry;

    const match = line.match(matchHeaderRegex);
    if (match && scoreColor) {
      // Only treat as a match line if there's a color on the score (not a plain "lohko" header etc.)
      const homeFi = match[1].trim();
      const awayFi = match[2].trim();
      const scorePart = match[3].trim();

      const scoreMatch = scorePart.match(/^(\d+)-(\d+)/);
      const homeScore = scoreMatch ? scoreMatch[1] : "";
      const awayScore = scoreMatch ? scoreMatch[2] : "";

      const homeEn = getTeamEnName(homeFi, allEnglishNames) || homeFi;
      const awayEn = getTeamEnName(awayFi, allEnglishNames) || awayFi;

      // green = full-time, cyan = live/in-progress
      const finished = scoreColor === "green";

      currentMatch = {
        home_team: homeEn,
        away_team: awayEn,
        home_score: homeScore,
        away_score: awayScore,
        home_scorers: [],
        away_scorers: [],
        finished,
      };
      parsedMatches.push(currentMatch);
    } else if (currentMatch) {
      const trimmed = line.trim();
      // Stop collecting scorers when we hit an empty line followed by another section,
      // or time info, or a new section header
      if (!trimmed) continue;
      if (trimmed.includes("klo ") || trimmed.toLowerCase().includes("lohko") || trimmed.includes("MM-JALKAPALLO")) {
        currentMatch = null;
        continue;
      }
      // If this line has a score color, it's a new match header — handled in next iteration
      if (scoreColor) continue;

      // Column 17 splits home (left) from away (right) scorers — consistent Teletext layout
      const leftPart = line.slice(0, 17).trim();
      const rightPart = line.slice(17).trim();

      if (leftPart) {
        const m = leftPart.match(scorerRegex);
        if (m && !m[2]) currentMatch.home_scorers.push(`${m[1].trim()} ${m[3]}'`);
      }
      if (rightPart) {
        const m = rightPart.match(scorerRegex);
        if (m && !m[2]) currentMatch.away_scorers.push(`${m[1].trim()} ${m[3]}'`);
      }
    }
  }

  return parsedMatches;
}


const YLE_API_URL = `https://external.api.yle.fi/v1/teletext/pages/601.json?app_id=7aab0368abac138f49f840118ff44f59&app_key=42a40fda`;

export async function fetchYleFallback(allEnglishNames: string[]): Promise<YleParsedMatch[]> {
  // Try Cloudflare Worker proxy first (avoids CORS)
  try {
    const workerBase = API.replace(/\/get\/?$/, "");
    const yleProxyUrl = `${workerBase}/yle-proxy`;
    const json = await fetchJson<YleTeletextResponse>(yleProxyUrl, { cache: "no-store" });
    const results = parseYleTeletextJson(json, allEnglishNames);
    if (results.length > 0) return results;
  } catch {
    // Worker not available or failed — fall through to corsproxy
  }

  // Fallback: corsproxy.io as public CORS proxy (no auth needed, Yle API keys are public)
  try {
    const corsUrl = `https://corsproxy.io/?${encodeURIComponent(YLE_API_URL)}`;
    const json = await fetchJson<YleTeletextResponse>(corsUrl, { cache: "no-store" });
    return parseYleTeletextJson(json, allEnglishNames);
  } catch (err) {
    console.warn("Failed to fetch/parse Yle Teletext fallback:", err);
    return [];
  }
}



export function overlayYleMatches(games: ApiGame[], teams: ApiTeam[], yleMatches: YleParsedMatch[]): ApiGame[] {
  if (!yleMatches || yleMatches.length === 0) return games;

  const allEnglishNames = teams.map((t) => t.name_en);

  return games.map((game) => {
    const homeTeam = teams.find((t) => t.id === game.home_team_id);
    const awayTeam = teams.find((t) => t.id === game.away_team_id);
    const homeEn = homeTeam ? homeTeam.name_en : (game.home_team_name_en || "");
    const awayEn = awayTeam ? awayTeam.name_en : (game.away_team_name_en || "");

    const normHome = normalizeTeamName(homeEn);
    const normAway = normalizeTeamName(awayEn);

    const yleMatch = yleMatches.find((ym) => {
      const ymHomeEn = getTeamEnName(ym.home_team, allEnglishNames) ?? ym.home_team;
      const ymAwayEn = getTeamEnName(ym.away_team, allEnglishNames) ?? ym.away_team;
      const normYleHome = normalizeTeamName(ymHomeEn);
      const normYleAway = normalizeTeamName(ymAwayEn);
      return normYleHome === normHome && normYleAway === normAway;
    });

    if (yleMatch) {
      if (yleMatch.home_score !== "" && yleMatch.away_score !== "") {
        const updatedGame = {
          ...game,
          home_score: yleMatch.home_score,
          away_score: yleMatch.away_score,
          home_scorers: yleMatch.home_scorers.length > 0 ? `{${yleMatch.home_scorers.join(", ")}}` : "null",
          away_scorers: yleMatch.away_scorers.length > 0 ? `{${yleMatch.away_scorers.join(", ")}}` : "null",
          finished: yleMatch.finished ? "TRUE" : "FALSE",
          fallback_source: "yle",
          time_elapsed: yleMatch.finished ? "finished" : "live",
        };

        return updatedGame;
      }
    }

    return game;
  });
}

export function getScoreBadgeText(game: ApiGame): string {
  if (isFinished(game)) {
    return "FULL-TIME";
  }

  const homeGoals = parseScore(game.home_score);
  const awayGoals = parseScore(game.away_score);
  const scored = parseScorers(game.home_scorers).length > 0 || parseScorers(game.away_scorers).length > 0;
  if (isLive(game) && homeGoals === 0 && awayGoals === 0 && !scored) {
    return "EI SYNKATTU";
  }

  const elapsed = String(game.time_elapsed).toLowerCase().trim();

  if (elapsed === "ht" || elapsed === "halftime" || elapsed === "puoliaika") {
    return "45'";
  }

  if (elapsed.includes("+")) {
    const base = elapsed.split("+")[0].trim();
    return `${base}'`;
  }

  const num = parseInt(elapsed, 10);
  if (!isNaN(num)) {
    if (num > 90) return "90'";
    return `${num}'`;
  }

  return "LIVE";
}

