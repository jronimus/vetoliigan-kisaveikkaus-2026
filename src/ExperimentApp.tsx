import { useEffect, useMemo, useState, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { CalendarDays, LogIn, LogOut, MapPin, Trophy, Tv, X } from "lucide-react";
import clsx from "clsx";
import joniLogo from "./assets/joni-logo.png";
import appLogo from "./assets/logo-inverted.png";

const backgroundImageModules = import.meta.glob<string>("./assets/wc26-backgrounds/*.{jpg,jpeg,png,webp}", {
  eager: true,
  import: "default",
});
const WC26_BACKGROUNDS = Object.values(backgroundImageModules);

export type GameStatus = "upcoming" | "live" | "finished";
import { auth, db, firebaseEnabled, provider } from "./firebase";
import { TEAM_FI, SEEDED_PLAYERS, type BonusPicks, type PlayerName, type PlayerState, type Prediction } from "./data";
import { enrichGamesWithEspn, fetchEspnMatchSummary, type EspnLineupPlayer, type EspnMatchSummary, type EspnRosterSide } from "./espn";
import { matchPoints, standings } from "./scoring";
import { tvChannelsForGame } from "./tvSchedule";
import {
  FALLBACK_GAMES,
  FALLBACK_STADIUMS,
  FALLBACK_TEAMS,
  archivedMatch,
  currentFinlandClockMillis,
  fetchWorldCup,
  finlandClockDate,
  isBonusLocked,
  isFinished,
  isLive,
  loadCachedWorldCup,
  parseScore,
  predictionLocked,
  saveCachedWorldCup,
  scorerTable,
  teamName,
  normalizeScorerName,
  stripAccents,
  type ApiGame,
  type ApiStadium,
  type ApiTeam,
} from "./worldcup";

type MainView = "matches" | "tables" | "stats";

function firstName(user: User | null) {
  const raw = user?.displayName || user?.email?.split("@")[0] || "";
  return raw.split(/\s|\.|-/)[0];
}

function allowedName(name: string) {
  return (["Santeri", "Sami", "Ilpo", "Joni"] as const).find((player) => player.toLowerCase() === name.toLowerCase());
}

function localPlayers() {
  const saved = localStorage.getItem("vetoliiga.players");
  if (!saved) return SEEDED_PLAYERS.map(normalizePlayerState);
  try {
    return (JSON.parse(saved) as PlayerState[]).map(normalizePlayerState);
  } catch {
    return SEEDED_PLAYERS.map(normalizePlayerState);
  }
}

function saveLocal(players: PlayerState[]) {
  localStorage.setItem("vetoliiga.players", JSON.stringify(players));
}

function normalizeTeam(name: string) {
  const normalized = TEAM_FI[name] ?? name;
  if (normalized === "Kongon demokraattinen tasavalta") return "DR Kongo";
  return normalized;
}

const TEAM_HYPHENATION: Record<string, string> = {
  Norsunluurannikko: ["Nor", "sun", "luu", "ran", "nik", "ko"].join("\u00ad"),
  "DR Kongo": "DR Kongo",
};

function hyphenatedTeamName(name: string) {
  return TEAM_HYPHENATION[name] ?? name;
}


export function normalizeCountryName(name: string): string {
  const clean = name.trim();
  if (!clean) return "";

  // Check if it's already in TEAM_FI (value)
  const fiValues = Object.values(TEAM_FI);
  const matchedValue = fiValues.find(v => v.toLowerCase() === clean.toLowerCase());
  if (matchedValue) return matchedValue;

  // Check if it's in TEAM_FI (key)
  const matchedKey = Object.keys(TEAM_FI).find(k => k.toLowerCase() === clean.toLowerCase());
  if (matchedKey) return TEAM_FI[matchedKey];

  // Specific custom spelling normalization mappings (e.g. English -> Finnish, common typos/variations)
  const cleanLower = clean.toLowerCase();
  const customMap: Record<string, string> = {
    "argentina": "Argentiina",
    "argentiina": "Argentiina",
    "brasilia": "Brasilia",
    "brazil": "Brasilia",
    "hollanti": "Hollanti",
    "netherlands": "Hollanti",
    "alankomaat": "Hollanti",
    "englanti": "Englanti",
    "england": "Englanti",
    "ranska": "Ranska",
    "france": "Ranska",
    "saksa": "Saksa",
    "germany": "Saksa",
    "espanja": "Espanja",
    "spain": "Espanja",
    "portugali": "Portugali",
    "portugal": "Portugali",
    "italia": "Italia",
    "italy": "Italia",
    "belgia": "Belgia",
    "belgium": "Belgia",
    "kroatia": "Kroatia",
    "croatia": "Kroatia",
    "tsekki": "Tšekki",
    "tshekki": "Tšekki",
    "yhdysvallat": "USA",
    "usa": "USA",
    "united states": "USA",
    "bosnia": "Bosnia ja Hertsegovina",
    "bosnia ja hertsegovina": "Bosnia ja Hertsegovina",
    "bosnia-hertsegovina": "Bosnia ja Hertsegovina",
    "bosnia & hertsegovina": "Bosnia ja Hertsegovina",
    "etela-afrikka": "Etelä-Afrikka",
    "etela-korea": "Etelä-Korea",
    "uusi seelanti": "Uusi-Seelanti",
    "uusi-seelanti": "Uusi-Seelanti",
    "saudi arabia": "Saudi-Arabia",
    "saudi-arabia": "Saudi-Arabia",
    "kongon demokraattinen tasavalta": "DR Kongo",
    "kongo": "DR Kongo",
  };

  if (customMap[cleanLower]) {
    return customMap[cleanLower];
  }

  // Capitalize first letter as fallback
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}


export function scorerNamesMatch(picked: string, apiName: string): boolean {
  const normPicked = stripAccents(normalizeScorerName(picked)).toLowerCase();
  const normApi = stripAccents(normalizeScorerName(apiName)).toLowerCase();

  if (normPicked === normApi) return true;

  const pickedParts = normPicked.split(" ");
  const apiParts = normApi.split(" ");
  const pickedLast = pickedParts[pickedParts.length - 1];
  const apiLast = apiParts[apiParts.length - 1];

  if (pickedLast && apiLast && pickedLast === apiLast) {
    const pickedInitial = pickedParts.length > 1 && pickedParts[0].endsWith(".") ? pickedParts[0].slice(0, 1) : null;
    const apiInitial = apiParts.length > 1 && apiParts[0].endsWith(".") ? apiParts[0].slice(0, 1) : null;

    if (pickedInitial && apiInitial && pickedInitial !== apiInitial) {
      return false;
    }
    return true;
  }

  return false;
}

export function normalizePlayerState(p: PlayerState): PlayerState {
  return {
    ...p,
    bonus: {
      champion: normalizeCountryName(p.bonus?.champion || ""),
      topScorer: normalizeScorerName(p.bonus?.topScorer || ""),
      surprise: normalizeCountryName(p.bonus?.surprise || ""),
      flop: normalizeCountryName(p.bonus?.flop || ""),
    }
  };
}

function teamById(teams: ApiTeam[], id: string) {
  return teams.find((team) => team.id === id);
}

function teamByName(teams: ApiTeam[], name: string) {
  return teams.find((team) => team.name_en === name);
}

const TEAM_COLOR_PALETTES: Record<string, [string, string]> = {
  argentina: ["#75aadb", "#ffffff"],
  algeria: ["#006233", "#ffffff"],
  australia: ["#f6c915", "#00843d"],
  austria: ["#ed2939", "#ffffff"],
  belgium: ["#fae042", "#ed2939"],
  bosniaandherzegovina: ["#002f6c", "#f7d116"],
  brazil: ["#009c3b", "#ffdf00"],
  canada: ["#d80621", "#ffffff"],
  capeverde: ["#003893", "#cf2027"],
  chile: ["#d52b1e", "#0039a6"],
  colombia: ["#fcd116", "#ce1126"],
  croatia: ["#ff0000", "#171796"],
  curacao: ["#002b7f", "#f9e814"],
  curaao: ["#002b7f", "#f9e814"],
  czechrepublic: ["#11457e", "#d7141a"],
  democraticrepublicofthecongo: ["#007fff", "#f7d618"],
  denmark: ["#c60c30", "#ffffff"],
  ecuador: ["#ffdd00", "#034ea2"],
  egypt: ["#ce1126", "#ffffff"],
  england: ["#ffffff", "#ce1124"],
  france: ["#0055a4", "#ef4135"],
  germany: ["#ffce00", "#dd0000"],
  ghana: ["#fcd116", "#006b3f"],
  haiti: ["#00209f", "#d21034"],
  iran: ["#239f40", "#da0000"],
  iraq: ["#ce1126", "#007a3d"],
  italy: ["#008c45", "#cd212a"],
  ivorycoast: ["#f77f00", "#009e60"],
  japan: ["#bc002d", "#ffffff"],
  jordan: ["#007a3d", "#ce1126"],
  mexico: ["#006847", "#ce1126"],
  morocco: ["#c1272d", "#006233"],
  netherlands: ["#ff4f00", "#21468b"],
  newzealand: ["#00247d", "#cc142b"],
  norway: ["#ba0c2f", "#00205b"],
  panama: ["#005293", "#d21034"],
  paraguay: ["#d52b1e", "#0038a8"],
  portugal: ["#006600", "#ff0000"],
  qatar: ["#8a1538", "#ffffff"],
  saudiarabia: ["#006c35", "#ffffff"],
  scotland: ["#005eb8", "#ffffff"],
  senegal: ["#00853f", "#fdef42"],
  southafrica: ["#007a4d", "#ffb612"],
  southkorea: ["#c60c30", "#003478"],
  spain: ["#aa151b", "#f1bf00"],
  sweden: ["#006aa7", "#fecc00"],
  switzerland: ["#ff0000", "#ffffff"],
  tunisia: ["#e70013", "#ffffff"],
  turkey: ["#e30a17", "#ffffff"],
  unitedstates: ["#3c3b6e", "#b22234"],
  uruguay: ["#0038a8", "#fcd116"],
  uzbekistan: ["#1eb6e9", "#009b3a"],
};

function hexRgb(hex: string) {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function colorDistance(hexA: string, hexB: string) {
  const [ar, ag, ab] = hexRgb(hexA);
  const [br, bg, bb] = hexRgb(hexB);
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
}

function textColorForBackground(hex: string) {
  const [r, g, b] = hexRgb(hex);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.62 ? "#050505" : "#ffffff";
}

function fallbackTeamPalette(name: string): [string, string] {
  const palette: [string, string][] = [
    ["#ff2b17", "#1de8d6"],
    ["#1d56eb", "#efff19"],
    ["#0ad23f", "#ff2bb7"],
    ["#a180ea", "#b9d637"],
    ["#ff9a00", "#1de8d6"],
  ];
  const hash = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return palette[hash % palette.length];
}

function teamPalette(name: string): [string, string] {
  const key = stripAccents(name).toLowerCase().replace(/[^a-z]/g, "");
  return TEAM_COLOR_PALETTES[key] ?? fallbackTeamPalette(key);
}

function matchTeamColors(homeName: string, awayName: string) {
  const homePalette = teamPalette(homeName);
  const awayPalette = teamPalette(awayName);
  const homeColor = homePalette[0];
  let awayColor = awayPalette[0];
  if (colorDistance(homeColor, awayColor) < 90) {
    awayColor = colorDistance(homeColor, awayPalette[1]) >= 90 ? awayPalette[1] : fallbackTeamPalette(`${awayName}-away`)[0];
  }
  return { homeColor, awayColor };
}

function createTwoToneLogoDataUri(lightColor: string, darkColor: string) {
  const svg = `<svg width="419" height="419" viewBox="0 0 419 419" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="419" height="419" rx="106" fill="${darkColor}"/><path d="M118.314 205.434C106.724 205.434 97.1975 205.275 89.7351 204.958C82.4314 204.483 76.7155 203.373 72.5874 201.629C68.4593 199.886 65.5219 196.953 63.7754 192.832C62.0289 188.711 60.9175 183.005 60.4412 175.713C60.1236 168.263 59.9648 158.753 59.9648 147.182V74C59.9648 54.67 75.6349 39 94.9648 39H96.4133C115.743 39 131.413 54.67 131.413 74V129.35C131.413 130.171 131.428 130.874 131.458 131.458C131.515 132.588 132.01 133.705 133.108 133.975C133.273 134.015 133.45 134.051 133.639 134.081C133.742 134.098 133.848 134.105 133.953 134.105C135.181 134.105 136.177 133.109 136.177 131.881V74C136.177 54.67 151.847 39 171.177 39H172.625C191.955 39 207.625 54.67 207.625 74V147.182C207.625 158.753 207.387 168.263 206.911 175.713C206.593 183.005 205.561 188.711 203.814 192.832C202.068 196.953 199.131 199.886 195.003 201.629C190.874 203.373 185.159 204.483 177.855 204.958C170.551 205.275 161.025 205.434 149.275 205.434H118.314Z" fill="${lightColor}"/><path d="M359.965 170.434C359.965 189.764 344.295 205.434 324.965 205.434H247.305C227.975 205.434 212.305 189.764 212.305 170.434V97.2518C212.305 85.5221 212.463 76.0117 212.781 68.7203C213.257 61.4289 214.369 55.7226 216.115 51.6014C217.862 47.4802 220.799 44.5478 224.927 42.8042C229.055 41.0606 234.771 40.0303 242.075 39.7133C249.537 39.2378 259.064 39 270.654 39H338.566C350.384 39 359.965 48.5805 359.965 60.3986C359.965 72.2167 350.384 81.7972 338.566 81.7972H296.852C294.908 81.7972 293.651 81.9556 293.083 82.2725C292.867 82.3925 292.844 82.4076 292.721 82.6213C291.692 84.413 294.002 86.5525 296.069 86.5525H338.566C350.384 86.5525 359.965 96.1329 359.965 107.951C359.965 119.769 350.384 129.35 338.566 129.35H296.852C294.908 129.35 293.651 129.508 293.083 129.825C292.867 129.945 292.844 129.96 292.721 130.174C291.692 131.965 294.002 134.105 296.069 134.105H326.146C344.824 134.105 359.965 149.246 359.965 167.924V170.434Z" fill="${lightColor}"/><path d="M169.468 367.112C169.468 373.678 164.146 379 157.58 379H109.908C103.342 379 98.0195 373.678 98.0195 367.112C98.0195 360.546 92.6971 355.224 86.1314 355.224H82.539C73.9894 355.224 67.0585 348.293 67.0585 339.743V247.566C67.0585 228.236 82.7286 212.566 102.059 212.566H165.429C184.759 212.566 200.429 228.236 200.429 247.566V339.743C200.429 348.293 193.498 355.224 184.949 355.224H181.356C174.791 355.224 169.468 360.546 169.468 367.112Z" fill="${lightColor}"/><path d="M294.522 212.566C306.112 212.566 315.559 212.804 322.863 213.28C330.325 213.597 336.12 214.627 340.249 216.371C344.377 218.114 347.314 221.047 349.061 225.168C350.807 229.289 351.839 234.995 352.157 242.287C352.633 249.578 352.871 259.089 352.871 270.818V320.748C352.871 332.319 352.633 341.83 352.157 349.28C351.839 356.571 350.807 362.277 349.061 366.399C347.314 370.52 344.377 373.452 340.249 375.196C336.12 376.939 330.405 378.049 323.101 378.524C315.797 378.841 306.271 379 294.522 379H263.561C251.97 379 242.444 378.841 234.981 378.524C227.677 378.049 221.962 376.939 217.833 375.196C213.705 373.452 210.768 370.52 209.021 366.399C207.275 362.277 206.164 356.571 205.687 349.28C205.37 341.83 205.211 332.319 205.211 320.748V270.818C205.211 259.089 205.37 249.578 205.687 242.287C206.164 234.995 207.275 229.289 209.021 225.168C210.768 221.047 213.705 218.114 217.833 216.371C221.962 214.627 227.677 213.597 234.981 213.28C242.444 212.804 251.97 212.566 263.561 212.566H294.522ZM280.463 260.614C278.806 259.622 276.659 261.685 276.659 263.617V302.916C276.659 304.586 276.738 305.786 276.894 306.518C276.994 306.985 277 307.19 277.453 307.341C279.351 307.973 281.423 306.05 281.423 304.05V264.874C281.423 263.224 281.308 262.07 281.078 261.412C280.926 260.976 280.86 260.852 280.463 260.614Z" fill="${lightColor}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function stadiumById(stadiums: ApiStadium[], id: string) {
  return stadiums.find((stadium) => stadium.id === id);
}

function stageLabel(game: ApiGame) {
  if (game.type === "group") return `Lohko ${game.group}`;
  if (game.type === "r32") return "32 parasta";
  if (game.type === "r16") return "16 parasta";
  if (game.type === "qf") return "Puolivälierä";
  if (game.type === "sf") return "Välierä";
  if (game.type === "third") return "Pronssi";
  if (game.type === "final") return "Finaali";
  return game.type;
}



const WEEKDAYS_FI = ["Sunnuntai", "Maanantai", "Tiistai", "Keskiviikko", "Torstai", "Perjantai", "Lauantai"];

function getKickoffStatus(game: ApiGame, now: number) {
  if (isFinished(game)) return { text: "Päättynyt", type: "finished" };
  if (isLive(game)) {
    const elapsed = String(game.time_elapsed).trim();
    const normalizedElapsed = elapsed.toLowerCase();
    if (/\b(ht|half\s*time|halftime|puoliaika)\b/.test(normalizedElapsed)) {
      return { text: "Puoliaika", type: "live" };
    }
    return { text: elapsed && normalizedElapsed !== "live" ? elapsed : "Live", type: "live" };
  }

  const kickoff = finlandClockDate(game);
  if (!kickoff) return { text: "Tulossa", type: "upcoming" };

  const diffMs = kickoff.getTime() - now;

  if (diffMs <= 0) {
    return { text: "Live", type: "live" };
  }

  if (diffMs <= 60 * 60 * 1000) {
    const diffMinutes = Math.floor(diffMs / (60 * 1000));
    const diffSeconds = Math.floor((diffMs % (60 * 1000)) / 1000);
    const mm = String(diffMinutes).padStart(2, "0");
    const ss = String(diffSeconds).padStart(2, "0");
    return { text: `Alkaa ${mm}:${ss}`, type: "upcoming" };
  }

  return { text: "Tulossa", type: "upcoming" };
}

function dateLabel(game: ApiGame) {
  const kickoff = finlandClockDate(game);
  if (!kickoff) return game.local_date;
  const dayName = WEEKDAYS_FI[kickoff.getUTCDay()];
  const datePart = new Intl.DateTimeFormat("fi-FI", {
    day: "numeric",
    month: "numeric",
    timeZone: "UTC",
  }).format(kickoff);
  return `${dayName} ${datePart}`;
}

function kickoffMillis(game: ApiGame) {
  return finlandClockDate(game)?.getTime() ?? Number.MAX_SAFE_INTEGER;
}

function cityCountry(stadiums: ApiStadium[], game: ApiGame) {
  const stadium = stadiumById(stadiums, game.stadium_id);
  if (!stadium) return "";
  let location = `${stadium.city_en}, ${normalizeTeam(stadium.country_en)}`;
  location = location.replace(/\s*\([^)]*\)/g, "");
  location = location.replace(/Yhdysvallat/gi, "USA");
  return location;
}

type ScorerDisplay = {
  name: string;
  minutes: string[];
  isOwnGoal: boolean;
  isPenalty: boolean;
};

function scorerDisplayLines(value: string) {
  if (!value || value === "null") return [];
  const grouped = new Map<string, ScorerDisplay>();

  value
    .replace(/[{}“”"]/g, "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const isOwnGoal = /(?:^|[^a-zA-Z])(og|o\.g\.|om|own\s*goal|oma\s*maali)(?:[^a-zA-Z]|$)/i.test(entry);
      const isPenalty = /\((?:p|pen|penalty|rangaistuspotku)\)/i.test(entry);
      const minuteMatch = entry.match(/\b\d+'?(?:\+\d+'?)?\b/);
      let cleanEntry = entry.replace(/\s*\([^)]*(og|o\.g\.|om|own\s*goal|oma\s*maali)[^)]*\)/gi, " ");
      cleanEntry = cleanEntry.replace(/\s*\((?:p|pen|penalty|rangaistuspotku)\)\s*/gi, " ");
      cleanEntry = cleanEntry.replace(/\s*\b\d+'?(?:\+\d+'?)?\s*$/g, " ").trim();
      const name = normalizeScorerName(cleanEntry);
      if (!name) return;
      const key = `${name}|${isOwnGoal}`;
      const current = grouped.get(key) ?? { name, minutes: [], isOwnGoal, isPenalty: false };
      if (minuteMatch?.[0]) {
        const minute = minuteMatch[0].endsWith("'") ? minuteMatch[0] : `${minuteMatch[0]}'`;
        current.minutes.push(minute);
      }
      current.isPenalty = current.isPenalty || isPenalty;
      grouped.set(key, current);
    });

  return [...grouped.values()].map((item) => {
    const suffixes = [
      item.minutes.length ? item.minutes.join(", ") : "",
      item.isPenalty ? "(p)" : "",
      item.isOwnGoal ? "(OM)" : "",
    ].filter(Boolean);
    if (!suffixes.length) return item.name;
    return `${item.name} ${suffixes.join(" ")}`;
  });
}

