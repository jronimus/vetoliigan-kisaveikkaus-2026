import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { LogIn, LogOut, RotateCcw, Trophy } from "lucide-react";
import clsx from "clsx";
import { auth, db, firebaseEnabled, provider } from "./firebase";
import { LOCK_DATE_LABEL, TEAM_FI, SEEDED_PLAYERS, type BonusPicks, type PlayerName, type PlayerState, type Prediction } from "./data";
import { matchPoints, standings } from "./scoring";
import {
  FALLBACK_GAMES,
  FALLBACK_STADIUMS,
  FALLBACK_TEAMS,
  archivedMatch,
  fetchWorldCup,
  finlandClockDate,
  finnishKickoff,
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
  type WorldCupState,
} from "./worldcup";

type MainView = "matches" | "tables";
type MatchViewMode = "date" | "group";

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

function statusLabel(game: ApiGame) {
  if (isFinished(game)) return "Päättynyt";
  if (isLive(game)) return "Livenä";
  return "Tulossa";
}

function kickoffMillis(game: ApiGame) {
  return finlandClockDate(game)?.getTime() ?? Number.MAX_SAFE_INTEGER;
}

function dateLabel(game: ApiGame) {
  const kickoff = finlandClockDate(game);
  if (!kickoff) return game.local_date;
  return new Intl.DateTimeFormat("fi-FI", {
    weekday: "long",
    day: "numeric",
    month: "numeric",
    timeZone: "UTC",
  }).format(kickoff);
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

function MatchCard({
  game,
  teams,
  stadiums,
  players,
}: {
  game: ApiGame;
  teams: ApiTeam[];
  stadiums: ApiStadium[];
  players: PlayerState[];
}) {
  const home = teamName(game, "home");
  const away = teamName(game, "away");
  const homeTeam = teamByName(teams, home);
  const awayTeam = teamByName(teams, away);
  const homeScorers = parseScorers(game.home_scorers);
  const awayScorers = parseScorers(game.away_scorers);
  const predictions = players.filter((player) => player.predictions.some((item) => item.matchId === game.id));
  const scheduled = finlandClockDate(game);
  const infoLabel = cityCountry(stadiums, game);
  const centerValue = isFinished(game) || isLive(game)
    ? `${parseScore(game.home_score)}:${parseScore(game.away_score)}`
    : scheduled
      ? new Intl.DateTimeFormat("fi-FI", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(scheduled)
      : "--:--";

  return (
    <article className="match-card">
      <div className="match-shadow red" />
      <div className="match-shadow blue" />
      <div className="match-shadow green" />

      <div className="match-badges">
        <span className={clsx("match-status", { live: isLive(game), finished: isFinished(game) })}>{statusLabel(game)}</span>
        <span className="group-tag">{stageLabel(game)}</span>
      </div>

      <div className="top-ribbon">{infoLabel || "Kisapaikka"}</div>

      <div className="match-stage">
        <div className="match-inline">
          <div className="inline-team">
            {homeTeam?.flag ? <img className="inline-flag" src={homeTeam.flag} alt="" /> : null}
            <span className="inline-name">{normalizeTeam(home)}</span>
          </div>

          <div className="inline-score-block">
            <strong className="inline-score">{centerValue}</strong>
            <span className="inline-time">{finnishKickoff(game)}</span>
          </div>

          <div className="inline-team right">
            <span className="inline-name">{normalizeTeam(away)}</span>
            {awayTeam?.flag ? <img className="inline-flag" src={awayTeam.flag} alt="" /> : null}
          </div>
        </div>
      </div>

      <div className="scorer-strip">
        <div>
          <strong>{homeScorers.length ? homeScorers.join(", ") : "Ei maalintekijöitä"}</strong>
          <span>{normalizeTeam(home)}</span>
        </div>
        <div>
          <strong>{awayScorers.length ? awayScorers.join(", ") : "Ei maalintekijöitä"}</strong>
          <span>{normalizeTeam(away)}</span>
        </div>
      </div>

      <div className="prediction-list">
        {predictions.length ? predictions.map((player) => {
          const prediction = player.predictions.find((item) => item.matchId === game.id);
          if (!prediction) return null;
          return (
            <div className="prediction-row" key={player.name}>
              <strong>{player.name}</strong>
              <span className="prediction-score">{prediction.home}-{prediction.away}</span>
              <span className="points">{matchPoints(prediction, game)} p</span>
            </div>
          );
        }) : (
          <div className="prediction-row empty">
            <strong>Veikkaukset</strong>
            <span className="muted small">Auki vielä</span>
          </div>
        )}
      </div>
    </article>
  );
}

function MatchSections({
  games,
  teams,
  stadiums,
  players,
  mode,
  groupFilter,
}: {
  games: ApiGame[];
  teams: ApiTeam[];
  stadiums: ApiStadium[];
  players: PlayerState[];
  mode: MatchViewMode;
  groupFilter: string;
}) {
  const visibleGames = useMemo(() => {
    if (mode === "group" && groupFilter !== "all") {
      return games.filter((game) => game.group === groupFilter || game.type === groupFilter);
    }
    return games;
  }, [games, mode, groupFilter]);

  const recentGames = currentFirst(visibleGames.filter((game) => !archivedMatch(game)));
  const olderGames = recentFirst(visibleGames.filter((game) => archivedMatch(game)));

  if (mode === "group") {
    const grouped = new Map<string, ApiGame[]>();
    recentGames.forEach((game) => {
      const key = stageLabel(game);
      grouped.set(key, [...(grouped.get(key) ?? []), game]);
    });

    return (
      <div className="section-stack">
        {[...grouped.entries()].map(([label, labelGames]) => (
          <section className="day-section compact-day" key={label}>
            <div className="day-heading">{label}</div>
            <div className="match-grid compact-grid">
              {labelGames.map((game) => <MatchCard game={game} teams={teams} stadiums={stadiums} players={players} key={game.id} />)}
            </div>
          </section>
        ))}

        {olderGames.length ? (
          <section className="day-section compact-day">
            <div className="day-heading">Aikaisemmat ottelut</div>
            <div className="match-grid compact-grid">
              {olderGames.map((game) => <MatchCard game={game} teams={teams} stadiums={stadiums} players={players} key={game.id} />)}
            </div>
          </section>
        ) : null}
      </div>
    );
  }

  const groupedByDate = new Map<string, ApiGame[]>();
  recentGames.forEach((game) => {
    const key = dateLabel(game);
    groupedByDate.set(key, [...(groupedByDate.get(key) ?? []), game]);
  });

  return (
    <div className="section-stack">
      {[...groupedByDate.entries()].map(([label, labelGames]) => (
        <section className="day-section compact-day" key={label}>
          <div className="day-heading">{label}</div>
          <div className="match-grid compact-grid">
            {labelGames.map((game) => <MatchCard game={game} teams={teams} stadiums={stadiums} players={players} key={game.id} />)}
          </div>
        </section>
      ))}

      {olderGames.length ? (
        <section className="day-section compact-day">
          <div className="day-heading">Aikaisemmat ottelut</div>
          <div className="match-grid compact-grid">
            {olderGames.map((game) => <MatchCard game={game} teams={teams} stadiums={stadiums} players={players} key={game.id} />)}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function PredictionEditor({
  current,
  games,
  players,
  setPlayers,
}: {
  current?: PlayerName;
  games: ApiGame[];
  players: PlayerState[];
  setPlayers: (players: PlayerState[]) => void;
}) {
  const player = players.find((item) => item.name === current);
  if (!player) return <p className="subtle-note">Kirjaudu sisään, niin voit syöttää tulevien otteluiden veikkaukset.</p>;
  return <PredictionEditorFields key={`${player.name}-${player.predictions.length}`} player={player} games={games} players={players} setPlayers={setPlayers} />;
}

function PredictionEditorFields({
  player,
  games,
  players,
  setPlayers,
}: {
  player: PlayerState;
  games: ApiGame[];
  players: PlayerState[];
  setPlayers: (players: PlayerState[]) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, { home: string; away: string }>>(() => {
    const next: Record<string, { home: string; away: string }> = {};
    player.predictions.forEach((prediction) => {
      next[prediction.matchId] = { home: String(prediction.home), away: String(prediction.away) };
    });
    return next;
  });

  const openGames = currentFirst(games.filter((game) => {
    const prediction = player.predictions.find((item) => item.matchId === game.id);
    return !prediction?.locked && !predictionLocked(game);
  }));

  async function savePrediction(game: ApiGame) {
    const draft = drafts[game.id] ?? { home: "", away: "" };
    const home = Number.parseInt(draft.home, 10);
    const away = Number.parseInt(draft.away, 10);
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
  }

  return (
    <div className="prediction-editor">
      {openGames.length ? openGames.map((game) => {
        const home = normalizeTeam(teamName(game, "home"));
        const away = normalizeTeam(teamName(game, "away"));
        const draft = drafts[game.id] ?? { home: "", away: "" };
        return (
          <div className="editable-prediction" key={game.id}>
            <div>
              <strong>{home} - {away}</strong>
              <div className="muted small">Sulkeutuu 1 min ennen aloitusta · {finnishKickoff(game)}</div>
            </div>
            <div className="editable-score">
              <input inputMode="numeric" value={draft.home} onChange={(event) => setDrafts((state) => ({ ...state, [game.id]: { ...draft, home: event.target.value } }))} />
              <span>:</span>
              <input inputMode="numeric" value={draft.away} onChange={(event) => setDrafts((state) => ({ ...state, [game.id]: { ...draft, away: event.target.value } }))} />
              <button className="ghost-btn compact" onClick={() => savePrediction(game)}>Tallenna</button>
            </div>
          </div>
        );
      }) : <p className="subtle-note">Tällä hetkellä ei ole avoimia otteluveikkauksia.</p>}
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

  async function saveBonus() {
    const next = players.map((item) => (item.name === player.name ? { ...item, bonus: draft } : item));
    setPlayers(next);
    saveLocal(next);
    if (firebaseEnabled && db) await setDoc(doc(db, "players", player.name), { ...player, bonus: draft }, { merge: true });
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
  const [matchViewMode, setMatchViewMode] = useState<MatchViewMode>("date");
  const [groupFilter, setGroupFilter] = useState("all");
  const [user, setUser] = useState<User | null>(null);
  const [syncState, setSyncState] = useState<WorldCupState["source"]>(cached?.source ?? "fallback");

  const currentName = allowedName(firstName(user));
  const denied = Boolean(user && !currentName);
  const availableFilters = useMemo(() => {
    const groups = [...new Set(games.filter((game) => game.type === "group").map((game) => game.group))].sort((a, b) => a.localeCompare(b));
    const rounds = ["r32", "r16", "qf", "sf", "third", "final"].filter((round) => games.some((game) => game.type === round));
    return ["all", ...groups, ...rounds];
  }, [games]);

  async function loadCup() {
    try {
      const data = await fetchWorldCup();
      setGames(data.games);
      setTeams(data.teams);
      setStadiums(data.stadiums);
      setSyncState(data.source);
      saveCachedWorldCup(data);
    } catch {
      const cachedData = loadCachedWorldCup();
      if (cachedData?.games?.length) {
        setGames(cachedData.games);
        setTeams(cachedData.teams);
        setStadiums(cachedData.stadiums ?? FALLBACK_STADIUMS);
        setSyncState("cache");
        return;
      }
      setGames(FALLBACK_GAMES);
      setTeams(FALLBACK_TEAMS);
      setStadiums(FALLBACK_STADIUMS);
      setSyncState("fallback");
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

      <header className="hero">
        <div className="hero-copy-wrap">
          <div className="eyebrow">Vetoliigan kisaveikkaus 2026</div>
          <h1>Kisataulu</h1>
          <p className="hero-copy">Livetulokset, veikkaukset, bonusrivit ja maalikuningastilanne samassa näkymässä.</p>
        </div>
      </header>

      <nav className="primary-nav">
        <button className={clsx("nav-link", { active: mainView === "matches" })} onClick={() => setMainView("matches")}>Ottelut</button>
        <button className={clsx("nav-link", { active: mainView === "tables" })} onClick={() => setMainView("tables")}>Taulukot</button>
      </nav>

      <div className="layout">
        <section className="main-stage">
          {mainView === "matches" ? (
            <>
              <div className="view-toolbar">
                <div className="toolbar-group">
                  <label className="toolbar-label" htmlFor="view-mode">Näkymä</label>
                  <select id="view-mode" className="toolbar-select" value={matchViewMode} onChange={(event) => setMatchViewMode(event.target.value as MatchViewMode)}>
                    <option value="date">Päivä</option>
                    <option value="group">Lohko</option>
                  </select>
                </div>

                {matchViewMode === "group" ? (
                  <div className="toolbar-group">
                    <label className="toolbar-label" htmlFor="group-filter">Valinta</label>
                    <select id="group-filter" className="toolbar-select" value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
                      {availableFilters.map((item) => (
                        <option key={item} value={item}>{item === "all" ? "Kaikki" : stageLabel({ type: item as ApiGame["type"], group: item } as ApiGame)}</option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <button className="icon-btn" title="Päivitä nyt" onClick={loadCup}><RotateCcw size={18} /></button>
              </div>

              <MatchSections
                games={games}
                teams={teams}
                stadiums={stadiums}
                players={players}
                mode={matchViewMode}
                groupFilter={groupFilter}
              />
            </>
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
                <div className="rule-item"><span className="badge">1</span><div><strong>Tasapeli oikein, väärät maalit</strong><span className="muted">Esim. 1-1 ja peli päättyy 2-2.</span></div></div>
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
          <section className="side-card auth-card">
            <div className="auth-row">
              <div className="user-pill">
                <span className="avatar">{(currentName ?? "?").slice(0, 1)}</span>
                <div>
                  <strong>{currentName ?? "Vierailija"}</strong>
                  <div className="subtle-note">Google-kirjautuminen käytössä</div>
                </div>
              </div>
              {currentName ? (
                <button className="icon-btn" title="Kirjaudu ulos" onClick={signOutUser}><LogOut size={18} /></button>
              ) : (
                <button className="primary-btn" onClick={signIn}><LogIn size={16} /> Kirjaudu</button>
              )}
            </div>

            <div className="sync-pill">
              <span className={clsx("sync-dot", syncState)} />
              {syncState === "direct" || syncState === "proxy" ? "Tulokset päivittyvät automaattisesti" : "Näytetään viimeisin saatavilla oleva data"}
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
              const pickers = players.filter((player) => player.bonus.topScorer.toLowerCase() === scorer.name.toLowerCase()).map((player) => player.name);
              return (
                <div className="scorer-row" key={scorer.name}>
                  <span className="rank">{index + 1}</span>
                  <span className="scorer-name">{scorer.name}{pickers.length ? <span className="muted small"> / {pickers.join(", ")}</span> : null}</span>
                  <span className="points">{scorer.goals}</span>
                </div>
              );
            }) : <p className="subtle-note">Maalintekijätaulu täyttyy heti kun dataa tulee.</p>}
          </section>

          <section className="side-card">
            <div className="section-title"><h2>Avoimet otteluveikkaukset</h2></div>
            <PredictionEditor current={currentName} games={games} players={players} setPlayers={setPlayers} />
          </section>

          <section className="side-card">
            <div className="section-title"><h2>Omat bonukset</h2></div>
            <BonusEditor current={currentName} players={players} setPlayers={setPlayers} />
          </section>

          <section className="side-card">
            <div className="section-title"><h2>Bonus per käyttäjä</h2></div>
            {players.map((player) => (
              <div className="bonus-row" key={player.name}>
                <strong>{player.name}</strong>
                <span className="muted small">{[player.bonus.champion, player.bonus.topScorer, player.bonus.surprise, player.bonus.flop].filter(Boolean).join(" / ") || "Ei vielä valintoja"}</span>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </main>
  );
}
