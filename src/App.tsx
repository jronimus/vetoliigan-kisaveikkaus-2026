import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { LogIn, LogOut, RotateCcw, Trophy } from "lucide-react";
import clsx from "clsx";
import { auth, db, firebaseEnabled, provider } from "./firebase";
import { LOCK_DATE_LABEL, PLAYERS, SEEDED_PLAYERS, TEAM_FI, type BonusPicks, type PlayerName, type PlayerState, type Prediction } from "./data";
import { describeMatch, matchPoints, standings } from "./scoring";
import {
  FALLBACK_GAMES,
  FALLBACK_GROUPS,
  FALLBACK_TEAMS,
  fetchWorldCup,
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
  type ApiGroup,
  type ApiTeam,
  type WorldCupState,
} from "./worldcup";

function firstName(user: User | null) {
  const raw = user?.displayName || user?.email?.split("@")[0] || "";
  return raw.split(/\s|\.|-/)[0];
}

function allowedName(name: string): PlayerName | undefined {
  return PLAYERS.find((player) => player.toLowerCase() === name.toLowerCase());
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

function teamByName(teams: ApiTeam[], name: string) {
  return teams.find((team) => team.name_en === name);
}

function teamById(teams: ApiTeam[], id: string) {
  return teams.find((team) => team.id === id);
}

function statusLabel(game: ApiGame) {
  if (isFinished(game)) return "Päättynyt";
  if (isLive(game)) return "Livenä";
  return "Tulossa";
}

function featuredMatches(games: ApiGame[]) {
  const scoreGames = games.filter((game) => isLive(game) || isFinished(game) || game.id === "1" || game.id === "2");
  const rest = games.filter((game) => !scoreGames.includes(game));
  return [...scoreGames, ...rest];
}

function filterLabel(value: string) {
  if (value === "all") return "Kaikki";
  if (value === "r32") return "32 parasta";
  if (value === "r16") return "16 parasta";
  if (value === "qf") return "Puolivälierät";
  if (value === "sf") return "Välierät";
  if (value === "final") return "Finaali";
  return `Lohko ${value}`;
}

function MatchCard({
  game,
  teams,
  players,
  featured,
}: {
  game: ApiGame;
  teams: ApiTeam[];
  players: PlayerState[];
  featured?: boolean;
}) {
  const home = teamName(game, "home");
  const away = teamName(game, "away");
  const homeTeam = teamByName(teams, home);
  const awayTeam = teamByName(teams, away);
  const homeScorers = parseScorers(game.home_scorers);
  const awayScorers = parseScorers(game.away_scorers);
  const predictions = players.filter((player) => player.predictions.some((item) => item.matchId === game.id));

  return (
    <article className={clsx("match-card", { featured })}>
      <div className="match-shadow red" />
      <div className="match-shadow blue" />
      <div className="match-shadow green" />

      <div className="match-badges">
        <span className={clsx("match-status", { live: isLive(game), finished: isFinished(game) })}>{statusLabel(game)}</span>
        <span className="group-tag">Lohko {game.group}</span>
      </div>

      <div className="date-ribbon">{finnishKickoff(game)}</div>

      <div className="match-stage">
        <div className="match-body">
          <div className="team-crest-block">
            {homeTeam?.flag ? <img className="hero-flag" src={homeTeam.flag} alt="" /> : null}
            <span className="team-label">{normalizeTeam(home)}</span>
          </div>

          <div className="hero-score">
            <span>{parseScore(game.home_score)}</span>
            <span className="colon">:</span>
            <span>{parseScore(game.away_score)}</span>
          </div>

          <div className="team-crest-block">
            {awayTeam?.flag ? <img className="hero-flag" src={awayTeam.flag} alt="" /> : null}
            <span className="team-label">{normalizeTeam(away)}</span>
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
        {predictions.length ? (
          predictions.map((player) => {
            const prediction = player.predictions.find((item) => item.matchId === game.id);
            if (!prediction) return null;
            return (
              <div className="prediction-row" key={player.name}>
                <strong>{player.name}</strong>
                <span className="prediction-score">{prediction.home}-{prediction.away}</span>
                <span className="points">{matchPoints(prediction, game)} p</span>
              </div>
            );
          })
        ) : (
          <div className="prediction-row empty">
            <strong>Veikkaukset</strong>
            <span className="muted small">Auki vielä</span>
          </div>
        )}
      </div>
    </article>
  );
}

function BonusEditor({ current, players, setPlayers }: { current?: PlayerName; players: PlayerState[]; setPlayers: (players: PlayerState[]) => void }) {
  const player = players.find((item) => item.name === current);

  if (!player) return <p className="subtle-note">Kirjaudu omalla Google-tilillä, niin voit täydentää bonusveikkaukset.</p>;

  return (
    <BonusEditorFields
      key={`${player.name}-${player.bonus.champion}-${player.bonus.topScorer}-${player.bonus.surprise}-${player.bonus.flop}`}
      player={player}
      players={players}
      setPlayers={setPlayers}
    />
  );
}

function BonusEditorFields({ player, players, setPlayers }: { player: PlayerState; players: PlayerState[]; setPlayers: (players: PlayerState[]) => void }) {
  const [draft, setDraft] = useState<BonusPicks>(player.bonus);

  async function saveBonus() {
    const next = players.map((item) => (item.name === player.name ? { ...item, bonus: draft } : item));
    setPlayers(next);
    saveLocal(next);
    if (firebaseEnabled && db) {
      await setDoc(doc(db, "players", player.name), { ...player, bonus: draft }, { merge: true });
    }
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

  if (!player) return <p className="subtle-note">Kirjaudu sisään tai valitse käyttäjä, niin voit syöttää tulevien otteluiden veikkaukset.</p>;

  return (
    <PredictionEditorFields
      key={`${player.name}-${player.predictions.map((prediction) => `${prediction.matchId}:${prediction.home}-${prediction.away}`).join("|")}`}
      player={player}
      games={games}
      players={players}
      setPlayers={setPlayers}
    />
  );
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

  const openGames = games.filter((game) => {
    const prediction = player.predictions.find((item) => item.matchId === game.id);
    return !prediction?.locked && !predictionLocked(game);
  });

  async function savePrediction(game: ApiGame) {
    if (!player) return;
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

    if (firebaseEnabled && db) {
      await setDoc(doc(db, "players", player.name), nextPlayer, { merge: true });
    }
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
              <input
                inputMode="numeric"
                value={draft.home}
                onChange={(event) => setDrafts((currentDrafts) => ({ ...currentDrafts, [game.id]: { ...draft, home: event.target.value } }))}
              />
              <span>:</span>
              <input
                inputMode="numeric"
                value={draft.away}
                onChange={(event) => setDrafts((currentDrafts) => ({ ...currentDrafts, [game.id]: { ...draft, away: event.target.value } }))}
              />
              <button className="ghost-btn compact" onClick={() => savePrediction(game)}>Tallenna</button>
            </div>
          </div>
        );
      }) : <p className="subtle-note">Tällä hetkellä ei ole avoimia otteluveikkauksia. Seuraavat rivit sulkeutuvat automaattisesti minuutti ennen aloitusta.</p>}
    </div>
  );
}