function chronologicalGames(games: ApiGame[]) {
  return [...games].sort((a, b) => {
    const kickoffDiff = kickoffMillis(a) - kickoffMillis(b);
    if (kickoffDiff !== 0) return kickoffDiff;
    return Number(a.id) - Number(b.id);
  });
}

function computeGroupTables(games: ApiGame[], teams: ApiTeam[]) {
  const groups = [...new Set(games.filter((game) => game.type === "group").map((game) => game.group))].sort((a, b) => a.localeCompare(b));

  return groups.map((group) => {
    const groupGames = games.filter((game) => game.type === "group" && game.group === group);
    const teamIds = [...new Set(groupGames.flatMap((game) => [game.home_team_id, game.away_team_id]).filter((id) => id && id !== "0"))];

    const rows = teamIds.map((teamId) => ({
      teamId,
      mp: 0,
      w: 0,
      d: 0,
      l: 0,
      gf: 0,
      ga: 0,
      gd: 0,
      pts: 0,
    }));

    const rowMap = new Map(rows.map((row) => [row.teamId, row]));

    groupGames.forEach((game) => {
      if (!isFinished(game)) return;
      const home = rowMap.get(game.home_team_id);
      const away = rowMap.get(game.away_team_id);
      if (!home || !away) return;

      const homeGoals = parseScore(game.home_score);
      const awayGoals = parseScore(game.away_score);

      home.mp += 1;
      away.mp += 1;
      home.gf += homeGoals;
      home.ga += awayGoals;
      away.gf += awayGoals;
      away.ga += homeGoals;
      home.gd = home.gf - home.ga;
      away.gd = away.gf - away.ga;

      if (homeGoals > awayGoals) {
        home.w += 1;
        away.l += 1;
        home.pts += 3;
      } else if (homeGoals < awayGoals) {
        away.w += 1;
        home.l += 1;
        away.pts += 3;
      } else {
        home.d += 1;
        away.d += 1;
        home.pts += 1;
        away.pts += 1;
      }
    });

    rows.sort((a, b) =>
      b.pts - a.pts ||
      b.gd - a.gd ||
      b.gf - a.gf ||
      normalizeTeam(teamById(teams, a.teamId)?.name_en ?? "").localeCompare(normalizeTeam(teamById(teams, b.teamId)?.name_en ?? "")),
    );

    return { name: group, rows };
  });
}

function InlinePredictionEditor({
  player,
  game,
  players,
  setPlayers,
  onSaveComplete,
}: {
  player: PlayerState;
  game: ApiGame;
  players: PlayerState[];
  setPlayers: (players: PlayerState[]) => void;
  onSaveComplete: () => void;
}) {
  const prediction = player.predictions.find((item) => item.matchId === game.id);
  const [homeDraft, setHomeDraft] = useState(prediction ? String(prediction.home) : "");
  const [awayDraft, setAwayDraft] = useState(prediction ? String(prediction.away) : "");
  const [saveError, setSaveError] = useState<string | null>(null);

  async function save() {
    const home = Number.parseInt(homeDraft, 10);
    const away = Number.parseInt(awayDraft, 10);
    if (!Number.isFinite(home) || !Number.isFinite(away) || home < 0 || away < 0) return;

    setSaveError(null);
    const nextPrediction: Prediction = { matchId: game.id, home, away, locked: predictionLocked(game) };
    const nextPlayer = {
      ...player,
      predictions: [...player.predictions.filter((item) => item.matchId !== game.id), nextPrediction],
    };
    const nextPlayers = players.map((item) => (item.name === player.name ? nextPlayer : item));

    // Optimistic update
    setPlayers(nextPlayers);
    saveLocal(nextPlayers);
    onSaveComplete();

    try {
      if (firebaseEnabled && db) {
        await setDoc(doc(db, "players", player.name), nextPlayer, { merge: true });
      }
    } catch (err: any) {
      console.error("Error saving match prediction:", err);
      setSaveError(err.message || String(err));
    }
  }

  return (
    <div className="prediction-row inline-edit" style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "stretch" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <strong className="pred-player-name">{player.name}</strong>
        <div className="pred-score-wrap inline-edit-inputs">
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            value={homeDraft}
            onChange={(e) => setHomeDraft(e.target.value)}
            className="inline-edit-input"
          />
          <span>:</span>
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            value={awayDraft}
            onChange={(e) => setAwayDraft(e.target.value)}
            className="inline-edit-input"
          />
        </div>
        <div className="pred-points-wrap">
          <button className="primary-btn compact" onClick={save}>Tallenna</button>
        </div>
      </div>
      {saveError && (
        <div style={{ color: "var(--accent-red)", fontSize: "10px", textAlign: "right", marginTop: "-2px" }}>
          Virhe: {saveError}
        </div>
      )}
    </div>
  );
}

const BORDER_PALETTE = [
  "#ff2b17", // Red
  "#efff19", // Yellow
  "#0ad23f", // Green
  "#1de8d6", // Cyan
  "#1d56eb", // Blue
  "#ff2bb7", // Pink
  "#7f00ff", // Purple
  "#ff9800", // Orange
];

function getSeededRandom(seedStr: string) {
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = seedStr.charCodeAt(i) + ((hash << 5) - hash);
  }
  return function () {
    const x = Math.sin(hash++) * 10000;
    return x - Math.floor(x);
  };
}

function generateCardBackdropStyle(gameId: string) {
  const rand = getSeededRandom(gameId);

  // Shuffled colors from BORDER_PALETTE
  const shuffledColors = [...BORDER_PALETTE].sort(() => rand() - 0.5);
  const c1 = shuffledColors[0];
  const c2 = shuffledColors[1];
  const c3 = shuffledColors[2];
  const c4 = shuffledColors[3];

  // Center point: cx, cy (30% to 70%)
  const cx = Math.floor(rand() * 40) + 30;
  const cy = Math.floor(rand() * 40) + 30;

  // Edge points: tx, ry, bx, ly (20% to 80%)
  const tx = Math.floor(rand() * 60) + 20;
  const ry = Math.floor(rand() * 60) + 20;
  const bx = Math.floor(rand() * 60) + 20;
  const ly = Math.floor(rand() * 60) + 20;

  return {
    style: {
      position: "absolute" as const,
      inset: "0px",
      width: "100%",
      height: "100%",
      zIndex: 1,
    },
    cx, cy,
    tx, ry, bx, ly,
    c1, c2, c3, c4,
  };
}

function useContainerWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState<number>(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        setWidth(entries[0].contentRect.width);
      }
    });

    observer.observe(element);
    return () => {
      observer.unobserve(element);
    };
  }, [ref]);

  return width;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function groupAdjacentGamesByDay(rowGames: ApiGame[]): ApiGame[][] {
  if (rowGames.length === 0) return [];
  const groups: ApiGame[][] = [];
  let currentGroup: ApiGame[] = [rowGames[0]];

  for (let i = 1; i < rowGames.length; i++) {
    const prevGame = rowGames[i - 1];
    const currGame = rowGames[i];
    if (dateLabel(prevGame) === dateLabel(currGame)) {
      currentGroup.push(currGame);
    } else {
      groups.push(currentGroup);
      currentGroup = [currGame];
    }
  }
  groups.push(currentGroup);
  return groups;
}

type DetailStatItem = { key: string; label: string; value: string };

