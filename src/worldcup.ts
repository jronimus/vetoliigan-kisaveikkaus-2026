
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
  espn_event_id?: string;
  espn_home_red_cards?: number;
  espn_away_red_cards?: number;
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
const STATIC_DATA = `${import.meta.env.BASE_URL}live-data`;

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

async function fetchOptionalStatic<T>(path: string): Promise<T | undefined> {
  try {
    return await fetchStatic<T>(path);
  } catch {
    return undefined;
  }
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

function mergeStaticEspnFields(primaryGames: ApiGame[], staticGames?: ApiGame[]) {
  if (!staticGames?.length) return primaryGames;
  const staticById = new Map(staticGames.map((game) => [game.id, game]));
  return primaryGames.map((game) => {
    const enriched = staticById.get(game.id);
    if (!enriched) return game;
    return {
      ...game,
      espn_event_id: game.espn_event_id ?? enriched.espn_event_id,
      espn_home_red_cards: game.espn_home_red_cards ?? enriched.espn_home_red_cards,
      espn_away_red_cards: game.espn_away_red_cards ?? enriched.espn_away_red_cards,
    };
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
  const staticGamesJson = await fetchOptionalStatic<{ games: ApiGame[] }>("games.json");

  try {
    const [gamesJson, teamsJson, groupsJson, stadiumsJson] = await Promise.all([
      fetchJson<{ games: ApiGame[] }>(`${API}/games`, { cache: "no-store" }),
      fetchJson<{ teams: ApiTeam[] }>(`${API}/teams`, { cache: "force-cache" }),
      fetchJson<{ groups: ApiGroup[] }>(`${API}/groups`, { cache: "no-store" }),
      fetchJson<{ stadiums: ApiStadium[] }>(`${API}/stadiums`, { cache: "force-cache" }),
    ]);
    state = buildState(
      mergeStaticEspnFields(gamesJson.games ?? [], staticGamesJson?.games),
      teamsJson.teams ?? [],
      groupsJson.groups ?? [],
      stadiumsJson.stadiums ?? [],
      "direct",
    );
  } catch {
    try {
      const [gamesJson, teamsJson, groupsJson, stadiumsJson] = await Promise.all([
        fetchStatic<{ games: ApiGame[] }>("games.json"),
        fetchStatic<{ teams: ApiTeam[] }>("teams.json"),
        fetchStatic<{ groups: ApiGroup[] }>("groups.json"),
        fetchStatic<{ stadiums: ApiStadium[] }>("stadiums.json"),
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

export function stripAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeScorerName(name: string): string {
  const clean = name
    .trim()
    .replace(/\b([A-Za-zÀ-ÖØ-öø-ÿ])\.(?=[A-Za-zÀ-ÖØ-öø-ÿ])/g, "$1. ")
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!clean) return "";

  // Specific common overrides
  if (clean === "kane" || clean === "harry kane" || clean === "h kane") {
    return "H. Kane";
  }
  if (clean === "mbappe" || clean === "mbappe " || clean === "mbappé" || clean === "kylian mbappe" || clean === "kylian mbappé") {
    return "K. Mbappé";
  }
  if (clean === "haaland" || clean === "erling haaland") {
    return "E. Haaland";
  }
  if (clean === "messi" || clean === "lionel messi") {
    return "L. Messi";
  }
  if (clean === "ronaldo" || clean === "cristiano ronaldo") {
    return "C. Ronaldo";
  }
  if (clean === "bellingham" || clean === "jude bellingham") {
    return "J. Bellingham";
  }
  if (
    clean === "vinicius" ||
    clean === "vinicius jr" ||
    clean === "vinicius junior" ||
    clean === "vini jr" ||
    clean === "v. junior" ||
    clean === "v. júnior"
  ) {
    return "Vinícius Jr.";
  }
  if (clean === "a. diallo" || clean === "amad diallo") {
    return "Amad";
  }

  // General case: "First Last" -> "F. Last"
  const parts = clean.split(" ");
  if (parts.length > 1) {
    const first = parts[0];
    const last = parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
    return `${first.charAt(0).toUpperCase()}. ${last}`;
  }

  // Single word: "name" -> "Name"
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export type ParsedScorer = {
  name: string;
  isOwnGoal: boolean;
};

export function parseScorers(value: string): ParsedScorer[] {
  if (!value || value === "null") return [];
  return value
    .replace(/[{}“”"]/g, "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      // Check for own goal indicators: (OG), (o.g.), (og), (om), own goal, oma maali
      const isOwnGoal = /(?:^|[^a-zA-Z])(og|o\.g\.|om|own\s*goal|oma\s*maali)(?:[^a-zA-Z]|$)/i.test(entry);
      
      // Strip the own goal indicator out of the name
      let cleanEntry = entry.replace(/\s*\([^)]*(og|o\.g\.|om|own\s*goal|oma\s*maali)[^)]*\)/gi, "").trim();
      cleanEntry = cleanEntry.replace(/(?:^|[^a-zA-Z])(og|o\.g\.|om|own\s*goal|oma\s*maali)(?:[^a-zA-Z]|$)/gi, "").trim();
      cleanEntry = cleanEntry.replace(/\s*\((?:p|pen|penalty|rangaistuspotku)\)\s*/gi, " ").trim();
      
      // Strip minutes (e.g. "D. Bobadilla 7'" -> "D. Bobadilla")
      // Supporting standard minutes, injury time (e.g. 45'+5', 90'+8', 90+2')
      const nameOnly = cleanEntry.replace(/\s*\b\d+'?(?:\+\d+'?)?\s*$/g, "").trim();
      
      return {
        name: normalizeScorerName(nameOnly),
        isOwnGoal,
      };
    });
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
    parseScorers(game.home_scorers).forEach((scorer) => {
      if (scorer.isOwnGoal) return;
      const name = scorer.name;
      const current = counts.get(name);
      counts.set(name, {
        goals: (current?.goals ?? 0) + 1,
        teamId: game.home_team_id,
      });
    });
    parseScorers(game.away_scorers).forEach((scorer) => {
      if (scorer.isOwnGoal) return;
      const name = scorer.name;
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
  const lockTime = Date.UTC(2026, 5, 12, 19, 0, 0); // 12.06.2026 klo 22.00 Suomen aikaa (UTC+3, so 19:00 UTC)
  return Date.now() >= lockTime;
}

export function normalizeTeamName(name: string): string {
  let n = stripAccents(name).toLowerCase().trim();
  n = n.replace(/ä/g, "a").replace(/ö/g, "o").replace(/å/g, "a");
  n = n.replace(/[^a-z0-9]/g, " ");
  n = n.replace(/\s+/g, " ").trim();
  return n;
}

export function getScoreBadgeText(game: ApiGame): string {
  if (isFinished(game)) {
    return "FULL-TIME";
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
