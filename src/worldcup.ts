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
};

export type ApiTeam = {
  id: string;
  name_en: string;
  flag: string;
  fifa_code: string;
  groups: string;
};

export type WorldCupState = {
  games: ApiGame[];
  teams: ApiTeam[];
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

function buildState(games: ApiGame[], teams: ApiTeam[], source: WorldCupState["source"]) {
  return { games, teams, lastUpdated: new Date(), source };
}

export function loadCachedWorldCup() {
  const saved = localStorage.getItem(CACHE_KEY);
  if (!saved) return undefined;
  try {
    const parsed = JSON.parse(saved) as WorldCupState;
    return { ...parsed, lastUpdated: parsed.lastUpdated ? new Date(parsed.lastUpdated) : undefined, source: "cache" as const };
  } catch {
    return undefined;
  }
}

export function saveCachedWorldCup(state: WorldCupState) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(state));
}

export async function fetchWorldCup(): Promise<WorldCupState> {
  try {
    const [gamesJson, teamsJson] = await Promise.all([
      fetchStatic<{ games: ApiGame[] }>("games.json"),
      fetchStatic<{ teams: ApiTeam[] }>("teams.json"),
    ]);
    return buildState(gamesJson.games ?? [], teamsJson.teams ?? [], "direct");
  } catch {
    // fall through to live endpoints
  }

  try {
    const [gamesJson, teamsJson] = await Promise.all([
      fetchJson<{ games: ApiGame[] }>(`${API}/games`, { cache: "no-store" }),
      fetchJson<{ teams: ApiTeam[] }>(`${API}/teams`, { cache: "force-cache" }),
    ]);
    return buildState(gamesJson.games ?? [], teamsJson.teams ?? [], "direct");
  } catch {
    const [gamesJson, teamsJson] = await Promise.all([
      fetchViaJina<{ games: ApiGame[] }>("https://worldcup26.ir/get/games"),
      fetchViaJina<{ teams: ApiTeam[] }>("https://worldcup26.ir/get/teams"),
    ]);
    return buildState(gamesJson.games ?? [], teamsJson.teams ?? [], "proxy");
  }
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
  const match = game.local_date.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!match) return game.local_date;

  const [, month, day, year, hour, minute] = match;
  const baseUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  const finlandTime = new Date(baseUtc + (STADIUM_TO_FINLAND_HOURS[game.stadium_id] ?? 0) * 60 * 60 * 1000);

  return new Intl.DateTimeFormat("fi-FI", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(finlandTime);
}

export function scorerTable(games: ApiGame[]) {
  const counts = new Map<string, number>();
  games.forEach((game) => {
    [...parseScorers(game.home_scorers), ...parseScorers(game.away_scorers)].forEach((name) => {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    });
  });
  return [...counts.entries()]
    .map(([name, goals]) => ({ name, goals }))
    .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name));
}