const DETAIL_STAT_ORDER: Array<{ key: string; label: string; section?: "top" | "shots" }> = [
  { key: "possessionPct", label: "Pallonhallinta", section: "top" },
  { key: "expectedGoals", label: "xG", section: "top" },
  { key: "totalShots", label: "Laukaukset", section: "top" },
  { key: "shotsOnTarget", label: "Maalia kohti", section: "top" },
  { key: "accuratePasses", label: "Onnistuneet syötöt", section: "top" },
  { key: "yellowCards", label: "Keltaiset kortit", section: "top" },
  { key: "wonCorners", label: "Kulmat", section: "top" },
  { key: "blockedShots", label: "Blokatut laukaukset", section: "shots" },
  { key: "saves", label: "Torjunnat", section: "shots" },
  { key: "foulsCommitted", label: "Rikkeet" },
  { key: "offsides", label: "Paitsiot" },
  { key: "totalTackles", label: "Taklaukset" },
  { key: "interceptions", label: "Katkot" },
  { key: "totalClearance", label: "Purkupallot" },
];

function statNumericValue(value?: string) {
  if (!value) return undefined;
  const numeric = Number(value.replace("%", ""));
  return Number.isFinite(numeric) ? numeric : undefined;
}

function formatStatValue(key: string, value?: string, sideStats?: Map<string, DetailStatItem>) {
  if (!value) return "-";
  if (key === "possessionPct") return `${Math.round(Number(value))}%`;
  if (key === "accuratePasses") {
    const pct = sideStats?.get("passPct")?.value;
    const pctValue = pct ? `${Math.round(Number(pct) * 100)}%` : undefined;
    return pctValue ? `${value} (${pctValue})` : value;
  }
  if (key.endsWith("Pct")) return `${Math.round(Number(value) * 100)}%`;
  return value;
}

