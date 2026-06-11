import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { LogIn, LogOut, RefreshCw, Trophy } from "lucide-react";
import clsx from "clsx";
import { auth, db, firebaseEnabled, provider } from "./firebase";
import { LOCK_DATE_LABEL, PLAYERS, SEEDED_PLAYERS, TEAM_FI, type BonusPicks, type PlayerName, type PlayerState } from "./data";
import { describeMatch, matchPoints, standings } from "./scoring";
import { FALLBACK_GAMES, FALLBACK_TEAMS, fetchWorldCup, finnishKickoff, isFinished, isLive, parseScore, parseScorers, scorerTable, teamName, type ApiGame, type ApiTeam } from "./worldcup";

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

function statusLabel(game: ApiGame) {
  if (isFinished(game)) return "Paattynyt";
  if (isLive(game)) return "Live";
  return "Tulossa";
}

function MatchCard({ game, teams, players }: { game: ApiGame; teams: ApiTeam[]; players: PlayerState[] }) {
  const home = teamName(game, "home");
  const away = teamName(game, "away");
  const homeScorers = parseScorers(game.home_scorers);
  const awayScorers = parseScorers(game.away_scorers);

  return (
    <article className="match-card">
      <div className="match-meta">
        <span>{game.type.toUpperCase()} / lohko {game.group} / {finnishKickoff(game)} Suomen aikaa</span>
        <span className={clsx("status", { live: isLive(game) })}>{statusLabel(game)}</span>
      </div>
      <div className="scoreline">
        <div className="team">
          {flagFor(teams, home) ? <img src={flagFor(teams, home)} alt="" /> : null}
          <span className="team-name">{normalizeTeam(home)}</span>
        </div>
        <div className="score">{parseScore(game.home_score)}-{parseScore(game.away_score)}</div>
        <div className="team away">
          <span className="team-name">{normalizeTeam(away)}</span>
          {flagFor(teams, away) ? <img src={flagFor(teams, away)} alt="" /> : null}
        </div>
      </div>
      <div className="scorers">
        {[...homeScorers, ...awayScorers].length ? [...homeScorers, ...awayScorers].join(", ") : "Maalintekijat paivittyvat rajapinnasta."}
      </div>
      <div className="prediction-list">
        {players.map((player) => {
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

  if (!player) return <p className="muted">Kirjaudu omalla Google-tililla, niin voit taydentaa bonusveikkaukset.</p>;

  return (
    <div className="bonus-form">
      <label>Maailmanmestari<input value={draft.champion} onChange={(event) => setDraft({ ...draft, champion: event.target.value })} /></label>
      <label>Maalikuningas<input value={draft.topScorer} onChange={(event) => setDraft({ ...draft, topScorer: event.target.value })} /></label>
      <label>Yllattaja<input value={draft.surprise} onChange={(event) => setDraft({ ...draft, surprise: event.target.value })} /></label>
      <label>Floppi<input value={draft.flop} onChange={(event) => setDraft({ ...draft, flop: event.target.value })} /></label>
      <button className="primary-btn" onClick={saveBonus}>Tallenna bonusveikkaukset</button>
      <p className="muted small">Ottelutulosveikkaukset on lukittu seedatyn datan mukaisesti.</p>
    </div>
  );
}

export default function App() {
  const [games, setGames] = useState<ApiGame[]>([]);
  const [teams, setTeams] = useState<ApiTeam[]>([]);
  const [players, setPlayers] = useState<PlayerState[]>(localPlayers);
  const [tab, setTab] = useState("all");
  const [user, setUser] = useState<User | null>(null);
  const [demoName, setDemoName] = useState<PlayerName | undefined>();
  const [lastUpdated, setLastUpdated] = useState<Date>();
  const [error, setError] = useState<string>();

  const currentName = allowedName(firstName(user)) ?? demoName;
  const denied = Boolean(user && !currentName);

  async function loadCup() {
    try {
      setError(undefined);
      const data = await fetchWorldCup();
      setGames(data.games);
      setTeams(data.teams);
      setLastUpdated(data.lastUpdated);
    } catch (err) {
      setGames(FALLBACK_GAMES);
      setTeams(FALLBACK_TEAMS);
      setLastUpdated(new Date());
      setError(`${err instanceof Error ? err.message : "Tuntematon virhe."} Naytetaan selaimen fallback-dataa. Live-paivitykset vaativat CORS-proxyn.`);
    }
  }

  useEffect(() => {
    window.setTimeout(loadCup, 0);
    const id = window.setInterval(loadCup, 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!firebaseEnabled || !auth) return;
    return onAuthStateChanged(auth, setUser);
  }, []);

  useEffect(() => {
    if (!firebaseEnabled || !db || !currentName) return;
    Promise.all(
      SEEDED_PLAYERS.map(async (seed) => {
        const ref = doc(db!, "players", seed.name);
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
    if (tab === "all") return games;
    return games.filter((game) => game.type === tab || game.group === tab);
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
      <header className="hero">
        <div>
          <div className="eyebrow">Vetoliigan kisaveikkaus 2026</div>
          <h1>MM-kisaveikkaus</h1>
          <p className="hero-copy">Neljan hengen nopea kisastudio: live-tulokset, lukitut veikkaukset, pisteet, maalintekijatilasto ja bonusrivit samassa nakymassa.</p>
        </div>
        <div className="auth-card">
          <div className="auth-row">
            <div className="user-pill">
              <span className="avatar">{(currentName ?? "?").slice(0, 1)}</span>
              <div>
                <strong>{currentName ?? "Vierailija"}</strong>
                <div className="muted small">{firebaseEnabled ? "Google + Firebase" : "Demo-tila ilman Firebasea"}</div>
              </div>
            </div>
            {currentName ? (
              <button className="icon-btn" title="Kirjaudu ulos" onClick={signOutUser}><LogOut size={18} /></button>
            ) : (
              <button className="primary-btn" onClick={signIn}><LogIn size={16} /> Kirjaudu</button>
            )}
          </div>
          {!firebaseEnabled ? (
            <div className="tabs" style={{ marginTop: 14 }}>
              {PLAYERS.map((name) => <button className={clsx("tab", { active: demoName === name })} key={name} onClick={() => setDemoName(name)}>{name}</button>)}
            </div>
          ) : null}
        </div>
      </header>

      <div className="layout">
        <div className="main-stack">
          <section className="panel">
            <div className="section-title">
              <h2>Ottelut</h2>
              <div className="toolbar">
                <span className="status">{lastUpdated ? `Paivitetty ${lastUpdated.toLocaleTimeString("fi-FI")}` : "Ladataan"}</span>
                <button className="icon-btn" title="Paivita" onClick={loadCup}><RefreshCw size={18} /></button>
              </div>
            </div>
            {error ? <div className="warning">{error}</div> : null}
            <div className="tabs">
              {["all", "A", "B", "C", "D", "r32", "r16", "qf", "sf", "final"].map((item) => (
                <button className={clsx("tab", { active: tab === item })} key={item} onClick={() => setTab(item)}>{item === "all" ? "Kaikki" : item.toUpperCase()}</button>
              ))}
            </div>
          </section>

          <div className="match-grid">
            {visibleGames.map((game) => <MatchCard game={game} teams={teams} players={players} key={game.id} />)}
          </div>

          <section className="rules-grid">
            <div className="panel">
              <div className="section-title"><h2>Yksittaiset ottelut</h2></div>
              <p className="muted">Pisteita saa per peli maksimissaan 5. Pisteet eivat kumuloidu, vaan saat korkeimman osuvan kategorian pisteet.</p>
              <div className="rule-list">
                <div className="rule-item"><span className="badge">5</span><div><strong>Taysin oikea tulos</strong><span className="muted">Esim. 2-1 ja peli paattyy 2-1.</span></div></div>
                <div className="rule-item"><span className="badge">3</span><div><strong>Oikea maaliero ja merkki</strong><span className="muted">Esim. 3-1 ja peli paattyy 2-0.</span></div></div>
                <div className="rule-item"><span className="badge">2</span><div><strong>Oikea merkki, vaara maaliero</strong><span className="muted">Esim. 1-0 ja peli paattyy 3-1.</span></div></div>
                <div className="rule-item"><span className="badge">1</span><div><strong>Tasapeli oikein, vaarat maalit</strong><span className="muted">Esim. 1-1 ja peli paattyy 2-2.</span></div></div>
              </div>
            </div>
            <div className="panel">
              <div className="section-title"><h2>Bonusveikkaukset</h2></div>
              <p className="eyebrow">Lukitaan: {LOCK_DATE_LABEL}</p>
              <div className="rule-list">
                <div className="rule-item"><span className="badge hot">20</span><div><strong>Oikea maailmanmestari</strong></div></div>
                <div className="rule-item"><span className="badge">10</span><div><strong>Turnauksen maalikuningas</strong></div></div>
                <div className="rule-item"><span className="badge">10</span><div><strong>Kisojen yllattaja</strong></div></div>
                <div className="rule-item"><span className="badge">10</span><div><strong>Kisojen floppi</strong></div></div>
              </div>
              <div className="warning">Floppi ja yllattaja voidaan lukita manuaalisesti tuomariston paatoksen mukaan turnauksen paatteeksi.</div>
            </div>
          </section>
        </div>

        <aside className="sidebar">
          <section className="side-card">
            <div className="section-title"><h2>Pistetaulukko</h2><Trophy color="var(--yellow)" /></div>
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
            }) : <p className="muted">Maalintekijat ilmestyvat tahan, kun rajapinta antaa ne.</p>}
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
