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
};

const API = import.meta.env.VITE_WORLDCUP_API_BASE || "https://worldcup26.ir/get";

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
    home_score: "1",
    away_score: "0",
    home_scorers: "{J. Quinones 9'}",
    away_scorers: "null",
    group: "A",
    matchday: "1",
    local_date: "06/11/2026 13:00",
    stadium_id: "1",
    finished: "FALSE",
    time_elapsed: "live",
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

export async function fetchWorldCup(): Promise<WorldCupState> {
  const [gamesRes, teamsRes] = await Promise.all([
    fetch(`${API}/games`, { cache: "no-store" }),
    fetch(`${API}/teams`, { cache: "force-cache" }),
  ]);

  if (!gamesRes.ok || !teamsRes.ok) {
    throw new Error("MM-rajapinta ei vastannut odotetusti.");
  }

  const gamesJson = (await gamesRes.json()) as { games: ApiGame[] };
  const teamsJson = (await teamsRes.json()) as { teams: ApiTeam[] };
  return { games: gamesJson.games ?? [], teams: teamsJson.teams ?? [], lastUpdated: new Date() };
}

export function isFinished(game: ApiGame) {
  return String(game.finished).toLowerCase() === "true";
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