function DetailStatRows({
  home,
  away,
  homeColor,
  awayColor,
}: {
  home: DetailStatItem[];
  away: DetailStatItem[];
  homeColor: string;
  awayColor: string;
}) {
  const homeStats = new Map(home.map((stat) => [stat.key, stat]));
  const awayStats = new Map(away.map((stat) => [stat.key, stat]));
  const ordered = DETAIL_STAT_ORDER.filter((item) => homeStats.has(item.key) || awayStats.has(item.key));
  if (!ordered.length) return <div className="match-detail-empty">Tilastoja ei ole vielä saatavilla.</div>;
  const possessionHome = statNumericValue(homeStats.get("possessionPct")?.value) ?? 50;
  const possessionAway = statNumericValue(awayStats.get("possessionPct")?.value) ?? 100 - possessionHome;

  return (
    <div className="match-detail-stat-list">
      {ordered.map((item, index) => {
        const homeValue = formatStatValue(item.key, homeStats.get(item.key)?.value, homeStats);
        const awayValue = formatStatValue(item.key, awayStats.get(item.key)?.value, awayStats);
        const homeNumeric = statNumericValue(homeStats.get(item.key)?.value);
        const awayNumeric = statNumericValue(awayStats.get(item.key)?.value);
        const homeHighlight = typeof homeNumeric === "number" && typeof awayNumeric === "number" && homeNumeric > awayNumeric;
        const awayHighlight = typeof homeNumeric === "number" && typeof awayNumeric === "number" && awayNumeric > homeNumeric;
        const showShotsHeader = item.section === "shots" && ordered[index - 1]?.section !== "shots";
        return (
          <div className="detail-stat-block" key={item.key}>
            {showShotsHeader ? <h4>Vedot</h4> : null}
            {item.key === "possessionPct" ? (
              <div className="detail-possession-stat">
                <span>Pallonhallinta</span>
                <div className="detail-possession-bar">
                  <strong style={{ width: `${possessionHome}%`, background: homeColor, color: textColorForBackground(homeColor) }}>{homeValue}</strong>
                  <strong style={{ width: `${possessionAway}%`, background: awayColor, color: textColorForBackground(awayColor) }}>{awayValue}</strong>
                </div>
              </div>
            ) : (
              <div className="match-detail-stat-row">
                <strong className={clsx(homeHighlight && "highlight")} style={homeHighlight ? { background: homeColor, color: textColorForBackground(homeColor) } : undefined}>{homeValue}</strong>
                <span>{item.label}</span>
                <strong className={clsx(awayHighlight && "highlight")} style={awayHighlight ? { background: awayColor, color: textColorForBackground(awayColor) } : undefined}>{awayValue}</strong>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function parseFormationLines(formation?: string) {
  return (formation ?? "")
    .split("-")
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part) && part > 0);
}

function isGoalkeeper(player: EspnLineupPlayer) {
  const raw = (player.position ?? "").toUpperCase();
  return raw === "G" || raw.includes("GOAL");
}

function lineYPositions(count: number, lineIndex?: number, lineCount?: number) {
  if (count <= 1) return [50];
  if (count === 2 && typeof lineIndex === "number" && typeof lineCount === "number" && lineIndex === lineCount - 2) return [28, 72];
  if (count === 2) return [38, 62];
  if (count === 3) return [28, 50, 72];
  if (count === 4) return [14, 38, 62, 86];
  if (count === 5) return [10, 30, 50, 70, 90];
  const step = 80 / (count - 1);
  return Array.from({ length: count }, (_, index) => 10 + step * index);
}

function lateralTarget(player: EspnLineupPlayer) {
  const raw = (player.position ?? "").toUpperCase();
  if (raw === "LCB" || raw === "CD-L" || raw === "CB-L" || raw === "LCM" || raw === "CM-L" || raw === "CF-L") return 38;
  if (raw === "RCB" || raw === "CD-R" || raw === "CB-R" || raw === "RCM" || raw === "CM-R" || raw === "CF-R") return 62;
  if (raw === "LAM" || raw === "AM-L") return 28;
  if (raw === "RAM" || raw === "AM-R") return 72;
  if (raw === "LB" || raw === "LWB" || raw === "LM" || raw === "LW" || raw === "LF") return 14;
  if (raw === "RB" || raw === "RWB" || raw === "RM" || raw === "RW" || raw === "RF") return 86;
  if (raw.endsWith("-L") || raw.includes("LEFT")) return 28;
  if (raw.endsWith("-R") || raw.includes("RIGHT")) return 72;
  return 50;
}

function desktopLineXPositions(lineCount: number, side: "home" | "away") {
  const start = side === "home" ? 18 : 82;
  const end = side === "home" ? 43 : 57;
  if (lineCount <= 1) return [end];
  const step = (end - start) / (lineCount - 1);
  return Array.from({ length: lineCount }, (_, index) => start + step * index);
}

function lineIndexTarget(player: EspnLineupPlayer, lines: number[]) {
  const raw = (player.position ?? "").toUpperCase();
  const last = Math.max(0, lines.length - 1);
  if (!raw) return undefined;
  if (raw === "G" || raw.includes("GOAL")) return -1;
  if (raw === "LB" || raw === "LWB" || raw === "RB" || raw === "RWB" || raw === "CB" || raw === "CD" || raw === "LCB" || raw === "RCB" || raw.startsWith("CB-") || raw.startsWith("CD-") || raw.includes("DEFENDER")) return 0;
  if (raw === "DM" || raw === "CDM" || raw.includes("DEFENSIVE")) return Math.min(1, last);
  if (raw === "AM" || raw === "CAM" || raw === "AM-L" || raw === "AM-R" || raw === "LAM" || raw === "RAM" || raw === "SS" || raw.includes("ATTACKING")) return Math.max(0, last - 1);
  if (raw === "F" || raw === "ST" || raw === "CF" || raw === "CF-L" || raw === "CF-R" || raw === "LW" || raw === "RW" || raw === "LF" || raw === "RF" || raw.includes("FORWARD") || raw.includes("STRIKER")) return last;
  if (raw === "LM" || raw === "RM" || raw === "CM" || raw === "LCM" || raw === "RCM" || raw === "CM-L" || raw === "CM-R" || raw.includes("MIDFIELDER")) return lines.length >= 3 ? Math.floor(last / 2) : Math.min(1, last);
  return undefined;
}

type LineupSlot = {
  lineIndex: number;
  cellIndex: number;
  localX: number;
  localY: number;
};

function effectiveFormationLines(formation: string | undefined, outfieldCount: number) {
  const lines = parseFormationLines(formation);
  if (!lines.length || lines.reduce((sum, count) => sum + count, 0) !== outfieldCount) {
    return outfieldCount === 10 ? [4, 3, 3] : [outfieldCount];
  }
  return lines;
}

function lineupSlots(lines: number[]) {
  const xPositions = desktopLineXPositions(lines.length, "home");
  return lines.flatMap((count, lineIndex) => {
    const yPositions = lineYPositions(count, lineIndex, lines.length);
    return yPositions.map((localY, cellIndex) => ({
      lineIndex,
      cellIndex,
      localX: xPositions[lineIndex] ?? 50,
      localY,
    }));
  });
}

function idealLocalPoint(player: EspnLineupPlayer, lines: number[]) {
  const lineIndex = lineIndexTarget(player, lines);
  const xPositions = desktopLineXPositions(lines.length, "home");
  const safeLineIndex = typeof lineIndex === "number" && lineIndex >= 0 ? Math.min(lineIndex, xPositions.length - 1) : Math.floor(xPositions.length / 2);
  return {
    localX: xPositions[safeLineIndex] ?? 50,
    localY: lateralTarget(player),
  };
}

function lineIndexFallbackOrder(player: EspnLineupPlayer, index: number, lines: number[]) {
  const explicit = lineIndexTarget(player, lines);
  if (typeof explicit === "number") return explicit;
  let cursor = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    cursor += lines[lineIndex] ?? 0;
    if (index < cursor) return lineIndex;
  }
  return Math.max(0, lines.length - 1);
}

function assignLineupSlots(players: EspnLineupPlayer[], formation?: string) {
  const outfield = players.filter((player) => !isGoalkeeper(player));
  const lines = effectiveFormationLines(formation, outfield.length);
  const slots = lineupSlots(lines);
  const positions = new Map<EspnLineupPlayer, LineupSlot>();
  const freeSlots = [...slots];

  outfield.forEach((player, playerIndex) => {
    const ideal = idealLocalPoint(player, lines);
    const fallbackLine = lineIndexFallbackOrder(player, playerIndex, lines);
    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    freeSlots.forEach((slot, slotIndex) => {
      const linePenalty = slot.lineIndex === fallbackLine ? 0 : Math.abs(slot.lineIndex - fallbackLine) * 120;
      const score = linePenalty + Math.abs(slot.localX - ideal.localX) * 2 + Math.abs(slot.localY - ideal.localY) + slotIndex * 0.01 + playerIndex * 0.001;
      if (score < bestScore) {
        bestScore = score;
        bestIndex = slotIndex;
      }
    });
    const [slot] = freeSlots.splice(bestIndex, 1);
    if (slot) positions.set(player, slot);
  });

  return positions;
}

function desktopGridPositions(players: EspnLineupPlayer[], formation: string | undefined, side: "home" | "away") {
  const positions = new Map<EspnLineupPlayer, { left: number; top: number }>();
  const keeper = players.find(isGoalkeeper) ?? players[0];
  if (keeper) positions.set(keeper, { left: side === "home" ? 7 : 93, top: 50 });
  assignLineupSlots(players, formation).forEach((slot, player) => {
    positions.set(player, {
      left: side === "home" ? slot.localX : 100 - slot.localX,
      top: side === "home" ? slot.localY : 100 - slot.localY,
    });
  });
  return positions;
}

function mobileGridPositions(players: EspnLineupPlayer[], formation: string | undefined, orientation: "home" | "away") {
  const positions = new Map<EspnLineupPlayer, { left: number; top: number }>();
  const keeper = players.find(isGoalkeeper) ?? players[0];
  if (keeper) positions.set(keeper, { left: 50, top: orientation === "home" ? 8 : 92 });
  assignLineupSlots(players, formation).forEach((slot, player) => {
    const depthRatio = (slot.localX - 18) / 25;
    const homeTop = 24 + depthRatio * 54;
    positions.set(player, {
      left: orientation === "home" ? 100 - slot.localY : slot.localY,
      top: orientation === "home" ? homeTop : 100 - homeTop,
    });
  });
  return positions;
}

function cssPitchPoint(point: { left: number; top: number }) {
  return { left: `${point.left}%`, top: `${point.top}%` };
}

function lineupDisplayName(name: string) {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) return "";
  const parts = clean.split(" ");
  if (parts.length <= 1) return clean;
  const surnameParticles = new Set([
    "da",
    "das",
    "de",
    "del",
    "della",
    "der",
    "di",
    "dos",
    "du",
    "la",
    "le",
    "van",
    "von",
  ]);
  const last = parts[parts.length - 1] ?? "";
  const previous = parts[parts.length - 2] ?? "";
  if (surnameParticles.has(stripAccents(previous).toLowerCase())) {
    return `${previous} ${last}`;
  }
  return last;
}

function PlayerSubMarkers({ player }: { player: EspnLineupPlayer }) {
  return (
    <span className="lineup-player-sub-markers" aria-hidden="true">
      {player.subbedOutMinute ? <span className="lineup-sub-marker out">← {player.subbedOutMinute}</span> : null}
      {player.subbedInMinute ? <span className="lineup-sub-marker in">→ {player.subbedInMinute}</span> : null}
    </span>
  );
}

function PitchPlayer({ player, side, color, position }: { player: EspnLineupPlayer; side: "home" | "away"; color: string; position: { left: number; top: number } }) {
  const numberStyle = { background: color, color: textColorForBackground(color) };
  return (
    <div className={clsx("pitch-player", side)} style={cssPitchPoint(position)}>
      <PlayerSubMarkers player={player} />
      <span className="pitch-player-number" style={numberStyle}>{player.number ?? "-"}</span>
      <span className="pitch-player-name">{lineupDisplayName(player.name)}</span>
    </div>
  );
}

function PortraitPitchPlayer({ player, color, position }: { player: EspnLineupPlayer; color: string; position: { left: number; top: number } }) {
  const numberStyle = { background: color, color: textColorForBackground(color) };
  return (
    <div className="pitch-player portrait" style={cssPitchPoint(position)}>
      <PlayerSubMarkers player={player} />
      <span className="pitch-player-number" style={numberStyle}>{player.number ?? "-"}</span>
      <span className="pitch-player-name">{lineupDisplayName(player.name)}</span>
    </div>
  );
}

function BenchPlayerRow({ player, color }: { player: EspnLineupPlayer; color: string }) {
  const numberStyle = { background: color, color: textColorForBackground(color) };
  return (
    <li className="bench-player-row">
      <span className="bench-player-number" style={numberStyle}>{player.number ?? "-"}</span>
      <span className="bench-player-meta">
        <span>{player.name}</span>
        {player.subbedInMinute ? <span className="bench-sub-marker in">→ {player.subbedInMinute}</span> : null}
      </span>
    </li>
  );
}

function TeamPortraitLineup({ side, color, orientation, flag }: { side?: EspnRosterSide; color: string; orientation: "home" | "away"; flag?: string }) {
  const starters = side?.starters ?? [];
  const positions = mobileGridPositions(starters, side?.formation, orientation);

  return (
    <div className={clsx("lineup-mobile-team", orientation)}>
      <div className="lineup-mobile-formation" style={{ color }}>{side?.formation ?? "-"}</div>
      <div className={clsx("lineup-pitch portrait", orientation)}>
        <span className="lineup-mobile-formation-infield">
          {flag ? <img src={flag} alt="" /> : null}
          {side?.formation ?? "-"}
        </span>
        <div className="pitch-half-line portrait" />
        <div className="pitch-center-circle portrait" />
        <div className="pitch-box portrait-top" />
        <div className="pitch-box portrait-bottom" />
        {starters.map((player) => (
          <PortraitPitchPlayer
            key={`mobile-${side?.team}-${player.number}-${player.name}`}
            player={player}
            color={color}
            position={positions.get(player) ?? { left: 50, top: 50 }}
          />
        ))}
      </div>
    </div>
  );
}

function MobileLineupBench({ homeSide, awaySide, homeColor, awayColor }: { homeSide?: EspnRosterSide; awaySide?: EspnRosterSide; homeColor: string; awayColor: string }) {
  return (
    <div className="lineup-bench portrait">
      <h4>Vaihtopelaajat</h4>
      <div className="lineup-bench-columns">
        <div className="bench-column">
          <ol>
            {(homeSide?.substitutes ?? []).map((player) => <BenchPlayerRow key={`mobile-bench-home-${player.number}-${player.name}`} player={player} color={homeColor} />)}
          </ol>
        </div>
        <div className="bench-column">
          <ol>
            {(awaySide?.substitutes ?? []).map((player) => <BenchPlayerRow key={`mobile-bench-away-${player.number}-${player.name}`} player={player} color={awayColor} />)}
          </ol>
        </div>
      </div>
    </div>
  );
}

function LineupPitch({
  homeSide,
  awaySide,
  homeColor,
  awayColor,
  homeFlag,
  awayFlag,
}: {
  homeSide?: EspnRosterSide;
  awaySide?: EspnRosterSide;
  homeColor: string;
  awayColor: string;
  homeFlag?: string;
  awayFlag?: string;
}) {
  const homeStarters = homeSide?.starters ?? [];
  const awayStarters = awaySide?.starters ?? [];
  const homePositions = desktopGridPositions(homeStarters, homeSide?.formation, "home");
  const awayPositions = desktopGridPositions(awayStarters, awaySide?.formation, "away");

  return (
    <div className="lineup-visual">
      <div className="lineup-formation-bar">
        <span style={{ color: homeColor }}>{homeSide?.formation ?? "-"}</span>
        <span style={{ color: awayColor }}>{awaySide?.formation ?? "-"}</span>
      </div>
      <div className="lineup-mobile-stack">
        <TeamPortraitLineup side={homeSide} color={homeColor} orientation="home" flag={homeFlag} />
        <TeamPortraitLineup side={awaySide} color={awayColor} orientation="away" flag={awayFlag} />
        <MobileLineupBench homeSide={homeSide} awaySide={awaySide} homeColor={homeColor} awayColor={awayColor} />
      </div>
      <div className="lineup-pitch">
        <span className="lineup-desktop-formation-infield home">
          {homeFlag ? <img src={homeFlag} alt="" /> : null}
          {homeSide?.formation ?? "-"}
        </span>
        <span className="lineup-desktop-formation-infield away">
          {awayFlag ? <img src={awayFlag} alt="" /> : null}
          {awaySide?.formation ?? "-"}
        </span>
        <div className="pitch-half-line" />
        <div className="pitch-center-circle" />
        <div className="pitch-box left" />
        <div className="pitch-box right" />
        {homeStarters.map((player) => (
          <PitchPlayer
            key={`home-${player.number}-${player.name}`}
            player={player}
            side="home"
            color={homeColor}
            position={homePositions.get(player) ?? { left: 7, top: 50 }}
          />
        ))}
        {awayStarters.map((player) => (
          <PitchPlayer
            key={`away-${player.number}-${player.name}`}
            player={player}
            side="away"
            color={awayColor}
            position={awayPositions.get(player) ?? { left: 93, top: 50 }}
          />
        ))}
      </div>
      <div className="lineup-bench">
        <div className="bench-column">
          <h4>Vaihtopelaajat</h4>
          <ol>
            {(homeSide?.substitutes ?? []).map((player) => <BenchPlayerRow key={`home-bench-${player.number}-${player.name}`} player={player} color={homeColor} />)}
          </ol>
        </div>
        <div className="bench-column">
          <h4>Vaihtopelaajat</h4>
          <ol>
            {(awaySide?.substitutes ?? []).map((player) => <BenchPlayerRow key={`away-bench-${player.number}-${player.name}`} player={player} color={awayColor} />)}
          </ol>
        </div>
      </div>
    </div>
  );
}

type TimelineEvent = {
  id: string;
  minute: string;
  sort: number;
  side: "home" | "away" | "center";
  type: "goal" | "yellow" | "red" | "substitution" | "marker";
  primary: string;
  secondary?: string;
  markerKind?: "start" | "half" | "second-half" | "full";
};

function minuteSortValue(minute: string) {
  const match = minute.match(/\d+/);
  return match ? Number(match[0]) : 999;
}

function teamSideFromEventTeam(team: string | undefined, summary?: EspnMatchSummary): "home" | "away" | undefined {
  if (!team || !summary) return undefined;
  const eventTeam = stripAccents(team).toLowerCase();
  const homeTeam = stripAccents(summary.rosters.home?.team ?? "").toLowerCase();
  const awayTeam = stripAccents(summary.rosters.away?.team ?? "").toLowerCase();
  if (eventTeam && homeTeam && (eventTeam === homeTeam || eventTeam.includes(homeTeam) || homeTeam.includes(eventTeam))) return "home";
  if (eventTeam && awayTeam && (eventTeam === awayTeam || eventTeam.includes(awayTeam) || awayTeam.includes(eventTeam))) return "away";
  return undefined;
}

function lineupSubstitutionEvents(side: "home" | "away", roster?: EspnRosterSide): TimelineEvent[] {
  return (roster?.substitutes ?? [])
    .filter((player) => player.subMinute && player.subbedInForName)
    .map((player) => ({
      id: `${side}-sub-${player.subMinute}-${player.name}-${player.subbedInForName}`,
      minute: player.subMinute ?? "",
      sort: minuteSortValue(player.subMinute ?? ""),
      side,
      type: "substitution" as const,
      primary: player.name,
      secondary: player.subbedInForName,
    }));
}

function isTimelineEventType(type: string): type is TimelineEvent["type"] {
  return type === "goal" || type === "yellow" || type === "red" || type === "substitution";
}

function statusMarkerEvents(summary: EspnMatchSummary, events: TimelineEvent[]): TimelineEvent[] {
  const markers: TimelineEvent[] = [];
  const hasSecondHalf = events.some((event) => event.sort > 45 && event.sort < 999);
  const hasAnyEvent = events.length > 0;
  if (hasAnyEvent) {
    markers.push({
      id: "match-start",
      minute: "",
      sort: -1,
      side: "center",
      type: "marker",
      markerKind: "start",
      primary: "Ottelu alkaa",
    });
  }
  if (hasSecondHalf || summary.status?.completed) {
    markers.push({
      id: "half-time",
      minute: "HT",
      sort: 45.1,
      side: "center",
      type: "marker",
      markerKind: "half",
      primary: "Puoliaika",
    });
    markers.push({
      id: "second-half-start",
      minute: "",
      sort: 45.2,
      side: "center",
      type: "marker",
      markerKind: "second-half",
      primary: "Toinen puoliaika alkaa",
    });
  }
  if (summary.status?.completed) {
    markers.push({
      id: "full-time",
      minute: "FT",
      sort: 999,
      side: "center",
      type: "marker",
      markerKind: "full",
      primary: "Ottelu päättyi",
    });
  }
  return markers;
}

function matchTimelineEvents(summary?: EspnMatchSummary): TimelineEvent[] {
  if (!summary) return [];
  const cardAndGoalEvents = summary.events
    .map((event, index) => {
      const type = event.type;
      if (type === "substitution" || !isTimelineEventType(type)) return undefined;
      const side = teamSideFromEventTeam(event.team, summary);
      if (!side) return undefined;
      const timelineEvent: TimelineEvent = {
        id: `${type}-${event.minute}-${event.player}-${index}`,
        minute: event.minute,
        sort: minuteSortValue(event.minute),
        side,
        type,
        primary: `${event.player || event.text || (type === "goal" ? "Maali" : "Kortti")}${event.penalty ? " (p)" : ""}${event.ownGoal ? " (OM)" : ""}`,
        secondary: event.assist ? `Syöttö: ${event.assist}` : undefined,
      };
      return timelineEvent;
    })
    .filter((event): event is TimelineEvent => !!event);

  const events = [
    ...cardAndGoalEvents,
    ...lineupSubstitutionEvents("home", summary.rosters.home),
    ...lineupSubstitutionEvents("away", summary.rosters.away),
  ];

  const timeline = [
    ...events,
    ...statusMarkerEvents(summary, events),
  ];
  const direction = summary.status?.completed ? -1 : 1;
  return timeline.sort((a, b) => direction * (a.sort - b.sort) || direction * a.minute.localeCompare(b.minute) || a.id.localeCompare(b.id));
}

function TimelineEventIcon({ event }: { event: TimelineEvent }) {
  if (event.type === "goal") return <span className="timeline-event-kind goal-icon" aria-label="Maali">⚽</span>;
  if (event.type === "yellow") return <span className="timeline-event-kind card-icon yellow-card-icon" aria-label="Keltainen kortti" />;
  if (event.type === "red") return <span className="timeline-event-kind card-icon red-card-icon" aria-label="Punainen kortti" />;
  if (event.type === "substitution") return <span className="timeline-event-kind substitution-icon" aria-hidden="true">↔</span>;
  return null;
}

function TimelineEventContent({ event }: { event: TimelineEvent }) {
  if (event.type === "marker") {
    return (
      <div className="timeline-marker-content">
        <span className="timeline-marker-icon">◔</span>
        <strong>{event.primary}</strong>
      </div>
    );
  }
  return (
    <div className={clsx("timeline-event-content", event.type)}>
      <TimelineEventIcon event={event} />
      {event.type === "substitution" ? (
        <span className="timeline-sub-lines">
          <strong className="sub-in">→ {event.primary}</strong>
          <strong className="sub-out">← {event.secondary}</strong>
        </span>
      ) : (
        <span>
          <strong>{event.primary}</strong>
          {event.secondary ? <small>{event.secondary}</small> : null}
        </span>
      )}
    </div>
  );
}

function MatchDetailsModal({
  game,
  teams,
  stadiums,
  summary,
  loading,
  error,
  onClose,
}: {
  game: ApiGame;
  teams: ApiTeam[];
  stadiums: ApiStadium[];
  summary?: EspnMatchSummary;
  loading: boolean;
  error?: string;
  onClose: () => void;
}) {
  const [detailPage, setDetailPage] = useState<"events" | "lineups" | "stats">("events");
  const home = teamName(game, "home");
  const away = teamName(game, "away");
  const homeTeam = teamByName(teams, home);
  const awayTeam = teamByName(teams, away);
  const channels = tvChannelsForGame(game);
  const fallbackLocation = cityCountry(stadiums, game);
  const venueLine = [summary?.venue, summary?.city || fallbackLocation, summary?.country].filter(Boolean).join(" · ");
  const detailChannels = channels;
  const timelineEvents = useMemo(() => matchTimelineEvents(summary), [summary]);
  const { homeColor, awayColor } = useMemo(() => matchTeamColors(home, away), [home, away]);
  const detailLogoBg = useMemo(() => createTwoToneLogoDataUri(homeColor, awayColor), [homeColor, awayColor]);
  const bcol = useMemo(() => {
    const rand = getSeededRandom(game.id + "-inner");
    const cx = Math.floor(rand() * 40) + 30;
    const cy = Math.floor(rand() * 40) + 30;
    const tx = Math.floor(rand() * 60) + 20;
    const ry = Math.floor(rand() * 60) + 20;
    const bx = Math.floor(rand() * 60) + 20;
    const ly = Math.floor(rand() * 60) + 20;
    return { cx, cy, tx, ry, bx, ly };
  }, [game.id]);
  const headerStatus = getKickoffStatus(game, currentFinlandClockMillis());
  const scheduled = finlandClockDate(game);
  const headerCenterValue = isFinished(game) || isLive(game)
    ? `${parseScore(game.home_score)} - ${parseScore(game.away_score)}`
    : scheduled
      ? new Intl.DateTimeFormat("fi-FI", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(scheduled)
      : "--:--";
  const detailDateLine = scheduled
    ? new Intl.DateTimeFormat("fi-FI", {
      weekday: "short",
      day: "numeric",
      month: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(scheduled)
    : "";
  const detailOdds = summary?.odds[0];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="match-detail-overlay" role="dialog" aria-modal="true" aria-label={`${normalizeTeam(home)} - ${normalizeTeam(away)}`}>
      <button className="match-detail-backdrop" type="button" aria-label="Sulje ottelun lisätiedot" onClick={onClose} />
      <div
        className="match-detail-modal"
        style={
          {
            "--detail-logo-bg-url": detailLogoBg,
          } as CSSProperties
        }
      >
        <button className="match-detail-close" type="button" onClick={onClose} aria-label="Sulje">
          <X size={22} />
        </button>
        <header className="match-detail-header">
          <div className="match-detail-meta-inline">
            <span><Trophy size={14} /> {stageLabel(game)}</span>
            {detailDateLine ? <span><CalendarDays size={14} /> {detailDateLine}</span> : null}
            {venueLine ? <span><MapPin size={14} /> {venueLine}</span> : null}
            {detailChannels.length ? <span><Tv size={14} /> {detailChannels.join(" / ")}</span> : null}
          </div>
          {detailOdds ? (
            <div className="match-detail-odds-pill" aria-label="Kertoimet">
              <span className="match-detail-odds-pill-title">Kertoimet</span>
              <span className="match-detail-odds-pill-values">
                <span>1: {detailOdds.homeMoneyline ?? "-"}</span>
                <span>X: {detailOdds.drawMoneyline ?? "-"}</span>
                <span>2: {detailOdds.awayMoneyline ?? "-"}</span>
              </span>
            </div>
          ) : null}
          <div className="match-detail-scoreboard-shell">
            <div className="match-detail-team-label home" lang="fi">{normalizeTeam(home)}</div>
            <div className="match-detail-scoreboard">
              <div className="score-row-card-wrap match-detail-score-row">
                <div className="score-row-card-backdrop-wrap">
                  <svg
                    className="score-row-card-backdrop"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    style={{
                      position: "absolute",
                      inset: "0px",
                      width: "100%",
                      height: "100%",
                      zIndex: 1,
                    }}
                  >
                    <g>
                      <path d={`M ${bcol.cx} ${bcol.cy} L ${bcol.tx} 0 L 0 0 L 0 ${bcol.ly} Z`} fill="#A180EA" />
                      <path d={`M ${bcol.cx} ${bcol.cy} L 100 ${bcol.ry} L 100 0 L ${bcol.tx} 0 Z`} fill="#6800E4" />
                      <path d={`M ${bcol.cx} ${bcol.cy} L ${bcol.bx} 100 L 100 100 L 100 ${bcol.ry} Z`} fill="#8B0404" />
                      <path d={`M ${bcol.cx} ${bcol.cy} L 0 ${bcol.ly} L 0 100 L ${bcol.bx} 100 Z`} fill="#B9D637" />
                    </g>
                  </svg>
                </div>
                <div className="score-row-card-body">
                  {homeTeam?.flag ? (
                    <img className="inline-flag home-flag" src={homeTeam.flag} alt="" />
                  ) : null}
                  {(game.espn_home_red_cards ?? 0) > 0 ? (
                    <span className="red-card-indicator home-red-card" title={`${game.espn_home_red_cards} punaista korttia`}>
                      {(game.espn_home_red_cards ?? 0) > 1 ? game.espn_home_red_cards : null}
                    </span>
                  ) : null}

                  <div className="inline-center-block">
                    <div className={clsx("match-status-badge-above", headerStatus.type)}>
                      {headerStatus.text}
                    </div>
                    {headerStatus.type === "live" ? (
                      <div className="score-capsule live">
                        <span className="score-num">{parseScore(game.home_score)}</span>
                        <span className="score-divider-line" />
                        <span className="score-num">{parseScore(game.away_score)}</span>
                      </div>
                    ) : headerStatus.type === "finished" ? (
                      <div className="score-capsule finished">
                        <span className="score-num">{parseScore(game.home_score)}</span>
                        <span className="score-divider-line" />
                        <span className="score-num">{parseScore(game.away_score)}</span>
                      </div>
                    ) : (
                      <div className="score-capsule upcoming">
                        <span className="score-time">{headerCenterValue}</span>
                      </div>
                    )}
                  </div>

                  {awayTeam?.flag ? (
                    <img className="inline-flag away-flag" src={awayTeam.flag} alt="" />
                  ) : null}
                  {(game.espn_away_red_cards ?? 0) > 0 ? (
                    <span className="red-card-indicator away-red-card" title={`${game.espn_away_red_cards} punaista korttia`}>
                      {(game.espn_away_red_cards ?? 0) > 1 ? game.espn_away_red_cards : null}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="match-detail-team-names-mobile">
                <div className="match-detail-team-name-mobile home" lang="fi">{hyphenatedTeamName(normalizeTeam(home))}</div>
                <div className="match-detail-team-name-mobile away" lang="fi">{hyphenatedTeamName(normalizeTeam(away))}</div>
              </div>
            </div>
            <div className="match-detail-team-label away" lang="fi">{normalizeTeam(away)}</div>
          </div>
          <nav className="match-detail-page-tabs" aria-label="Ottelun lisätiedot">
            <button type="button" className={clsx(detailPage === "events" && "active")} onClick={() => setDetailPage("events")}>Tapahtumat</button>
            <button type="button" className={clsx(detailPage === "lineups" && "active")} onClick={() => setDetailPage("lineups")}>Kokoonpanot</button>
            <button type="button" className={clsx(detailPage === "stats" && "active")} onClick={() => setDetailPage("stats")}>Tilastot</button>
          </nav>
        </header>

        {loading ? <div className="match-detail-loading">Haetaan ESPN-tietoja...</div> : null}
        {error ? <div className="match-detail-error">{error}</div> : null}

        <div
          className="match-detail-content-surface"
          style={
            {
              "--detail-home-color": homeColor,
              "--detail-away-color": awayColor,
              "--detail-logo-bg-url": detailLogoBg,
            } as CSSProperties
          }
        >
          <div className={clsx("match-detail-grid", "match-detail-page", `match-detail-page-${detailPage}`)}>
            {detailPage === "events" ? (
              <section className="match-detail-section match-detail-events-section match-detail-page-section">
                {timelineEvents.length ? (
                  <div className="match-timeline">
                    {timelineEvents.map((event) => (
                      <div className={clsx("timeline-row", event.side)} key={event.id}>
                        <div className="timeline-side timeline-home">
                          {event.side === "home" ? <TimelineEventContent event={event} /> : null}
                        </div>
                        <div className="timeline-minute">{event.side === "center" ? "" : event.minute || "-"}</div>
                        <div className="timeline-side timeline-away">
                          {event.side === "away" ? <TimelineEventContent event={event} /> : null}
                        </div>
                        {event.side === "center" ? <TimelineEventContent event={event} /> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="match-detail-empty">Tapahtumia ei ole vielä saatavilla.</div>
                )}
              </section>
            ) : null}

            {detailPage === "lineups" ? (
              <section className="match-detail-section match-detail-lineup-section match-detail-page-section">
                {summary?.rosters.home || summary?.rosters.away ? (
                  <LineupPitch
                    homeSide={summary.rosters.home}
                    awaySide={summary.rosters.away}
                    homeColor={homeColor}
                    awayColor={awayColor}
                    homeFlag={homeTeam?.flag}
                    awayFlag={awayTeam?.flag}
                  />
                ) : (
                  <div className="match-detail-empty">Kokoonpanoja ei ole vielä saatavilla.</div>
                )}
              </section>
            ) : null}

            {detailPage === "stats" ? (
              <aside className="match-detail-side-stack match-detail-page-section">
                <section className="match-detail-section">
                  <DetailStatRows home={summary?.stats.home ?? []} away={summary?.stats.away ?? []} homeColor={homeColor} awayColor={awayColor} />
                </section>
              </aside>
            ) : null}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function MatchCardColumn({
  game,
  teams,
  players,
  currentPlayerName,
  setPlayers,
  onOpenDetails,
}: {
  game: ApiGame;
  teams: ApiTeam[];
  players: PlayerState[];
  currentPlayerName?: PlayerName;
  setPlayers: (players: PlayerState[]) => void;
  onOpenDetails: (game: ApiGame) => void;
}) {
  const home = teamName(game, "home");
  const away = teamName(game, "away");
  const homeTeam = teamByName(teams, home);
  const awayTeam = teamByName(teams, away);

  const displayPlayers = [...players].sort((a, b) => a.name.localeCompare(b.name));

  const scheduled = finlandClockDate(game);
  const centerValue = isFinished(game) || isLive(game)
    ? `${parseScore(game.home_score)} - ${parseScore(game.away_score)}`
    : scheduled
      ? new Intl.DateTimeFormat("fi-FI", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(scheduled)
      : "--:--";

  const [now, setNow] = useState(() => currentFinlandClockMillis());
  useEffect(() => {
    const kickoff = finlandClockDate(game);
    if (!kickoff || isFinished(game) || isLive(game)) return;
    const diff = kickoff.getTime() - currentFinlandClockMillis();
    if (diff <= 0 || diff > 60 * 60 * 1000) return;

    const interval = setInterval(() => {
      setNow(currentFinlandClockMillis());
    }, 1000);
    return () => clearInterval(interval);
  }, [game]);

  const myPrediction = players.find((p) => p.name === currentPlayerName)?.predictions.find((item) => item.matchId === game.id);
  const hasPredicted = !!myPrediction;
  const [prevHasPredicted, setPrevHasPredicted] = useState(hasPredicted);
  const [isEditing, setIsEditing] = useState(!hasPredicted);

  if (hasPredicted !== prevHasPredicted) {
    setPrevHasPredicted(hasPredicted);
    setIsEditing(!hasPredicted);
  }

  const homeLines = useMemo(() => scorerDisplayLines(game.home_scorers), [game.home_scorers]);
  const awayLines = useMemo(() => scorerDisplayLines(game.away_scorers), [game.away_scorers]);

  const kickoffStatus = getKickoffStatus(game, now);
  const bcol = useMemo(() => {
    const rand = getSeededRandom(game.id + "-inner");
    // Center point: cx, cy (30% to 70%)
    const cx = Math.floor(rand() * 40) + 30;
    const cy = Math.floor(rand() * 40) + 30;
    // Edge points: tx, ry, bx, ly (20% to 80%)
    const tx = Math.floor(rand() * 60) + 20;
    const ry = Math.floor(rand() * 60) + 20;
    const bx = Math.floor(rand() * 60) + 20;
    const ly = Math.floor(rand() * 60) + 20;
    return { cx, cy, tx, ry, bx, ly };
  }, [game.id]);

  return (
    <>
      <div className="match-card-content-panel">
        <div className="match-stage">
          <button className="score-row-details-button" type="button" onClick={() => onOpenDetails(game)} aria-label="Avaa ottelun lisätiedot">
            <div className="score-row-card-wrap">
              <div className="score-row-card-backdrop-wrap">
                <svg
                  className="score-row-card-backdrop"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  style={{
                    position: "absolute",
                    inset: "0px",
                    width: "100%",
                    height: "100%",
                    zIndex: 1,
                  }}
                >
                  <g>
                    {/* Sector 1: Top-Left (Light Purple) */}
                    <path d={`M ${bcol.cx} ${bcol.cy} L ${bcol.tx} 0 L 0 0 L 0 ${bcol.ly} Z`} fill="#A180EA" />
                    {/* Sector 2: Top-Right (Dark Purple) */}
                    <path d={`M ${bcol.cx} ${bcol.cy} L 100 ${bcol.ry} L 100 0 L ${bcol.tx} 0 Z`} fill="#6800E4" />
                    {/* Sector 3: Bottom-Right (Red) */}
                    <path d={`M ${bcol.cx} ${bcol.cy} L ${bcol.bx} 100 L 100 100 L 100 ${bcol.ry} Z`} fill="#8B0404" />
                    {/* Sector 4: Bottom-Left (Yellow) */}
                    <path d={`M ${bcol.cx} ${bcol.cy} L 0 ${bcol.ly} L 0 100 L ${bcol.bx} 100 Z`} fill="#B9D637" />
                  </g>
                </svg>
              </div>
              <div className="score-row-card-body">
                {homeTeam?.flag ? (
                  <img className="inline-flag home-flag" src={homeTeam.flag} alt="" />
                ) : null}
                {(game.espn_home_red_cards ?? 0) > 0 ? (
                  <span className="red-card-indicator home-red-card" title={`${game.espn_home_red_cards} punaista korttia`}>
                    {(game.espn_home_red_cards ?? 0) > 1 ? game.espn_home_red_cards : null}
                  </span>
                ) : null}
                <div className="inline-center-block">
                  <div className={clsx("match-status-badge-above", kickoffStatus.type)}>
                    {kickoffStatus.text}
                  </div>
                  {kickoffStatus.type === "live" ? (
                    <div className="score-capsule live">
                      <span className="score-num">{parseScore(game.home_score)}</span>
                      <span className="score-divider-line" />
                      <span className="score-num">{parseScore(game.away_score)}</span>
                    </div>
                  ) : kickoffStatus.type === "finished" ? (
                    <div className="score-capsule finished">
                      <span className="score-num">{parseScore(game.home_score)}</span>
                      <span className="score-divider-line" />
                      <span className="score-num">{parseScore(game.away_score)}</span>
                    </div>
                  ) : (
                    <div className="score-capsule upcoming">
                      <span className="score-time">{centerValue}</span>
                    </div>
                  )}
                </div>

                {awayTeam?.flag ? (
                  <img className="inline-flag away-flag" src={awayTeam.flag} alt="" />
                ) : null}
                {(game.espn_away_red_cards ?? 0) > 0 ? (
                  <span className="red-card-indicator away-red-card" title={`${game.espn_away_red_cards} punaista korttia`}>
                    {(game.espn_away_red_cards ?? 0) > 1 ? game.espn_away_red_cards : null}
                  </span>
                ) : null}              </div>
            </div>
          </button>

          <div className="team-names-row">
            <div className="team-name home" lang="fi" aria-label={normalizeTeam(home)}>{hyphenatedTeamName(normalizeTeam(home))}</div>
            <div className="team-name away" lang="fi" aria-label={normalizeTeam(away)}>{hyphenatedTeamName(normalizeTeam(away))}</div>
          </div>
        </div>

        <div className="scorer-strip-fixed">
          {Array.from({ length: Math.max(5, Math.max(homeLines.length, awayLines.length)) }).map((_, i) => (
            <div className="scorer-row-line" key={i}>
              <span className="home-scorer-name">{homeLines[i] || ""}</span>
              <span className="away-scorer-name">{awayLines[i] || ""}</span>
            </div>
          ))}
        </div>

        <div className="prediction-list">
          {displayPlayers.map((player) => {
            const prediction = player.predictions.find((item) => item.matchId === game.id);
            const isSelf = player.name === currentPlayerName;
            const isOpen = !predictionLocked(game);

            if (isSelf && isOpen && isEditing) {
              return (
                <InlinePredictionEditor
                  key={player.name}
                  player={player}
                  game={game}
                  players={players}
                  setPlayers={setPlayers}
                  onSaveComplete={() => setIsEditing(false)}
                />
              );
            }

            const hasPredicted = !!prediction;
            const points = prediction ? matchPoints(prediction, game) : 0;
            const pointsClass = !isOpen && prediction ? `points-${points}` : "";

            return (
              <div className={clsx("prediction-row", pointsClass)} key={player.name}>
                <strong className="pred-player-name">{player.name}</strong>
                <div className="pred-score-wrap">
                  {!isOpen ? (
                    prediction ? (
                      <span className="prediction-score">{prediction.home}-{prediction.away}</span>
                    ) : (
                      <span className="prediction-score empty-score">–</span>
                    )
                  ) : (
                    hasPredicted ? (
                      <span className="prediction-score predicted-ok" title="Veikkaus tallennettu">✔</span>
                    ) : (
                      <span className="prediction-score empty-score">–</span>
                    )
                  )}
                </div>
                <div className="pred-points-wrap">
                  {!isOpen ? (
                    prediction ? (
                      <span className="points">{matchPoints(prediction, game)} p</span>
                    ) : (
                      <span className="points">0 p</span>
                    )
                  ) : (
                    isSelf && hasPredicted ? (
                      <button className="compact-edit-btn" onClick={() => setIsEditing(true)}>Muuta</button>
                    ) : (
                      <span className="points-placeholder" />
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function MatchGroupCard({
  games,
  teams,
  players,
  currentPlayerName,
  setPlayers,
  onOpenDetails,
}: {
  games: ApiGame[];
  teams: ApiTeam[];
  players: PlayerState[];
  currentPlayerName?: PlayerName;
  setPlayers: (players: PlayerState[]) => void;
  onOpenDetails: (game: ApiGame) => void;
}) {
  const b = useMemo(() => generateCardBackdropStyle(games[0].id), [games[0]?.id]);
  const borderMaskId = `match-border-mask-${games[0].id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const mobileBorderStyle = {
    "--card-border-c1": b.c1,
    "--card-border-c2": b.c2,
    "--card-border-c3": b.c3,
    "--card-border-c4": b.c4,
  } as React.CSSProperties;

  return (
    <div className="match-card-border-wrap" style={mobileBorderStyle}>
      <svg
        className="match-card-border-backdrop"
        style={b.style}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <defs>
          <mask id={borderMaskId} maskUnits="userSpaceOnUse">
            <rect x="0" y="0" width="100" height="100" fill="white" />
            <rect className="match-card-border-mask-cutout" x="2" y="2" width="96" height="96" rx="4" ry="4" fill="black" />
          </mask>
        </defs>
        <g mask={`url(#${borderMaskId})`}>
          {/* Sector 1: Top-Left */}
          <path d={`M ${b.cx} ${b.cy} L ${b.tx} 0 L 0 0 L 0 ${b.ly} Z`} fill={b.c1} />
          {/* Sector 2: Top-Right */}
          <path d={`M ${b.cx} ${b.cy} L 100 ${b.ry} L 100 0 L ${b.tx} 0 Z`} fill={b.c2} />
          {/* Sector 3: Bottom-Right */}
          <path d={`M ${b.cx} ${b.cy} L ${b.bx} 100 L 100 100 L 100 ${b.ry} Z`} fill={b.c3} />
          {/* Sector 4: Bottom-Left */}
          <path d={`M ${b.cx} ${b.cy} L 0 ${b.ly} L 0 100 L ${b.bx} 100 Z`} fill={b.c4} />
        </g>
      </svg>
      <article className="match-card">
        <div className="match-card-columns">
          {games.map((game) => (
            <div className="match-card-column" key={game.id}>
              <MatchCardColumn
                game={game}
                teams={teams}
                players={players}
                currentPlayerName={currentPlayerName}
                setPlayers={setPlayers}
                onOpenDetails={onOpenDetails}
              />
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}

function MatchSections({
  games,
  teams,
  stadiums,
  players,
  currentPlayerName,
  setPlayers,
}: {
  games: ApiGame[];
  teams: ApiTeam[];
  stadiums: ApiStadium[];
  players: PlayerState[];
  currentPlayerName?: PlayerName;
  setPlayers: (players: PlayerState[]) => void;
}) {
  const visibleGames = games;
  const [visibleDaysCount, setVisibleDaysCount] = useState(7);
  const [selectedGame, setSelectedGame] = useState<ApiGame | null>(null);
  const [detailsCache, setDetailsCache] = useState<Record<string, EspnMatchSummary>>({});
  const [detailsLoadingId, setDetailsLoadingId] = useState<string | null>(null);
  const [detailsError, setDetailsError] = useState<string | undefined>();

  const recentGames = chronologicalGames(visibleGames.filter((game) => !archivedMatch(game)));
  const olderGames = chronologicalGames(visibleGames.filter((game) => archivedMatch(game)));

  // Group recent games by date label
  const recentGroupedByDate = new Map<string, ApiGame[]>();
  recentGames.forEach((game) => {
    const key = dateLabel(game);
    recentGroupedByDate.set(key, [...(recentGroupedByDate.get(key) ?? []), game]);
  });

  const allRecentDays = [...recentGroupedByDate.entries()];
  const visibleRecentDays = allRecentDays.slice(0, visibleDaysCount);
  const hasMoreRecentDays = allRecentDays.length > visibleDaysCount;

  // Group older games by date label
  const olderGroupedByDate = new Map<string, ApiGame[]>();
  olderGames.forEach((game) => {
    const key = dateLabel(game);
    olderGroupedByDate.set(key, [...(olderGroupedByDate.get(key) ?? []), game]);
  });
  const allOlderDays = [...olderGroupedByDate.entries()];

  const visibleOlderGames = useMemo(() => {
    return allOlderDays.flatMap(([_, dayGames]) => dayGames);
  }, [allOlderDays]);

  const containerRef = useRef<HTMLDivElement>(null);
  const containerWidth = useContainerWidth(containerRef);

  // Dynamic layout calculation: max M games on a row
  const activeWidth = containerWidth || (typeof window !== "undefined" ? window.innerWidth : 320);
  const isMobileLayout = activeWidth < 840;
  const M = isMobileLayout ? 1 : Math.min(5, Math.max(2, Math.floor(activeWidth / 296)));

  const openDetails = (game: ApiGame) => {
    setSelectedGame(game);
    setDetailsError(undefined);
    if (!game.espn_event_id || detailsCache[game.espn_event_id]) return;
    setDetailsLoadingId(game.espn_event_id);
    fetchEspnMatchSummary(game.espn_event_id)
      .then((summary) => {
        setDetailsCache((prev) => ({ ...prev, [game.espn_event_id!]: summary }));
      })
      .catch((error) => {
        console.warn("ESPN summary failed", error);
        setDetailsError("ESPN-lisätietoja ei saatu haettua.");
      })
      .finally(() => setDetailsLoadingId(null));
  };

  // Keep "show more" day-based, but on desktop let the visible list borrow
  // the next upcoming games so the final row does not stop one card short.
  const visibleRecentGames = useMemo(() => {
    const baseGames = visibleRecentDays.flatMap(([_, dayGames]) => dayGames);
    if (isMobileLayout || !hasMoreRecentDays || baseGames.length === 0) return baseGames;

    const remainder = baseGames.length % M;
    if (remainder === 0) return baseGames;

    const allRecentGames = allRecentDays.flatMap(([_, dayGames]) => dayGames);
    const fillCount = M - remainder;
    return [...baseGames, ...allRecentGames.slice(baseGames.length, baseGames.length + fillCount)];
  }, [allRecentDays, hasMoreRecentDays, isMobileLayout, M, visibleRecentDays]);

  function renderGamesFlow(flatGames: ApiGame[]) {
    if (isMobileLayout) {
      // Group games by day globally on mobile
      const daysMap = new Map<string, ApiGame[]>();
      flatGames.forEach((game) => {
        const dayLabel = dateLabel(game);
        if (!daysMap.has(dayLabel)) {
          daysMap.set(dayLabel, []);
        }
        daysMap.get(dayLabel)!.push(game);
      });

      return (
        <div className="match-rows-list">
          {[...daysMap.entries()].map(([dayLabel, dayGames], idx) => {
            return (
              <div className="match-row-flow" key={idx}>
                <div
                  className="match-card-wrapper"
                  style={{
                    flex: "1 1 100%",
                    width: "100%",
                  }}
                >
                  <div className="match-day-header">
                    {dayLabel}
                  </div>
                  <MatchGroupCard
                    games={dayGames}
                    teams={teams}
                    players={players}
                    currentPlayerName={currentPlayerName}
                    setPlayers={setPlayers}
                    onOpenDetails={openDetails}
                  />
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    // Otherwise, desktop layout (M >= 2)
    // Chunk the flat games into rows of max size M
    const rows = chunkArray(flatGames, M);

    return (
      <div className="match-rows-list">
        {rows.map((rowGames, rowIdx) => {
          // Group adjacent games of the same day inside this row
          const groups = groupAdjacentGamesByDay(rowGames);

          return (
            <div className="match-row-flow" key={rowIdx}>
              {groups.map((chunk: ApiGame[], chunkIdx: number) => {
                const dayLabel = dateLabel(chunk[0]);

                return (
                  <div
                    className="match-card-wrapper"
                    style={{
                      flex: `${chunk.length} 1 ${chunk.length * 250}px`,
                      maxWidth: `${chunk.length * 320}px`,
                      width: "100%",
                    }}
                    key={chunkIdx}
                  >
                    <div className="match-day-header">
                      {dayLabel}
                    </div>
                    <MatchGroupCard
                      games={chunk}
                      teams={teams}
                      players={players}
                      currentPlayerName={currentPlayerName}
                      setPlayers={setPlayers}
                      onOpenDetails={openDetails}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="section-stack-rows" ref={containerRef}>
      {renderGamesFlow(visibleRecentGames)}

      {hasMoreRecentDays && (
        <div className="show-more-row">
          <button className="primary-btn show-more-btn" onClick={() => setVisibleDaysCount((prev) => prev + 7)}>
            Näytä lisää
          </button>
        </div>
      )}

      {olderGames.length > 0 && (
        <div className="older-games-section">
          <div className="older-heading">Aikaisemmat ottelut</div>
          {renderGamesFlow(visibleOlderGames)}
        </div>
      )}

      {selectedGame ? (
        <MatchDetailsModal
          game={selectedGame}
          teams={teams}
          stadiums={stadiums}
          summary={selectedGame.espn_event_id ? detailsCache[selectedGame.espn_event_id] : undefined}
          loading={!!selectedGame.espn_event_id && detailsLoadingId === selectedGame.espn_event_id}
          error={detailsError}
          onClose={() => setSelectedGame(null)}
        />
      ) : null}
    </div>
  );
}

function BonusBetsCard({
  currentName,
  players,
  setPlayers,
}: {
  currentName?: PlayerName;
  players: PlayerState[];
  setPlayers: (players: PlayerState[]) => void;
}) {
  const locked = isBonusLocked();
  const player = players.find((p) => p.name === currentName);

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<BonusPicks>(() => {
    return player ? { ...player.bonus } : { champion: "", topScorer: "", surprise: "", flop: "" };
  });
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (player) {
      setDraft({ ...player.bonus });
    }
  }, [player]);

  async function handleSave() {
    if (locked || !player) return;
    setSaveError(null);
    const next = players.map((item) => (item.name === player.name ? { ...item, bonus: draft } : item));

    // Optimistic update
    setPlayers(next);
    saveLocal(next);
    setIsEditing(false);

    try {
      if (firebaseEnabled && db) {
        await setDoc(doc(db, "players", player.name), { ...player, bonus: draft }, { merge: true });
      }
    } catch (err: any) {
      console.error("Error saving bonus bets:", err);
      setSaveError(err.message || String(err));
    }
  }

  return (
    <section className="side-card">
      <div className="section-title-stacked">
        <h2>Bonusveikkaukset</h2>
      </div>

      <div className="bonus-bets-list">
        {players.map((p) => {
          const isMe = p.name === currentName;
          const showPicks = locked || isMe;
          const hasAny = !!(p.bonus.champion || p.bonus.topScorer || p.bonus.surprise || p.bonus.flop);

          return (
            <div className={clsx("bonus-user-row", { "is-me": isMe })} key={p.name}>
              <div className="bonus-user-header">
                <span className="bonus-user-name">
                  <strong>{p.name}</strong> {isMe && <span className="me-pill">Minä</span>}
                </span>
                {!showPicks && (
                  <span className={clsx("bonus-status-indicator", hasAny ? "done" : "pending")}>
                    {hasAny ? "✓ Valinnat tehty" : "Ei vielä valintoja"}
                  </span>
                )}
                {isMe && !locked && (
                  <button
                    className="edit-bonus-btn"
                    onClick={() => {
                      if (!isEditing) {
                        setDraft({ ...p.bonus });
                      }
                      setIsEditing(!isEditing);
                    }}
                  >
                    {isEditing ? "Peruuta" : "Muokkaa"}
                  </button>
                )}
              </div>

              {isMe && isEditing && !locked ? (
                <div className="bonus-edit-form">
                  <div className="bonus-input-group">
                    <label>Maailmanmestari</label>
                    <input
                      type="text"
                      className="bonus-input"
                      value={draft.champion}
                      onChange={(e) => setDraft({ ...draft, champion: e.target.value })}
                      placeholder="Esim. Saksa"
                    />
                  </div>
                  <div className="bonus-input-group">
                    <label>Maalikuningas</label>
                    <input
                      type="text"
                      className="bonus-input"
                      value={draft.topScorer}
                      onChange={(e) => setDraft({ ...draft, topScorer: e.target.value })}
                      placeholder="Esim. Mbappé"
                    />
                  </div>
                  <div className="bonus-input-group">
                    <label>Yllättäjä</label>
                    <input
                      type="text"
                      className="bonus-input"
                      value={draft.surprise}
                      onChange={(e) => setDraft({ ...draft, surprise: e.target.value })}
                      placeholder="Esim. Itävalta"
                    />
                  </div>
                  <div className="bonus-input-group">
                    <label>Floppi</label>
                    <input
                      type="text"
                      className="bonus-input"
                      value={draft.flop}
                      onChange={(e) => setDraft({ ...draft, flop: e.target.value })}
                      placeholder="Esim. Englanti"
                    />
                  </div>
                  <button className="primary-btn save-bonus-btn" onClick={handleSave}>
                    Tallenna bonukset
                  </button>
                  {saveError && (
                    <div style={{ color: "var(--accent-red)", fontSize: "12px", marginTop: "8px", textAlign: "center" }}>
                      Tallennus epäonnistui: {saveError}
                    </div>
                  )}
                </div>
              ) : (
                showPicks && (
                  <div className="bonus-picks-details">
                    <div className="bonus-pick-detail-item">
                      <span className="label">Mestari:</span>
                      <span className="val">{normalizeCountryName(p.bonus.champion) || "—"}</span>
                    </div>
                    <div className="bonus-pick-detail-item">
                      <span className="label">Maalikuningas:</span>
                      <span className="val">{normalizeScorerName(p.bonus.topScorer) || "—"}</span>
                    </div>
                    <div className="bonus-pick-detail-item">
                      <span className="label">Yllättäjä:</span>
                      <span className="val">{normalizeCountryName(p.bonus.surprise) || "—"}</span>
                    </div>
                    <div className="bonus-pick-detail-item">
                      <span className="label">Floppi:</span>
                      <span className="val">{normalizeCountryName(p.bonus.flop) || "—"}</span>
                    </div>
                  </div>
                )
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function GroupTables({ games, teams }: { games: ApiGame[]; teams: ApiTeam[] }) {
  const groups = computeGroupTables(games, teams);

  return (
    <div className="group-grid">
      {groups.map((group) => (
        <section className="group-card" key={group.name}>
          <div className="section-title"><h2>Lohko {group.name}</h2></div>
          <div className="group-table">
            <div className="group-table-head">
              <span>Joukkue</span>
              <span>O</span>
              <span>V</span>
              <span>T</span>
              <span>H</span>
              <span>ME</span>
              <span>P</span>
            </div>
            {group.rows.map((row) => {
              const team = teamById(teams, row.teamId);
              return (
                <div className="group-table-row" key={`${group.name}-${row.teamId}`}>
                  <span className="group-team">
                    {team?.flag ? <img src={team.flag} alt="" className="mini-flag" /> : null}
                    {normalizeTeam(team?.name_en ?? row.teamId)}
                  </span>
                  <span>{row.mp}</span>
                  <span>{row.w}</span>
                  <span>{row.d}</span>
                  <span>{row.l}</span>
                  <span>{row.gf}-{row.ga}</span>
                  <span className="points">{row.pts}</span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

type TournamentTeamStats = {
  teamId: string;
  teamName: string;
  flag?: string;
  played: number;
  goalsFor: number;
  goalsAgainst: number;
  shots: number;
  shotsOnTarget: number;
  corners: number;
  fouls: number;
  yellowCards: number;
  redCards: number;
  expectedGoals: number;
  possessionTotal: number;
  possessionSamples: number;
};

type TournamentStatsSortKey =
  | "teamName"
  | "played"
  | "goalsFor"
  | "goalsAgainst"
  | "shots"
  | "shotsOnTarget"
  | "corners"
  | "fouls"
  | "yellowCards"
  | "redCards"
  | "expectedGoals"
  | "possession";

function numericStat(stats: Array<{ label: string; value: string }>, labels: string[]) {
  const item = stats.find((stat) => labels.includes(stat.label));
  if (!item) return 0;
  const value = Number.parseFloat(String(item.value).replace(",", ".").replace("%", ""));
  return Number.isFinite(value) ? value : 0;
}

function addSummaryStats(target: TournamentTeamStats, stats: Array<{ label: string; value: string }>) {
  target.shots += numericStat(stats, ["Laukaukset"]);
  target.shotsOnTarget += numericStat(stats, ["Maalia kohti"]);
  target.corners += numericStat(stats, ["Kulmat"]);
  target.fouls += numericStat(stats, ["Rikkeet"]);
  target.yellowCards += numericStat(stats, ["Keltaiset"]);
  target.redCards += numericStat(stats, ["Punaiset"]);
  target.expectedGoals += numericStat(stats, ["xG"]);
  const possession = numericStat(stats, ["Pallonhallinta"]);
  if (possession > 0) {
    target.possessionTotal += possession;
    target.possessionSamples += 1;
  }
}

function TournamentStats({
  games,
  teams,
}: {
  games: ApiGame[];
  teams: ApiTeam[];
}) {
  const [summaryCache, setSummaryCache] = useState<Record<string, EspnMatchSummary>>({});
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<TournamentStatsSortKey>("goalsFor");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}live-data/espn-summaries.json`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((data) => {
        if (cancelled || !data || typeof data !== "object") return;
        setSummaryCache((prev) => ({ ...data, ...prev }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const ids = [...new Set(
      games
        .filter((game) => (isFinished(game) || isLive(game)) && !!game.espn_event_id)
        .map((game) => game.espn_event_id as string),
    )];
    const missing = ids.filter((id) => !summaryCache[id]);
    if (!missing.length) return;
    let cancelled = false;
    setLoading(true);
    Promise.allSettled(missing.map((id) => fetchEspnMatchSummary(id)))
      .then((results) => {
        if (cancelled) return;
        const next: Record<string, EspnMatchSummary> = {};
        results.forEach((result) => {
          if (result.status === "fulfilled") next[result.value.eventId] = result.value;
        });
        if (Object.keys(next).length) setSummaryCache((prev) => ({ ...prev, ...next }));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [games, summaryCache]);

  const rows = useMemo(() => {
    const byTeam = new Map<string, TournamentTeamStats>();
    const ensure = (teamId: string, fallbackName: string) => {
      const team = teamById(teams, teamId);
      const existing = byTeam.get(teamId);
      if (existing) return existing;
      const row: TournamentTeamStats = {
        teamId,
        teamName: team ? normalizeTeam(team.name_en) : normalizeTeam(fallbackName),
        flag: team?.flag,
        played: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        shots: 0,
        shotsOnTarget: 0,
        corners: 0,
        fouls: 0,
        yellowCards: 0,
        redCards: 0,
        expectedGoals: 0,
        possessionTotal: 0,
        possessionSamples: 0,
      };
      byTeam.set(teamId, row);
      return row;
    };

    games.forEach((game) => {
      if (!isFinished(game) && !isLive(game)) return;
      const home = ensure(game.home_team_id, teamName(game, "home"));
      const away = ensure(game.away_team_id, teamName(game, "away"));
      const homeGoals = parseScore(game.home_score);
      const awayGoals = parseScore(game.away_score);

      home.played += 1;
      away.played += 1;
      home.goalsFor += homeGoals;
      home.goalsAgainst += awayGoals;
      away.goalsFor += awayGoals;
      away.goalsAgainst += homeGoals;
      home.redCards += game.espn_home_red_cards ?? 0;
      away.redCards += game.espn_away_red_cards ?? 0;

      const summary = game.espn_event_id ? summaryCache[game.espn_event_id] : undefined;
      if (summary) {
        addSummaryStats(home, summary.stats.home);
        addSummaryStats(away, summary.stats.away);
      }
    });

    const sortValue = (row: TournamentTeamStats, key: TournamentStatsSortKey) => {
      if (key === "teamName") return row.teamName;
      if (key === "possession") return row.possessionSamples ? row.possessionTotal / row.possessionSamples : -1;
      return row[key];
    };

    return [...byTeam.values()].sort((a, b) => {
      const left = sortValue(a, sortKey);
      const right = sortValue(b, sortKey);

      if (typeof left === "string" && typeof right === "string") {
        const result = left.localeCompare(right, "fi");
        return sortDirection === "asc" ? result : -result;
      }

      const result = Number(left) - Number(right);
      if (result !== 0) return sortDirection === "asc" ? result : -result;
      return a.teamName.localeCompare(b.teamName, "fi");
    });
  }, [games, summaryCache, teams, sortDirection, sortKey]);

  const toggleSort = (key: TournamentStatsSortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "teamName" ? "asc" : "desc");
  };

  const headers: Array<{ key: TournamentStatsSortKey; label: string }> = [
    { key: "teamName", label: "Joukkue" },
    { key: "played", label: "O" },
    { key: "goalsFor", label: "M" },
    { key: "goalsAgainst", label: "Pääst." },
    { key: "shots", label: "Lauk." },
    { key: "shotsOnTarget", label: "Kohti" },
    { key: "corners", label: "Kulmat" },
    { key: "fouls", label: "Rikk." },
    { key: "yellowCards", label: "Kelt." },
    { key: "redCards", label: "Pun." },
    { key: "expectedGoals", label: "xG" },
    { key: "possession", label: "Hall." },
  ];

  return (
    <div className="tournament-stats-view">
      <div className="section-title stats-title">
        <h2>Turnauksen joukkuetilastot</h2>
        {loading ? <span className="stats-loading-pill">Päivitetään ESPNistä</span> : null}
      </div>
      <div className="team-stats-scroll">
        <div className="team-stats-table">
          <div className="team-stats-head">
            {headers.map((header) => (
              <button
                key={header.key}
                type="button"
                className={clsx("team-stats-sort-button", sortKey === header.key && "active")}
                onClick={() => toggleSort(header.key)}
                aria-label={`Lajittele sarake ${header.label}`}
              >
                <span>{header.label}</span>
                <span className="team-stats-sort-indicator" aria-hidden="true">
                  {sortKey === header.key ? (sortDirection === "asc" ? "↑" : "↓") : ""}
                </span>
              </button>
            ))}
          </div>
          {rows.length ? rows.map((row) => (
            <div className="team-stats-row" key={row.teamId}>
              <span className="team-stats-team">
                {row.flag ? <img src={row.flag} alt="" /> : null}
                {row.teamName}
              </span>
              <span>{row.played}</span>
              <span>{row.goalsFor}</span>
              <span>{row.goalsAgainst}</span>
              <span>{row.shots || "-"}</span>
              <span>{row.shotsOnTarget || "-"}</span>
              <span>{row.corners || "-"}</span>
              <span>{row.fouls || "-"}</span>
              <span>{row.yellowCards || "-"}</span>
              <span>{row.redCards || "-"}</span>
              <span>{row.expectedGoals ? row.expectedGoals.toFixed(2) : "-"}</span>
              <span>{row.possessionSamples ? `${Math.round(row.possessionTotal / row.possessionSamples)}%` : "-"}</span>
            </div>
          )) : (
            <div className="stats-empty">Tilastoja tulee näkyviin, kun pelejä on pelattu.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const cached = loadCachedWorldCup();
  const [pageBackground] = useState(() => {
    if (!WC26_BACKGROUNDS.length) return undefined;
    return WC26_BACKGROUNDS[Math.floor(Math.random() * WC26_BACKGROUNDS.length)];
  });
  const appShellStyle = pageBackground
    ? ({ "--page-bg-image": `url(${pageBackground})` } as React.CSSProperties)
    : undefined;
  const [games, setGames] = useState<ApiGame[]>(cached?.games ?? FALLBACK_GAMES);
  const [teams, setTeams] = useState<ApiTeam[]>(cached?.teams ?? FALLBACK_TEAMS);
  const [stadiums, setStadiums] = useState<ApiStadium[]>(cached?.stadiums ?? FALLBACK_STADIUMS);
  const [players, setPlayers] = useState<PlayerState[]>(localPlayers);
  const [mainView, setMainView] = useState<MainView>("matches");
  const [user, setUser] = useState<User | null>(null);
  const currentName = allowedName(firstName(user));
  const denied = Boolean(user && !currentName);
  const [syncStatus, setSyncStatus] = useState<{ status: "idle" | "loading" | "success" | "error"; message?: string }>({
    status: firebaseEnabled ? "loading" : "idle",
  });
  const [showPointsHint, setShowPointsHint] = useState(true);
  const pointsTableRef = useRef<HTMLElement | null>(null);

  async function loadCup() {
    try {
      const data = await fetchWorldCup();
      let gamesWithEspn = data.games;
      try {
        gamesWithEspn = await enrichGamesWithEspn(data.games);
      } catch (err) {
        console.warn("ESPN enrichment failed, using primary World Cup data:", err);
      }
      setGames(gamesWithEspn);
      setTeams(data.teams);
      setStadiums(data.stadiums);
      saveCachedWorldCup({ ...data, games: gamesWithEspn });
    } catch {
      const cachedData = loadCachedWorldCup();
      if (cachedData?.games?.length) {
        setGames(cachedData.games);
        setTeams(cachedData.teams);
        setStadiums(cachedData.stadiums ?? FALLBACK_STADIUMS);
        return;
      }
      setGames(FALLBACK_GAMES);
      setTeams(FALLBACK_TEAMS);
      setStadiums(FALLBACK_STADIUMS);
    }
  }

  useEffect(() => {
    window.setTimeout(loadCup, 0);
    const id = window.setInterval(loadCup, 45_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!firebaseEnabled || !auth) return;
    return onAuthStateChanged(auth, setUser);
  }, []);

  useEffect(() => {
    if (currentName) {
      const timer = setTimeout(() => setShowPointsHint(false), 8000);
      return () => clearTimeout(timer);
    }
  }, [currentName]);

  useEffect(() => {
    if (!firebaseEnabled || !db || !currentName) {
      if (!firebaseEnabled) {
        setSyncStatus({ status: "idle" });
      }
      return;
    }
    const fire = db;
    setSyncStatus({ status: "loading" });

    let hasFetchError = false;
    let fetchErrorMessage = "";

    Promise.all(
      SEEDED_PLAYERS.map(async (seed) => {
        const ref = doc(fire, "players", seed.name);
        try {
          const snap = await getDoc(ref);
          if (!snap.exists()) {
            const localMatch = localPlayers().find((p) => p.name === seed.name) || seed;
            if (seed.name === currentName) {
              try {
                await setDoc(ref, localMatch);
                const fresh = await getDoc(ref);
                return fresh.exists() ? (fresh.data() as PlayerState) : localMatch;
              } catch (err: any) {
                console.error(`Failed to initialize Firestore document for ${seed.name}:`, err);
                hasFetchError = true;
                fetchErrorMessage = err.message || String(err);
                return localMatch;
              }
            }
            return localMatch;
          }

          const serverData = snap.data() as PlayerState;
          const localMatch = localPlayers().find((p) => p.name === seed.name) || seed;

          // If server is completely empty (e.g. initialized from mobile) but local has data, prefer local.
          // This is a temporary migration safeguard.
          const serverHasBonus = Boolean(serverData.bonus.champion || serverData.bonus.flop || serverData.bonus.surprise || serverData.bonus.topScorer);
          const localHasBonus = Boolean(localMatch.bonus.champion || localMatch.bonus.flop || localMatch.bonus.surprise || localMatch.bonus.topScorer);
          const serverHasBets = serverData.predictions.length > 0;
          const localHasBets = localMatch.predictions.length > 0;

          if (!serverHasBonus && !serverHasBets && (localHasBonus || localHasBets) && seed.name === currentName) {
            await setDoc(ref, localMatch);
            return localMatch;
          }

          // Check if there are any predictions in seed (from local code) that are missing from serverData
          const missingPredictions = seed.predictions.filter(
            (seedPred) => !serverData.predictions.some((srvPred) => srvPred.matchId === seedPred.matchId)
          );

          if (missingPredictions.length > 0) {
            const mergedPredictions = [...serverData.predictions, ...missingPredictions];
            const mergedPlayerState = {
              ...serverData,
              predictions: mergedPredictions,
            };
            if (seed.name === currentName) {
              try {
                await setDoc(ref, mergedPlayerState, { merge: true });
              } catch (err) {
                console.error("Failed to merge missing predictions to Firestore:", err);
              }
            }
            return mergedPlayerState;
          }

          return serverData;
        } catch (err: any) {
          console.warn(`Could not fetch data for ${seed.name}:`, err);
          hasFetchError = true;
          fetchErrorMessage = err.message || String(err);
          const localMatch = localPlayers().find(p => p.name === seed.name);
          return localMatch || seed;
        }
      }),
    ).then((next) => {
      const normalized = next.map(normalizePlayerState);
      setPlayers(normalized);
      saveLocal(normalized);
      if (hasFetchError) {
        setSyncStatus({ status: "error", message: fetchErrorMessage });
      } else {
        setSyncStatus({ status: "success" });
      }
    }).catch((err: any) => {
      console.error("Error syncing players from Firestore:", err);
      setSyncStatus({ status: "error", message: err.message || String(err) });
    });
  }, [currentName]);

  const table = useMemo(() => standings(players, games), [players, games]);
  const myPoints = useMemo(() => {
    return table.find((row) => row.name === currentName)?.points ?? 0;
  }, [table, currentName]);
  const scorers = useMemo(() => scorerTable(games), [games]);
  const scorerRanks = useMemo(() => {
    const ranks = new Map<string, number>();
    let currentRank = 1;
    for (let i = 0; i < scorers.length; i++) {
      if (i > 0 && scorers[i].goals < scorers[i - 1].goals) {
        currentRank = i + 1;
      }
      ranks.set(scorers[i].name, currentRank);
    }
    return ranks;
  }, [scorers]);
  const pickedTopScorers = useMemo(() => {
    const set = new Set<string>();
    players.forEach(p => {
      const name = normalizeScorerName(p.bonus.topScorer);
      if (name) set.add(name);
    });
    return [...set];
  }, [players]);

  const topScorers = useMemo(() => scorers.slice(0, 10), [scorers]);

  const extraScorers = useMemo(() => {
    if (!isBonusLocked()) return [];
    const list: Array<{ name: string; goals: number; rank: string | number; teamId?: string }> = [];

    pickedTopScorers.forEach((pickedName) => {
      const inTop10 = topScorers.some(s => scorerNamesMatch(pickedName, s.name));
      if (inTop10) return;

      const scoredScorer = scorers.find(s => scorerNamesMatch(pickedName, s.name));
      if (scoredScorer) {
        list.push({
          name: scoredScorer.name,
          goals: scoredScorer.goals,
          rank: scorerRanks.get(scoredScorer.name) ?? "-",
          teamId: scoredScorer.teamId
        });
      } else {
        list.push({
          name: pickedName,
          goals: 0,
          rank: "-",
          teamId: undefined
        });
      }
    });

    return list.sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name));
  }, [pickedTopScorers, topScorers, scorers, scorerRanks]);

  const getPickersForScorer = (scorerName: string) => {
    if (!isBonusLocked()) return [];
    return players
      .filter((p) => scorerNamesMatch(p.bonus.topScorer, scorerName))
      .map((p) => p.name);
  };

  function scrollToPointsTable() {
    setShowPointsHint(false);
    const target = pointsTableRef.current;
    if (!target) return;

    const stickyOffset = window.matchMedia("(max-width: 1320px)").matches ? 68 : 16;
    const top = target.getBoundingClientRect().top + window.scrollY - stickyOffset;
    window.scrollTo({ top, behavior: "smooth" });
  }

  async function signIn() {
    if (firebaseEnabled && auth && provider) {
      try {
        await signInWithPopup(auth, provider);
      } catch (err) {
        console.warn("Firebase sign in failed, using mock user for dev:", err);
        setUser({
          uid: "mock-joni",
          displayName: "Joni",
          email: "joni@example.com",
          photoURL: joniLogo,
        } as any);
      }
    } else {
      setUser({
        uid: "mock-joni",
        displayName: "Joni",
        email: "joni@example.com",
        photoURL: joniLogo,
      } as any);
    }
  }

  async function signOutUser() {
    if (firebaseEnabled && auth) {
      try {
        await signOut(auth);
      } catch (err) {
        console.error("Firebase sign out failed:", err);
      }
    }
    setUser(null);
  }

  if (denied) {
    return (
      <main className="app-shell" style={appShellStyle}>
        <div className="arena-backdrop" />
        <section className="main-stage denied">
          <h1>Ei pääsylistalla</h1>
          <p className="hero-copy">Tämä liiga on rajattu nimille Santeri, Sami, Ilpo ja Joni. Google-tilin etunimen täytyy olla yksi näistä.</p>
          <button className="ghost-btn" onClick={signOutUser}>Kirjaudu ulos</button>
        </section>
      </main>
    );
  }

  return (
    <>
      <svg style={{ position: "absolute", left: "-9999px", top: "-9999px", width: "1px", height: "1px", pointerEvents: "none" }}>
        <defs>
          <filter id="wavy-border">
            <feTurbulence type="fractalNoise" baseFrequency="0.002" numOctaves="1" result="noise" />
            <feGaussianBlur in="noise" stdDeviation="5" result="smoothNoise" />
            <feDisplacementMap in="SourceGraphic" in2="smoothNoise" scale="75" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
      <main className="app-shell" style={appShellStyle}>
        <div className="arena-backdrop" />

        {/* Mobile Top Bar */}
        <div className="mobile-top-bar">
          <nav className="mobile-primary-nav">
            <button
              className={clsx("mobile-nav-link", { active: mainView === "matches" })}
              onClick={() => {
                setMainView("matches");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              Ottelut
            </button>
            <button
              className={clsx("mobile-nav-link", { active: mainView === "tables" })}
              onClick={() => {
                setMainView("tables");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              Taulukot
            </button>
            <button
              className={clsx("mobile-nav-link", { active: mainView === "stats" })}
              onClick={() => {
                setMainView("stats");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              Tilastot
            </button>
          </nav>

          <div className="mobile-top-right">
            {currentName ? (
              <div className="mobile-top-user-wrap">
                {showPointsHint && (
                  <div className="points-tooltip">
                    Tästä pääset pistetaulukkoon
                  </div>
                )}
                <span
                  className="mobile-user-points"
                  onClick={scrollToPointsTable}
                >
                  {currentName} {myPoints} p
                </span>
                {user?.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt=""
                    className="avatar avatar-img"
                    referrerPolicy="no-referrer"
                    onClick={signOutUser}
                    title="Kirjaudu ulos"
                  />
                ) : (
                  <span
                    className="avatar"
                    onClick={signOutUser}
                    title="Kirjaudu ulos"
                  >
                    {(currentName ?? "?").slice(0, 1)}
                  </span>
                )}
              </div>
            ) : (
              <button className="primary-btn compact" onClick={signIn}><LogIn size={14} /> Kirjaudu</button>
            )}
          </div>
        </div>

        <header className="hero">
          <div className="hero-header-row">
            <img src={appLogo} alt="Vetoliiga Logo" className="hero-logo" />
            <div className="hero-copy-wrap">
              <div className="eyebrow">Vetoliigan kisaveikkaus 2026</div>
              <h1>Kisataulu</h1>
            </div>
          </div>
        </header>

        <div className="nav-toolbar-row">
          <nav className="primary-nav">
            <button
              className={clsx("nav-link", { active: mainView === "matches" })}
              onClick={() => {
                setMainView("matches");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              Ottelut
            </button>
            <button
              className={clsx("nav-link", { active: mainView === "tables" })}
              onClick={() => {
                setMainView("tables");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              Taulukot
            </button>
            <button
              className={clsx("nav-link", { active: mainView === "stats" })}
              onClick={() => {
                setMainView("stats");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              Tilastot
            </button>
          </nav>
          <section className="desktop-nav-auth">
            <div className="auth-row">
              <div className="user-pill">
                {user?.photoURL ? (
                  <img src={user.photoURL} alt="" className="avatar avatar-img" referrerPolicy="no-referrer" />
                ) : (
                  <span className="avatar">{(currentName ?? "?").slice(0, 1)}</span>
                )}
                <div>
                  <strong>{currentName ?? "Vierailija"}</strong>
                </div>
              </div>
              {currentName ? (
                <button className="icon-btn" title="Kirjaudu ulos" onClick={signOutUser}><LogOut size={18} /></button>
              ) : (
                <button className="primary-btn" onClick={signIn}><LogIn size={16} /> Kirjaudu</button>
              )}
            </div>
          </section>
        </div>

        <div className="layout">
          <section className="main-stage">
            {mainView === "matches" ? (
              <MatchSections
                games={games}
                teams={teams}
                stadiums={stadiums}
                players={players}
                currentPlayerName={currentName}
                setPlayers={setPlayers}
              />
            ) : mainView === "tables" ? (
              <GroupTables games={games} teams={teams} />
            ) : (
              <TournamentStats games={games} teams={teams} />
            )}

          </section>

          <aside className="sidebar">
            <section className="side-card" ref={pointsTableRef} id="points-table-anchor">
              <div className="section-title"><h2>Pistetaulukko</h2><Trophy color="var(--accent-yellow)" /></div>
              {table.map((row, index) => (
                <div className="table-row" key={row.name}>
                  <span className="rank">{index + 1}</span>
                  <span className="table-name">{row.name}</span>
                  <span className="points">{row.points} p</span>
                </div>
              ))}
            </section>

            <section className="side-card">
              <div className="section-title"><h2>Maalipörssi</h2></div>
              {topScorers.length ? (
                <div className="scorer-list">
                  {topScorers.map((scorer, index) => {
                    const pickers = getPickersForScorer(scorer.name);
                    const team = teamById(teams, scorer.teamId);
                    const flagUrl = team?.flag;
                    return (
                      <div className="scorer-row" key={scorer.name}>
                        <span className="rank">{scorerRanks.get(scorer.name) ?? index + 1}</span>
                        <span className="scorer-name">
                          {flagUrl ? <img src={flagUrl} alt="" className="scorer-flag" /> : null}
                          <span>
                            {scorer.name}
                            {pickers.map((pName) => (
                              <span className="scorer-picker-pill" key={pName}>{pName}</span>
                            ))}
                          </span>
                        </span>
                        <span className="points">{scorer.goals}</span>
                      </div>
                    );
                  })}

                  {extraScorers.length > 0 && (
                    <>
                      <div className="scorer-divider">Valitut haastajat</div>
                      {extraScorers.map((scorer) => {
                        const pickers = getPickersForScorer(scorer.name);
                        const team = scorer.teamId ? teamById(teams, scorer.teamId) : null;
                        const flagUrl = team?.flag;
                        return (
                          <div className="scorer-row extra-scorer" key={scorer.name}>
                            <span className="rank">{scorer.rank}</span>
                            <span className="scorer-name">
                              {flagUrl ? <img src={flagUrl} alt="" className="scorer-flag" /> : null}
                              <span>
                                {scorer.name}
                                {pickers.map((pName) => (
                                  <span className="scorer-picker-pill" key={pName}>{pName}</span>
                                ))}
                              </span>
                            </span>
                            <span className="points">{scorer.goals}</span>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              ) : (
                <p className="subtle-note">Maalipörssitaulu täyttyy heti kun dataa tulee.</p>
              )}
            </section>



            <BonusBetsCard currentName={currentName} players={players} setPlayers={setPlayers} />
          </aside>

          <section className="rules-section">
            <div className="rules-panel">
              <div className="section-title"><h2>Pisteytys</h2></div>
              <div className="rule-list">
                <div className="rule-item"><span className="badge">5</span><div><strong>Täysin oikea tulos</strong><span className="muted">Esim. 2-1 ja peli päättyy 2-1.</span></div></div>
                <div className="rule-item"><span className="badge">3</span><div><strong>Oikea maaliero ja merkki</strong><span className="muted">Esim. 3-1 ja peli päättyy 2-0.</span></div></div>
                <div className="rule-item"><span className="badge">2</span><div><strong>Oikea merkki, väärä maaliero</strong><span className="muted">Esim. 1-0 ja peli päättyy 3-1.</span></div></div>
                <div className="rule-item"><span className="badge">2</span><div><strong>Tasapeli oikein, väärät maalit</strong><span className="muted">Esim. 1-1 ja peli päättyy 2-2.</span></div></div>
                <div className="rule-item"><span className="badge">1</span><div><strong>Toisen joukkueen maalimäärä oikein, tulos väärin</strong><span className="muted">Esim. veikkaus 2-0 ja peli päättyy 2-3.</span></div></div>
              </div>

              <div className="section-title" style={{ marginTop: "24px" }}><h2>Bonusveikkaukset</h2></div>
              <div className="rule-list">
                <div className="rule-item"><span className="badge hot">20</span><div><strong>Oikea maailmanmestari</strong></div></div>
                <div className="rule-item"><span className="badge">10</span><div><strong>Turnauksen maalikuningas</strong></div></div>
                <div className="rule-item"><span className="badge">10</span><div><strong>Kisojen yllättäjä</strong></div></div>
                <div className="rule-item"><span className="badge">10</span><div><strong>Kisojen floppi</strong></div></div>
              </div>
            </div>
          </section>
        </div>
      </main>

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-credits">
            <span>&copy; {new Date().getFullYear()}</span>
            <a href="https://github.com/jronimus" target="_blank" rel="noopener noreferrer" className="footer-author-link">
              <img src={joniLogo} alt="Joni Ronimus" className="footer-logo" />
              Joni Ronimus
            </a>
          </div>
          <div className="footer-repo">
            <a href="https://github.com/jronimus/vetoliigan-kisaveikkaus-2026" target="_blank" rel="noopener noreferrer">
              Projektin lähdekoodi (GitHub)
            </a>
          </div>
          <div className="footer-sync">
            {syncStatus.status !== "idle" && (
              <span className={clsx("sync-status-badge", syncStatus.status)}>
                {syncStatus.status === "loading" && "Synkronoidaan..."}
                {syncStatus.status === "success" && "Tietokanta synkattu"}
                {syncStatus.status === "error" && `Yhteysvirhe: ${syncStatus.message}`}
              </span>
            )}
          </div>
        </div>
      </footer>
    </>
  );
}
