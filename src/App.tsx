import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { LogIn, LogOut, Trophy } from "lucide-react";
import clsx from "clsx";
import { auth, db, firebaseEnabled, provider } from "./firebase";
import { LOCK_DATE_LABEL, TEAM_FI, SEEDED_PLAYERS, type BonusPicks, type PlayerName, type PlayerState, type Prediction } from "./data";
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
  if (!saved) return SEEDED_PLAYERS;
  try {
    return JSON.parse(saved) as PlayerState[];
  } catch {
    return SEEDED_PLAYERS;
  }
}

function saveLocal(players: PlayerState[]) {
  localStorage.setItem("vetoliiga.players", JSON.stringify(players));
}

function normalizeTeam(name: string) {
  return TEAM_FI[name] ?? name;
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
  return `${stadium.city_en}, ${normalizeTeam(stadium.country_en)}`;
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

  async function save() {
    const home = Number.parseInt(homeDraft, 10);
    const away = Number.parseInt(awayDraft, 10);
    if (!Number.isFinite(home) || !Number.isFinite(away) || home < 0 || away < 0) return;

    const nextPrediction: Prediction = { matchId: game.id, home, away, locked: predictionLocked(game) };
    const nextPlayer = {
      ...player,
      predictions: [...player.predictions.filter((item) => item.matchId !== game.id), nextPrediction],
    };
    const nextPlayers = players.map((item) => (item.name === player.name ? nextPlayer : item));
    setPlayers(nextPlayers);
    saveLocal(nextPlayers);
    if (firebaseEnabled && db) await setDoc(doc(db, "players", player.name), nextPlayer, { merge: true });
    onSaveComplete();
  }

  return (
    <div className="prediction-row inline-edit">
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
    const counts: Record<string, number> = {};
    homeScorers.forEach((name) => { counts[name] = (counts[name] ?? 0) + 1; });
    return Object.entries(counts).map(([name, count]) => count > 1 ? `${name} x${count}` : name);
  }, [homeScorers]);

  const awayLines = useMemo(() => {
    const counts: Record<string, number> = {};
    awayScorers.forEach((name) => { counts[name] = (counts[name] ?? 0) + 1; });
    return Object.entries(counts).map(([name, count]) => count > 1 ? `${name} x${count}` : name);
  }, [awayScorers]);

  const kickoffStatus = getKickoffStatus(game, now);
  const isLongVenue = (infoLabel || "").length > 32;

  const homeLong = normalizeTeam(home).length > 13;
  const awayLong = normalizeTeam(away).length > 13;

  return (
    <article className="match-card">
      <div className="match-badges">
        <span className={clsx("match-status", kickoffStatus.type)}>{kickoffStatus.text}</span>
        <span className="group-tag">{stageLabel(game)}</span>
      </div>

      <div className="top-ribbon">
        <span className={clsx("venue-name", { marquee: isLongVenue })}>{infoLabel || "Kisapaikka"}</span>
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
            <div className="inline-name-wrap">
              <span className={clsx("inline-name", { marquee: homeLong })}>{normalizeTeam(home)}</span>
            </div>
          </div>

          {isFinished(game) || isLive(game) ? (
            <div className={clsx("inline-score-block", { "live-game": isLive(game) })}>
              <div className="inline-score-wrap">
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
            <div className="inline-name-wrap">
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

          return (
            <div className="prediction-row" key={player.name}>
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

  // Split each visible day's games into chunks of max 5 games
  const recentChunks: Array<{ label: string; games: ApiGame[] }> = [];
  visibleRecentDays.forEach(([label, dayGames]) => {
    for (let i = 0; i < dayGames.length; i += 5) {
      recentChunks.push({
        label,
        games: dayGames.slice(i, i + 5),
      });
    }
  });

  // Pack chunks into rows of max 5 games total
  const rows: Array<Array<{ label: string; games: ApiGame[] }>> = [];
  let currentRow: Array<{ label: string; games: ApiGame[] }> = [];
  let currentGamesCount = 0;

  for (const chunk of recentChunks) {
    const chunkGamesCount = chunk.games.length;
    if (currentGamesCount + chunkGamesCount > 5 && currentRow.length > 0) {
      rows.push(currentRow);
      currentRow = [chunk];
      currentGamesCount = chunkGamesCount;
    } else {
      currentRow.push(chunk);
      currentGamesCount += chunkGamesCount;
    }
  }
  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  // Group older games by date label
  const olderGroupedByDate = new Map<string, ApiGame[]>();
  olderGames.forEach((game) => {
    const key = dateLabel(game);
    olderGroupedByDate.set(key, [...(olderGroupedByDate.get(key) ?? []), game]);
  });

  const allOlderDays = [...olderGroupedByDate.entries()];

  // Split each older day's games into chunks of max 5 games
  const olderChunks: Array<{ label: string; games: ApiGame[] }> = [];
  allOlderDays.forEach(([label, dayGames]) => {
    for (let i = 0; i < dayGames.length; i += 5) {
      olderChunks.push({
        label,
        games: dayGames.slice(i, i + 5),
      });
    }
  });

  // Pack chunks into rows of max 5 games total
  const olderRows: Array<Array<{ label: string; games: ApiGame[] }>> = [];
  let currentOlderRow: Array<{ label: string; games: ApiGame[] }> = [];
  let currentOlderGamesCount = 0;

  for (const chunk of olderChunks) {
    const chunkGamesCount = chunk.games.length;
    if (currentOlderGamesCount + chunkGamesCount > 5 && currentOlderRow.length > 0) {
      olderRows.push(currentOlderRow);
      currentOlderRow = [chunk];
      currentOlderGamesCount = chunkGamesCount;
    } else {
      currentOlderRow.push(chunk);
      currentOlderGamesCount += chunkGamesCount;
    }
  }
  if (currentOlderRow.length > 0) {
    olderRows.push(currentOlderRow);
  }

  return (
    <div className="section-stack-rows">
      {rows.map((row, rowIndex) => (
        <div className="days-row" key={`recent-row-${rowIndex}`}>
          {row.map((chunk, chunkIndex) => (
            <section className="day-section compact-day" key={`${chunk.label}-${chunkIndex}`}>
              <div className="day-heading">{chunk.label}</div>
              <div className="match-grid compact-grid" style={{ gridTemplateColumns: `repeat(${chunk.games.length}, minmax(0, 280px))` }}>
                {chunk.games.map((game) => (
                  <MatchCard
                    game={game}
                    teams={teams}
                    stadiums={stadiums}
                    players={players}
                    currentPlayerName={currentPlayerName}
                    setPlayers={setPlayers}
                    key={game.id}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ))}

      {hasMoreRecentDays && (
        <div className="show-more-row">
          <button className="primary-btn show-more-btn" onClick={() => setVisibleDaysCount((prev) => prev + 7)}>
            Näytä lisää
          </button>
        </div>
      )}

      {olderRows.length ? (
        <div className="older-games-section">
          <div className="older-heading">Aikaisemmat ottelut</div>
          <div className="section-stack-rows">
            {olderRows.map((row, rowIndex) => (
              <div className="days-row" key={`older-row-${rowIndex}`}>
                {row.map((chunk, chunkIndex) => (
                  <section className="day-section compact-day" key={`${chunk.label}-${chunkIndex}`}>
                    <div className="day-heading">{chunk.label}</div>
                    <div className="match-grid compact-grid" style={{ gridTemplateColumns: `repeat(${chunk.games.length}, minmax(0, 280px))` }}>
                      {chunk.games.map((game) => (
                        <MatchCard
                          game={game}
                          teams={teams}
                          stadiums={stadiums}
                          players={players}
                          currentPlayerName={currentPlayerName}
                          setPlayers={setPlayers}
                          key={game.id}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BonusEditor({ current, players, setPlayers }: { current?: PlayerName; players: PlayerState[]; setPlayers: (players: PlayerState[]) => void }) {
  const player = players.find((item) => item.name === current);
  if (!player) return <p className="subtle-note">Kirjaudu omalla Google-tilillä, niin voit täydentää bonusveikkaukset.</p>;
  return <BonusEditorFields key={`${player.name}-${JSON.stringify(player.bonus)}`} player={player} players={players} setPlayers={setPlayers} />;
}

function BonusEditorFields({ player, players, setPlayers }: { player: PlayerState; players: PlayerState[]; setPlayers: (players: PlayerState[]) => void }) {
  const [draft, setDraft] = useState<BonusPicks>(player.bonus);
  const locked = isBonusLocked();

  async function saveBonus() {
    if (locked) return;
    const next = players.map((item) => (item.name === player.name ? { ...item, bonus: draft } : item));
    setPlayers(next);
    saveLocal(next);
    if (firebaseEnabled && db) await setDoc(doc(db, "players", player.name), { ...player, bonus: draft }, { merge: true });
  }

  if (locked) {
    return (
      <div className="bonus-form read-only">
        <div className="bonus-read-item"><span className="muted">Maailmanmestari:</span> <strong>{player.bonus.champion || "Ei valintaa"}</strong></div>
        <div className="bonus-read-item"><span className="muted">Maalikuningas:</span> <strong>{player.bonus.topScorer || "Ei valintaa"}</strong></div>
        <div className="bonus-read-item"><span className="muted">Yllättäjä:</span> <strong>{player.bonus.surprise || "Ei valintaa"}</strong></div>
        <div className="bonus-read-item"><span className="muted">Floppi:</span> <strong>{player.bonus.flop || "Ei valintaa"}</strong></div>
        <p className="subtle-note">Bonusveikkaukset ovat lukittuneet.</p>
      </div>
    );
  }

  return (
    <div className="bonus-form">
      <label>Maailmanmestari<input value={draft.champion} onChange={(event) => setDraft({ ...draft, champion: event.target.value })} /></label>
      <label>Maalikuningas<input value={draft.topScorer} onChange={(event) => setDraft({ ...draft, topScorer: event.target.value })} /></label>
      <label>Yllättäjä<input value={draft.surprise} onChange={(event) => setDraft({ ...draft, surprise: event.target.value })} /></label>
      <label>Floppi<input value={draft.flop} onChange={(event) => setDraft({ ...draft, flop: event.target.value })} /></label>
      <button className="primary-btn" onClick={saveBonus}>Tallenna bonusveikkaukset</button>
    </div>
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
    if (!firebaseEnabled || !db || !currentName) return;
    const fire = db;
    Promise.all(
      SEEDED_PLAYERS.map(async (seed) => {
        const ref = doc(fire, "players", seed.name);
        const snap = await getDoc(ref);
        if (!snap.exists()) await setDoc(ref, seed);
        const fresh = await getDoc(ref);
        return fresh.exists() ? (fresh.data() as PlayerState) : seed;
      }),
    ).then((next) => {
      setPlayers(next);
      saveLocal(next);
    });
  }, [currentName]);

  const table = useMemo(() => standings(players, games), [players, games]);
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
  const pickedTopScorers = players.map((player) => player.bonus.topScorer).filter(Boolean);
  const shownScorers = [
    ...scorers.slice(0, 10),
    ...scorers.filter((scorer) => pickedTopScorers.includes(scorer.name) && !scorers.slice(0, 10).some((item) => item.name === scorer.name)),
  ];

  async function signIn() {
    if (firebaseEnabled && auth && provider) {
      await signInWithPopup(auth, provider);
    }
  }

  async function signOutUser() {
    if (firebaseEnabled && auth) await signOut(auth);
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
    <main className="app-shell">
      <div className="arena-backdrop" />

      {/* Mobile Header Auth (visible only on mobile in top right) */}
      <div className="mobile-header-auth">
        {currentName ? (
          <div className="mobile-auth-logged">
            {user?.photoURL ? (
              <img src={user.photoURL} alt="" className="avatar avatar-img" referrerPolicy="no-referrer" onClick={signOutUser} title="Kirjaudu ulos" />
            ) : (
              <span className="avatar" onClick={signOutUser} title="Kirjaudu ulos">{(currentName ?? "?").slice(0, 1)}</span>
            )}
          </div>
        ) : (
          <button className="primary-btn compact" onClick={signIn}><LogIn size={14} /> Kirjaudu</button>
        )}
      </div>

      <header className="hero">
        <div className="hero-copy-wrap">
          <div className="eyebrow">Vetoliigan kisaveikkaus 2026</div>
          <h1>Kisataulu</h1>
          <p className="hero-copy">Livetulokset, veikkaukset, bonusrivit ja maalikuningastilanne samassa näkymässä.</p>
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

          <section className="rules-grid">
            <div className="rules-panel">
              <div className="section-title"><h2>Pisteytys</h2></div>
              <div className="rule-list">
                <div className="rule-item"><span className="badge">5</span><div><strong>Täysin oikea tulos</strong><span className="muted">Esim. 2-1 ja peli päättyy 2-1.</span></div></div>
                <div className="rule-item"><span className="badge">3</span><div><strong>Oikea maaliero ja merkki</strong><span className="muted">Esim. 3-1 ja peli päättyy 2-0.</span></div></div>
                <div className="rule-item"><span className="badge">2</span><div><strong>Oikea merkki, väärä maaliero</strong><span className="muted">Esim. 1-0 ja peli päättyy 3-1.</span></div></div>
                <div className="rule-item"><span className="badge">2</span><div><strong>Tasapeli oikein, väärät maalit</strong><span className="muted">Esim. 1-1 ja peli päättyy 2-2.</span></div></div>
                <div className="rule-item"><span className="badge">1</span><div><strong>Toisen joukkueen maalimäärä oikein, tulos väärin</strong><span className="muted">Esim. veikkaus 2-0 ja peli päättyy 2-3.</span></div></div>
              </div>
            </div>

            <div className="rules-panel">
              <div className="section-title"><h2>Bonusveikkaukset</h2></div>
              <div className="bonus-timing">Lukitaan: {LOCK_DATE_LABEL}</div>
              <div className="rule-list">
                <div className="rule-item"><span className="badge hot">20</span><div><strong>Oikea maailmanmestari</strong></div></div>
                <div className="rule-item"><span className="badge">10</span><div><strong>Turnauksen maalikuningas</strong></div></div>
                <div className="rule-item"><span className="badge">10</span><div><strong>Kisojen yllättäjä</strong></div></div>
                <div className="rule-item"><span className="badge">10</span><div><strong>Kisojen floppi</strong></div></div>
              </div>
            </div>
          </section>
        </section>

        <aside className="sidebar">
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
            <div className="section-title"><h2>Maalintekijät</h2></div>
            {shownScorers.length ? shownScorers.map((scorer, index) => {
              const pickers = isBonusLocked()
                ? players.filter((player) => player.bonus.topScorer.toLowerCase() === scorer.name.toLowerCase()).map((player) => player.name)
                : [];
              const team = teamById(teams, scorer.teamId);
              const flagUrl = team?.flag;
              return (
                <div className="scorer-row" key={scorer.name}>
                  <span className="rank">{scorerRanks.get(scorer.name) ?? index + 1}</span>
                  <span className="scorer-name">
                    {flagUrl ? <img src={flagUrl} alt="" className="scorer-flag" /> : null}
                    <span>
                      {scorer.name}
                      {pickers.length ? <span className="muted small"> / {pickers.join(", ")}</span> : null}
                    </span>
                  </span>
                  <span className="points">{scorer.goals}</span>
                </div>
              );
            }) : <p className="subtle-note">Maalintekijätaulu täyttyy heti kun dataa tulee.</p>}
          </section>



          <section className="side-card">
            <div className="section-title"><h2>Omat bonukset</h2></div>
            <BonusEditor current={currentName} players={players} setPlayers={setPlayers} />
          </section>

          <section className="side-card">
            <div className="section-title"><h2>Bonus per käyttäjä</h2></div>
            {players.map((player) => {
              const showDetails = isBonusLocked() || player.name === currentName;
              const filledCount = [player.bonus.champion, player.bonus.topScorer, player.bonus.surprise, player.bonus.flop].filter(Boolean).length;
              return (
                <div className="bonus-row" key={player.name}>
                  <strong>{player.name}</strong>
                  <span className="muted small">
                    {showDetails
                      ? [player.bonus.champion, player.bonus.topScorer, player.bonus.surprise, player.bonus.flop].filter(Boolean).join(" / ") || "Ei vielä valintoja"
                      : filledCount > 0
                        ? `${filledCount}/4 valintaa tehty`
                        : "Ei vielä valintoja"}
                  </span>
                </div>
              );
            })}
          </section>
        </aside>
      </div>
    </main>
  );
}
