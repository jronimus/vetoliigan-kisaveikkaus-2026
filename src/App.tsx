import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { LogIn, LogOut, Trophy } from "lucide-react";
import clsx from "clsx";
import joniLogo from "./assets/joni-logo.png";
import appLogo from "./assets/logo-inverted.png";

export type GameStatus = "upcoming" | "live" | "finished";
import { auth, db, firebaseEnabled, provider } from "./firebase";
import { TEAM_FI, SEEDED_PLAYERS, type BonusPicks, type PlayerName, type PlayerState, type Prediction } from "./data";
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
  parseScorers,
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

type MainView = "matches" | "tables";

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
  return TEAM_FI[name] ?? name;
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
    "kongon demokraattinen tasavalta": "Kongon demokraattinen tasavalta",
    "kongo": "Kongon demokraattinen tasavalta",
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
  if (isLive(game)) return { text: "Live", type: "live" };

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

function currentFirst(games: ApiGame[]) {
  return [...games].sort((a, b) => {
    const aLive = isLive(a) ? -1 : 0;
    const bLive = isLive(b) ? -1 : 0;
    if (aLive !== bLive) return aLive - bLive;
    return kickoffMillis(a) - kickoffMillis(b);
  });
}

function recentFirst(games: ApiGame[]) {
  return [...games].sort((a, b) => kickoffMillis(b) - kickoffMillis(a));
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

function channelClass(channel: string) {
  const lower = channel.toLowerCase();
  if (lower.includes("yle")) return "yle";
  if (lower.includes("mtv") || lower.includes("katsomo")) return "mtv";
  return "";
}

function MatchCard({
  game,
  teams,
  stadiums,
  players,
  currentPlayerName,
  setPlayers,
}: {
  game: ApiGame;
  teams: ApiTeam[];
  stadiums: ApiStadium[];
  players: PlayerState[];
  currentPlayerName?: PlayerName;
  setPlayers: (players: PlayerState[]) => void;
}) {
  const home = teamName(game, "home");
  const away = teamName(game, "away");
  const homeTeam = teamByName(teams, home);
  const awayTeam = teamByName(teams, away);
  const homeScorers = parseScorers(game.home_scorers);
  const awayScorers = parseScorers(game.away_scorers);
  
  const displayPlayers = [...players].sort((a, b) => a.name.localeCompare(b.name));

  const scheduled = finlandClockDate(game);
  const infoLabel = cityCountry(stadiums, game);
  const channels = tvChannelsForGame(game);
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

  const homeLines = useMemo(() => {
    const counts: Record<string, { count: number; isOwnGoal: boolean }> = {};
    homeScorers.forEach((scorer) => {
      const display = scorer.isOwnGoal ? `${scorer.name} (OM)` : scorer.name;
      const current = counts[display] || { count: 0, isOwnGoal: scorer.isOwnGoal };
      counts[display] = { count: current.count + 1, isOwnGoal: scorer.isOwnGoal };
    });
    return Object.entries(counts).map(([display, item]) => item.count > 1 ? `${display} x${item.count}` : display);
  }, [homeScorers]);

  const awayLines = useMemo(() => {
    const counts: Record<string, { count: number; isOwnGoal: boolean }> = {};
    awayScorers.forEach((scorer) => {
      const display = scorer.isOwnGoal ? `${scorer.name} (OM)` : scorer.name;
      const current = counts[display] || { count: 0, isOwnGoal: scorer.isOwnGoal };
      counts[display] = { count: current.count + 1, isOwnGoal: scorer.isOwnGoal };
    });
    return Object.entries(counts).map(([display, item]) => item.count > 1 ? `${display} x${item.count}` : display);
  }, [awayScorers]);

  const kickoffStatus = getKickoffStatus(game, now);

  const homeLong = normalizeTeam(home).length > 13;
  const awayLong = normalizeTeam(away).length > 13;

  return (
    <div className="match-card-wrapper">
      <div className="match-card-shadow match-card-shadow-red" />
      <div className="match-card-shadow match-card-shadow-green" />
      <article className="match-card">
        <div className="match-badges">
          <span className={clsx("match-status", kickoffStatus.type)}>{kickoffStatus.text}</span>
          {game.fallback_source === "yle" ? <span className="sync-pill">EI SYNKATTU</span> : null}
          <span className="group-tag">{stageLabel(game)}</span>
        </div>

        <div className="top-ribbon">
          <span className="venue-name">{infoLabel || "Kisapaikka"}</span>
          {channels.length ? (
            <span className="channel-pills">
              {channels.map((channel) => <span className={clsx("channel-pill", channelClass(channel))} key={channel}>{channel}</span>)}
            </span>
          ) : null}
        </div>

        <div className="match-stage">
          <div className="match-inline">
            <div className="inline-team">
              {homeTeam?.flag ? <img className="inline-flag home-flag" src={homeTeam.flag} alt="" /> : null}
              <div className={clsx("inline-name-wrap", { "has-marquee": homeLong })}>
                <span className={clsx("inline-name", { marquee: homeLong })}>{normalizeTeam(home)}</span>
              </div>
            </div>

            {isFinished(game) || isLive(game) ? (
              <div className={clsx("inline-score-block new-style", { "live-game": isLive(game) })}>
                <div className="inline-score-box">
                  <span className="inline-score-val">{parseScore(game.home_score)}</span>
                  <span className="inline-score-colon">:</span>
                  <span className="inline-score-val">{parseScore(game.away_score)}</span>
                </div>
              </div>
            ) : (
              <div className="inline-time-block">
                <strong className={clsx("inline-score", typeof centerValue === "string" && centerValue.startsWith("Alkaa") ? "countdown" : "upcoming")}>
                  {centerValue}
                </strong>
              </div>
            )}

            <div className="inline-team">
              {awayTeam?.flag ? <img className="inline-flag away-flag" src={awayTeam.flag} alt="" /> : null}
              <div className={clsx("inline-name-wrap", { "has-marquee": awayLong })}>
                <span className={clsx("inline-name", { marquee: awayLong })}>{normalizeTeam(away)}</span>
              </div>
            </div>
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

  const recentGames = currentFirst(visibleGames.filter((game) => !archivedMatch(game)));
  const olderGames = recentFirst(visibleGames.filter((game) => archivedMatch(game)));

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

  return (
    <div className="section-stack-rows">
      <div className="days-row-grid">
        {visibleRecentDays.map(([label, games]) =>
          games.map((game, gameIdx) => (
            <div className="match-card-wrapper" key={game.id}>
              <div className="match-day-header" style={{ visibility: gameIdx === 0 ? "visible" : "hidden" }}>
                {label}
              </div>
              <MatchCard
                game={game}
                teams={teams}
                stadiums={stadiums}
                players={players}
                currentPlayerName={currentPlayerName}
                setPlayers={setPlayers}
              />
            </div>
          ))
        )}
      </div>

      {hasMoreRecentDays && (
        <div className="show-more-row">
          <button className="primary-btn show-more-btn" onClick={() => setVisibleDaysCount((prev) => prev + 7)}>
            Näytä lisää
          </button>
        </div>
      )}

      {allOlderDays.length > 0 && (
        <div className="older-games-section">
          <div className="older-heading">Aikaisemmat ottelut</div>
          <div className="section-stack-rows">
            <div className="days-row-grid">
              {allOlderDays.map(([label, games]) =>
                games.map((game, gameIdx) => (
                  <div className="match-card-wrapper" key={game.id}>
                    <div className="match-day-header" style={{ visibility: gameIdx === 0 ? "visible" : "hidden" }}>
                      {label}
                    </div>
                    <MatchCard
                      game={game}
                      teams={teams}
                      stadiums={stadiums}
                      players={players}
                      currentPlayerName={currentPlayerName}
                      setPlayers={setPlayers}
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
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

export default function App() {
  const cached = loadCachedWorldCup();
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

  async function loadCup() {
    try {
      const data = await fetchWorldCup();
      setGames(data.games);
      setTeams(data.teams);
      setStadiums(data.stadiums);
      saveCachedWorldCup(data);
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
      <main className="app-shell">
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
      <main className="app-shell">
      <div className="arena-backdrop" />

      {/* Mobile Top Bar */}
      <div className="mobile-top-bar">
        <nav className="mobile-primary-nav">
          <button className={clsx("mobile-nav-link", { active: mainView === "matches" })} onClick={() => setMainView("matches")}>Ottelut</button>
          <button className={clsx("mobile-nav-link", { active: mainView === "tables" })} onClick={() => setMainView("tables")}>Taulukot</button>
        </nav>

        <div className="mobile-top-right">
          {currentName ? (
            <div className="mobile-top-user-wrap">
              {showPointsHint && (
                <div className="points-tooltip">
                  Klikkaa tästä nähdäksesi pistetaulukon!
                </div>
              )}
              <span 
                className="mobile-user-points"
                onClick={() => document.getElementById('points-table-anchor')?.scrollIntoView({ behavior: 'smooth' })}
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
          <button className={clsx("nav-link", { active: mainView === "matches" })} onClick={() => setMainView("matches")}>Ottelut</button>
          <button className={clsx("nav-link", { active: mainView === "tables" })} onClick={() => setMainView("tables")}>Taulukot</button>
        </nav>
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
          ) : (
            <GroupTables games={games} teams={teams} />
          )}

        </section>

        <aside className="sidebar">
          <div id="points-table-anchor" style={{ position: "relative", top: "-60px" }}></div>
          <section className="side-card auth-card desktop-only-auth">
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

          <section className="side-card">
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
