import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { LogIn, LogOut, RotateCcw, Trophy } from "lucide-react";
import clsx from "clsx";
import { auth, db, firebaseEnabled, provider } from "./firebase";
import { LOCK_DATE_LABEL, PLAYERS, SEEDED_PLAYERS, TEAM_FI, type BonusPicks, type PlayerName, type PlayerState } from "./data";
import { describeMatch, matchPoints, standings } from "./scoring";
import {
  FALLBACK_GAMES,
  FALLBACK_TEAMS,
  fetchWorldCup,
  finnishKickoff,
  isFinished,
  isLive,
  loadCachedWorldCup,
  parseScore,
  parseScorers,
  saveCachedWorldCup,
  scorerTable,
  teamName,
  type ApiGame,
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

function flagFor(teams: ApiTeam[], name: string) {
  return teams.find((team) => team.name_en === name)?.flag;
}

function fifaCodeFor(teams: ApiTeam[], name: string) {
  return teams.find((team) => team.name_en === name)?.fifa_code ?? name.slice(0, 3).toUpperCase();
}

function statusLabel(game: ApiGame) {
  if (isFinished(game)) return "FULL-TIME";
  if (isLive(game)) return "LIVE";
  return "UPCOMING";
}

function featuredMatches(games: ApiGame[]) {
  const scoreGames = games.filter((game) => isLive(game) || isFinished(game) || game.id === "1" || game.id === "2");
  const rest = games.filter((game) => !scoreGames.includes(game));
  return [...scoreGames, ...rest];
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
        <span className="group-tag">Group {game.group}</span>
      </div>

      <div className="score-ribbon">
        <div className="ribbon-side">
          {flagFor(teams, home) ? <img className="flag-tab" src={flagFor(teams, home)} alt="" /> : null}
          <span>{fifaCodeFor(teams, home)}</span>
        </div>
        <div className="ribbon-side away">
          <span>{fifaCodeFor(teams, away)}</span>
          {flagFor(teams, away) ? <img className="flag-tab" src={flagFor(teams, away)} alt="" /> : null}
        </div>
      </div>

      <div className="match-stage">
        <div className="score-pill">{finnishKickoff(game).replace("klo ", "")}</div>
        <div className="match-body">
          <div className="team-crest-block">
            {flagFor(teams, home) ? <img className="hero-flag" src={flagFor(teams, home)} alt="" /> : null}
            <span className="team-label">{normalizeTeam(home)}</span>
          </div>
          <div className="hero-score">
            <span>{parseScore(game.home_score)}</span>
            <span className="colon">:</span>
            <span>{parseScore(game.away_score)}</span>
          </div>
          <div className="team-crest-block">
            {flagFor(teams, away) ? <img className="hero-flag" src={flagFor(teams, away)} alt="" /> : null}
            <span className="team-label">{normalizeTeam(away)}</span>
          </div>
        </div>
      </div>

      <div className="scorer-strip">
        <div>
          <strong>{homeScorers.length ? homeScorers.join(", ") : "Ei maalintekijoita"}</strong>
          <span>{home}</span>
        </div>
        <div>
          <strong>{awayScorers.length ? awayScorers.join(", ") : "Ei maalintekijoita"}</strong>
          <span>{away}</span>
        </div>
      </div>

      <div className="prediction-list">
        {predictions.map((player) => {
          const prediction = player.predictions.find((item) => item.matchId === game.id);
          if (!prediction) return null;
          return (
            <div className="prediction-row" key={player.name}>
              <strong>{player.name}</strong>
              <span className="prediction-score">{prediction.home}-{prediction.away}</span>
              <span className="points">{matchPoints(prediction, game)} p</span>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function BonusEditor({ current, players, setPlayers }: { current?: PlayerName; players: PlayerState[]; setPlayers: (players: PlayerState[]) => void }) {
  const player = players.find((item) => item.name === current);
  const [draft, setDraft] = useState<BonusPicks>(player?.bonus ?? { champion: "", topScorer: "", surprise: "", flop: "" });

  async function saveBonus() {
    if (!player) return;
    const next = players.map((item) => (item.name === player.name ? { ...item, bonus: draft } : item));
    setPlayers(next);
    saveLocal(next);
    if (firebaseEnabled && db) {
      await setDoc(doc(db, "players", player.name), { ...player, bonus: draft }, { merge: true });
    }
  }

  if (!player) return <p className="subtle-note">Kirjaudu omalla Google-tililla, niin voit taydentaa bonusveikkaukset.</p>;

  return (
    <div className="bonus-form">
      <label>Maailmanmestari<input value={draft.champion} onChange={(event) => setDraft({ ...draft, champion: event.target.value })} /></label>
      <label>Maalikuningas<input value={draft.topScorer} onChange={(event) => setDraft({ ...draft, topScorer: event.target.value })} /></label>
      <label>Yllattaja<input value={draft.surprise} onChange={(event) => setDraft({ ...draft, surprise: event.target.value })} /></label>
      <label>Floppi<input value={draft.flop} onChange={(event) => setDraft({ ...draft, flop: event.target.value })} /></label>
      <button className="primary-btn" onClick={saveBonus}>Tallenna bonusveikkaukset</button>
      <p className="subtle-note">Ottelutulosveikkaukset pysyvat lukittuina valmiiksi syotettyina.</p>
    </div>
  );
}

export default function App() {
  const cached = loadCachedWorldCup();
  const [games, setGames] = useState<ApiGame[]>(cached?.games ?? FALLBACK_GAMES);
  const [teams, setTeams] = useState<ApiTeam[]>(cached?.teams ?? FALLBACK_TEAMS);
  const [players, setPlayers] = useState<PlayerState[]>(localPlayers);
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
      setSyncState(data.source);
      saveCachedWorldCup(data);
    } catch {
      const cachedData = loadCachedWorldCup();
      if (cachedData?.games?.length) {
        setGames(cachedData.games);
        setTeams(cachedData.teams);
        setSyncState("cache");
        return;
      }
      setGames(FALLBACK_GAMES);
      setTeams(FALLBACK_TEAMS);
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
          <h1>Ei paasylistalla</h1>
          <p className="hero-copy">Tama liiga on rajattu nimille Santeri, Sami, Ilpo ja Joni. Google-tilin etunimen taytyy olla yksi naista.</p>
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
          <h1>World Cup Board</h1>
          <p className="hero-copy">Livetulokset, lukitut otteluveikkaukset, bonusrivit ja maalikuningaskisa samalla kisagraafisella taululla.</p>
        </div>

        <div className="auth-card">
          <div className="auth-row">
            <div className="user-pill">
              <span className="avatar">{(currentName ?? "?").slice(0, 1)}</span>
              <div>
                <strong>{currentName ?? "Vierailija"}</strong>
                <div className="subtle-note">{firebaseEnabled ? "Google-kirjautuminen aktiivinen" : "Demo-tila ilman Firebasea"}</div>
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
            {syncState === "direct" || syncState === "proxy" ? "Tulostaulu synkassa" : "Naytetaan viimeisin saatavilla oleva data"}
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
              <h2>Ottelut</h2>
              <p className="subtle-note">Paivitys taustalla ilman vilkkumista. Voi painaa kasin uudestaan jos haluat pakottaa uuden haun.</p>
            </div>
            <div className="board-controls">
              <div className="tabs">
                {["all", "A", "B", "C", "D", "r32", "r16", "qf", "sf", "final"].map((item) => (
                  <button className={clsx("tab", { active: tab === item })} key={item} onClick={() => setTab(item)}>
                    {item === "all" ? "Kaikki" : item.toUpperCase()}
                  </button>
                ))}
              </div>
              <button className="icon-btn" title="Paivita nyt" onClick={loadCup}><RotateCcw size={18} /></button>
            </div>
          </div>

          <div className="match-grid">
            {visibleGames.map((game, index) => (
              <MatchCard game={game} teams={teams} players={players} featured={index < 2} key={game.id} />
            ))}
          </div>

          <section className="rules-grid">
            <div className="panel rules-panel">
              <div className="section-title"><h2>Pisteytys</h2></div>
              <div className="rule-list">
                <div className="rule-item"><span className="badge">5</span><div><strong>Taysin oikea tulos</strong><span className="muted">Esim. 2-1 ja peli paattyy 2-1.</span></div></div>
                <div className="rule-item"><span className="badge">3</span><div><strong>Oikea maaliero ja merkki</strong><span className="muted">Esim. 3-1 ja peli paattyy 2-0.</span></div></div>
                <div className="rule-item"><span className="badge">2</span><div><strong>Oikea merkki, vaara maaliero</strong><span className="muted">Esim. 1-0 ja peli paattyy 3-1.</span></div></div>
                <div className="rule-item"><span className="badge">1</span><div><strong>Tasapeli oikein, vaarat maalit</strong><span className="muted">Esim. 1-1 ja peli paattyy 2-2.</span></div></div>
              </div>
            </div>

            <div className="panel rules-panel">
              <div className="section-title"><h2>Bonusveikkaukset</h2></div>
              <div className="bonus-timing">Lukitaan: {LOCK_DATE_LABEL}</div>
              <div className="rule-list">
                <div className="rule-item"><span className="badge hot">20</span><div><strong>Oikea maailmanmestari</strong></div></div>
                <div className="rule-item"><span className="badge">10</span><div><strong>Turnauksen maalikuningas</strong></div></div>
                <div className="rule-item"><span className="badge">10</span><div><strong>Kisojen yllattaja</strong></div></div>
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
            <div className="section-title"><h2>Maalintekijat</h2></div>
            {shownScorers.length ? shownScorers.map((scorer, index) => {
              const pickers = players.filter((player) => player.bonus.topScorer.toLowerCase() === scorer.name.toLowerCase()).map((player) => player.name);
              return (
                <div className="scorer-row" key={scorer.name}>
                  <span className="rank">{index + 1}</span>
                  <span className="scorer-name">{scorer.name}{pickers.length ? <span className="muted small"> / {pickers.join(", ")}</span> : null}</span>
                  <span className="points">{scorer.goals}</span>
                </div>
              );
            }) : <p className="subtle-note">Maalintekijataulu tayttyy heti kun dataa tulee.</p>}
          </section>

          <section className="side-card">
            <div className="section-title"><h2>Bonus per kayttaja</h2></div>
            {players.map((player) => (
              <div className="bonus-row" key={player.name}>
                <strong>{player.name}</strong>
                <span className="muted small">{[player.bonus.champion, player.bonus.topScorer, player.bonus.surprise, player.bonus.flop].filter(Boolean).join(" / ") || "Ei viela valintoja"}</span>
              </div>
            ))}
          </section>

          <section className="side-card">
            <div className="section-title"><h2>Omat bonukset</h2></div>
            <BonusEditor key={currentName ?? "guest"} current={currentName} players={players} setPlayers={setPlayers} />
          </section>

          <section className="side-card">
            <div className="section-title"><h2>Lukitut rivit</h2></div>
            {games.filter((game) => players.some((player) => player.predictions.some((prediction) => prediction.matchId === game.id))).map((game) => (
              <div className="bonus-row" key={game.id}>
                <strong>{describeMatch(game).split(" - ").map(normalizeTeam).join(" - ")}</strong>
                <span className="muted small">{isFinished(game) ? "Pisteytetty" : "Odottaa lopputulosta"}</span>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </main>
  );
}