function GroupTables({ groups, teams }: { groups: ApiGroup[]; teams: ApiTeam[] }) {
  const sortedGroups = [...groups].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="group-grid">
      {sortedGroups.map((group) => (
        <section className="group-card" key={group.name}>
          <div className="section-title">
            <h2>Lohko {group.name}</h2>
          </div>
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
            {group.teams.map((row) => {
              const team = teamById(teams, row.team_id);
              const name = normalizeTeam(team?.name_en ?? row.team_id);
              return (
                <div className="group-table-row" key={`${group.name}-${row.team_id}`}>
                  <span className="group-team">
                    {team?.flag ? <img src={team.flag} alt="" className="mini-flag" /> : null}
                    {name}
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
  const [groups, setGroups] = useState<ApiGroup[]>(cached?.groups ?? FALLBACK_GROUPS);
  const [players, setPlayers] = useState<PlayerState[]>(localPlayers);
  const [view, setView] = useState<"matches" | "tables">("matches");
  const [tab, setTab] = useState("all");
  const [user, setUser] = useState<User | null>(null);
  const [demoName, setDemoName] = useState<PlayerName | undefined>();
  const [syncState, setSyncState] = useState<WorldCupState["source"]>(cached?.source ?? "fallback");

  const currentName = allowedName(firstName(user)) ?? demoName;
  const denied = Boolean(user && !currentName);

  async function loadCup() {
    try {
      const data = await fetchWorldCup();
      setGames(data.games);
      setTeams(data.teams);
      setGroups(data.groups);
      setSyncState(data.source);
      saveCachedWorldCup(data);
    } catch {
      const cachedData = loadCachedWorldCup();
      if (cachedData?.games?.length) {
        setGames(cachedData.games);
        setTeams(cachedData.teams);
        setGroups(cachedData.groups ?? FALLBACK_GROUPS);
        setSyncState("cache");
        return;
      }
      setGames(FALLBACK_GAMES);
      setTeams(FALLBACK_TEAMS);
      setGroups(FALLBACK_GROUPS);
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

  const visibleGames = useMemo(() => {
    const sourceGames = featuredMatches(games);
    if (tab === "all") return sourceGames;
    return sourceGames.filter((game) => game.type === tab || game.group === tab);
  }, [games, tab]);

  const table = useMemo(() => standings(players, games), [players, games]);
  const scorers = useMemo(() => scorerTable(games), [games]);
  const matchFilters = useMemo(() => {
    const groupsFromGames = [...new Set(games.filter((game) => game.type === "group").map((game) => game.group))].sort((a, b) => a.localeCompare(b));
    const rounds = ["r32", "r16", "qf", "sf", "final"].filter((round) => games.some((game) => game.type === round));
    return ["all", ...groupsFromGames, ...rounds];
  }, [games]);
  const pickedTopScorers = players.map((player) => player.bonus.topScorer).filter(Boolean);
  const shownScorers = [
    ...scorers.slice(0, 10),
    ...scorers.filter((scorer) => pickedTopScorers.includes(scorer.name) && !scorers.slice(0, 10).some((item) => item.name === scorer.name)),
  ];

  async function signIn() {
    if (firebaseEnabled && auth && provider) await signInWithPopup(auth, provider);
    else setDemoName("Joni");
  }

  async function signOutUser() {
    setDemoName(undefined);
    if (firebaseEnabled && auth) await signOut(auth);
  }

  if (denied) {
    return (
      <main className="app-shell">
        <section className="panel denied">
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

        <div className="auth-card">
          <div className="auth-row">
            <div className="user-pill">
              <span className="avatar">{(currentName ?? "?").slice(0, 1)}</span>
              <div>
                <strong>{currentName ?? "Vierailija"}</strong>
                <div className="subtle-note">{firebaseEnabled ? "Google-kirjautuminen käytössä" : "Paikallinen tila tällä laitteella"}</div>
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

          {!firebaseEnabled ? (
            <div className="tabs auth-tabs">
              {PLAYERS.map((name) => (
                <button className={clsx("tab", { active: demoName === name })} key={name} onClick={() => setDemoName(name)}>
                  {name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      <div className="layout">
        <section className="main-stage">
          <div className="board-head">
            <div className="section-title">
              <h2>{view === "matches" ? "Ottelut" : "Lohkotaulukot"}</h2>
            </div>
            <div className="board-controls">
              <div className="tabs">
                <button className={clsx("tab", { active: view === "matches" })} onClick={() => setView("matches")}>Ottelut</button>
                <button className={clsx("tab", { active: view === "tables" })} onClick={() => setView("tables")}>Taulukot</button>
                {view === "matches" ? matchFilters.map((item) => (
                  <button className={clsx("tab", { active: tab === item })} key={item} onClick={() => setTab(item)}>
                    {filterLabel(item)}
                  </button>
                )) : null}
              </div>
              <button className="icon-btn" title="Päivitä nyt" onClick={loadCup}><RotateCcw size={18} /></button>
            </div>
          </div>

          {view === "matches" ? (
            <div className="match-grid">
              {visibleGames.map((game, index) => (
                <MatchCard game={game} teams={teams} players={players} featured={index < 2} key={game.id} />
              ))}
            </div>
          ) : (
            <GroupTables groups={groups} teams={teams} />
          )}

          <section className="rules-grid">
            <div className="panel rules-panel">
              <div className="section-title"><h2>Pisteytys</h2></div>
              <div className="rule-list">
                <div className="rule-item"><span className="badge">5</span><div><strong>Täysin oikea tulos</strong><span className="muted">Esim. 2-1 ja peli päättyy 2-1.</span></div></div>
                <div className="rule-item"><span className="badge">3</span><div><strong>Oikea maaliero ja merkki</strong><span className="muted">Esim. 3-1 ja peli päättyy 2-0.</span></div></div>
                <div className="rule-item"><span className="badge">2</span><div><strong>Oikea merkki, väärä maaliero</strong><span className="muted">Esim. 1-0 ja peli päättyy 3-1.</span></div></div>
                <div className="rule-item"><span className="badge">1</span><div><strong>Tasapeli oikein, väärät maalit</strong><span className="muted">Esim. 1-1 ja peli päättyy 2-2.</span></div></div>
              </div>
            </div>

            <div className="panel rules-panel">
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
            <div className="section-title"><h2>Bonus per käyttäjä</h2></div>
            {players.map((player) => (
              <div className="bonus-row" key={player.name}>
                <strong>{player.name}</strong>
                <span className="muted small">{[player.bonus.champion, player.bonus.topScorer, player.bonus.surprise, player.bonus.flop].filter(Boolean).join(" / ") || "Ei vielä valintoja"}</span>
              </div>
            ))}
          </section>

          <section className="side-card">
            <div className="section-title"><h2>Avoimet otteluveikkaukset</h2></div>
            <PredictionEditor key={currentName ?? "guest-preds"} current={currentName} games={games} players={players} setPlayers={setPlayers} />
          </section>

          <section className="side-card">
            <div className="section-title"><h2>Omat bonukset</h2></div>
            <BonusEditor key={currentName ?? "guest-bonus"} current={currentName} players={players} setPlayers={setPlayers} />
          </section>

          <section className="side-card">
            <div className="section-title"><h2>Sulkeutuneet ottelut</h2></div>
            {games.filter((game) => players.some((player) => player.predictions.some((prediction) => prediction.matchId === game.id && (prediction.locked || predictionLocked(game))))).map((game) => (
              <div className="bonus-row" key={game.id}>
                <strong>{describeMatch(game).split(" - ").map(normalizeTeam).join(" - ")}</strong>
                <span className="muted small">{isFinished(game) ? "Pisteytetty" : "Rivi suljettu"}</span>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </main>
  );
}
