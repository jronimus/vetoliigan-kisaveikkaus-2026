const TARGET = "https://worldcup26.ir";
const PLAYERS_COLLECTION = "players";
const FIREBASE_PROJECT_ID = "vetoliigan-kisaveikkaus-2026";
const APP_URL = "https://jronimus.github.io/vetoliigan-kisaveikkaus-2026/";
const REMINDER_HOURS_BEFORE_FIRST_GAME = 4;
const REMINDER_WINDOW_MINUTES = 8;
const ROUND_START_HOUR = 18;
const ROUND_END_HOUR = 10;
const HELSINKI_UTC_OFFSET_HOURS = 3;
const STADIUM_TO_FINLAND_HOURS = {
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
const BOT_STATE_COLLECTION = "telegramBotState";
const YLE_AREENA_APP_ID = "areena-web-items";
const YLE_AREENA_APP_KEY = "wlTs5D9OjIdeS9krPzRQR4I1PYVzoazN";
const YLE_HIGHLIGHTS_TOKEN =
  "eyJhbGciOiJIUzI1NiJ9.eyJjYXJkT3B0aW9uc1RlbXBsYXRlIjoiZXZlbnQiLCJzb3VyY2UiOiJodHRwczovL3Byb2dyYW1zLmFwaS55bGUuZmkvdjMvc2NoZW1hL3YzL3B1YmxpY2F0aW9ucy9sYXRlc3Q_Y29uY2VwdD0xOC0yNTYxMDE6aXNSZWxhdGVkRXZlbnRPZjsxOC0zMTA0MDQ6aXNBcmVlbmFFZGl0b3JpYWxUYWdPZiZwcm9ncmFtX3R5cGU9dHZjbGlwJnB1YmxpY2F0aW9uX3R5cGU9b25kZW1hbmQiLCJhbmFseXRpY3MiOnsiY29udGV4dCI6eyJ5bGUiOnsic291cmNlX3JlZiI6InR2LnZpZXcuNTcteDc1ZUU4Um1QLmZpZmFfamFsa2FwYWxsb25fbW1fMjAyNi5sYWhldHlrc2V0Lmh1aXBwdWhldGtldCJ9fX19.jkyooTvhfGVnYUAYAHVNnIQm8GaS4OX4Lb5wgGtDU28";
const CACHE_SECONDS = {
  games: 20,
  groups: 60,
  teams: 86400,
  stadiums: 86400,
};

const TEXT_ENCODER = new TextEncoder();

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      ...(init.headers || {}),
    },
  });
}

function textResponse(body, init = {}) {
  return new Response(body, {
    ...init,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}

async function handleProxy(request, url) {
  const target = new URL(url.pathname + url.search, TARGET);

  if (!target.pathname.startsWith("/get/")) {
    return undefined;
  }

  const endpoint = target.pathname.split("/").filter(Boolean).at(-1);
  const ttl = CACHE_SECONDS[endpoint] ?? 20;
  const cache = caches.default;
  const cacheKey = new Request(target.toString(), { method: "GET" });
  const cached = await cache.match(cacheKey);

  if (cached) {
    const response = new Response(cached.body, cached);
    response.headers.set("access-control-allow-origin", "*");
    response.headers.set("x-vetoliiga-cache", "HIT");
    return response;
  }

  const upstream = await fetch(target, {
    headers: { accept: "application/json" },
    cf: {
      cacheTtl: ttl,
      cacheEverything: true,
    },
  });

  const response = new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/json",
      "access-control-allow-origin": "*",
      "cache-control": `public, max-age=${ttl}, s-maxage=${ttl}`,
      "x-vetoliiga-cache": "MISS",
    },
  });

  if (request.method === "GET" && response.ok) {
    await cache.put(cacheKey, response.clone());
  }

  return response;
}

function requireEnv(env, name) {
  const value = env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function base64UrlEncode(bytesOrString) {
  const bytes = typeof bytesOrString === "string" ? TEXT_ENCODER.encode(bytesOrString) : bytesOrString;
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToArrayBuffer(pem) {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function signJwt(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const privateKey = serviceAccount.private_key.replace(/\\n/g, "\n");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, TEXT_ENCODER.encode(signingInput));
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function googleAccessToken(env) {
  const raw = requireEnv(env, "FIREBASE_SERVICE_ACCOUNT_JSON");
  const serviceAccount = JSON.parse(raw);
  const assertion = await signJwt(serviceAccount);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new Error(`Google token request failed: ${response.status} ${await response.text()}`);
  }

  const json = await response.json();
  return json.access_token;
}

async function firestoreJson(env, path, init = {}) {
  const token = await googleAccessToken(env);
  const response = await fetch(`https://firestore.googleapis.com/v1/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Firestore request failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function firestoreValue(value) {
  if (!value) return undefined;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return value.booleanValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(firestoreValue);
  if ("mapValue" in value) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields || {}).map(([key, nested]) => [key, firestoreValue(nested)]),
    );
  }
  return undefined;
}

function firestoreDocumentData(document) {
  return Object.fromEntries(
    Object.entries(document.fields || {}).map(([key, value]) => [key, firestoreValue(value)]),
  );
}

function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: value.length ? { values: value.map(toFirestoreValue) } : {},
    };
  }
  if (typeof value === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, toFirestoreValue(nested)])),
      },
    };
  }
  return { stringValue: String(value) };
}

async function readPlayers(env) {
  const projectId = env.FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID;
  const data = await firestoreJson(env, `projects/${projectId}/databases/(default)/documents/${PLAYERS_COLLECTION}`);
  return (data.documents || []).map((document) => {
    const id = document.name?.split("/").pop();
    const values = firestoreDocumentData(document);
    return {
      name: values.name || id,
      predictions: Array.isArray(values.predictions) ? values.predictions : [],
      bonus: values.bonus || {},
    };
  });
}

async function writePlayerPredictions(env, playerName, predictions) {
  const projectId = env.FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID;
  const docId = encodeURIComponent(playerName);
  await firestoreJson(
    env,
    `projects/${projectId}/databases/(default)/documents/${PLAYERS_COLLECTION}/${docId}?updateMask.fieldPaths=predictions`,
    {
      method: "PATCH",
      body: JSON.stringify({
        fields: {
          predictions: toFirestoreValue(predictions),
        },
      }),
    },
  );
}

function botStatePath(env, key) {
  const projectId = env.FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID;
  return `projects/${projectId}/databases/(default)/documents/${BOT_STATE_COLLECTION}/${key}`;
}

async function botStateSent(env, key) {
  const data = await firestoreJson(env, botStatePath(env, key));
  return Boolean(data?.fields?.sent?.booleanValue);
}

async function markBotStateSent(env, key, payload = {}) {
  await firestoreJson(env, botStatePath(env, key), {
    method: "PATCH",
    body: JSON.stringify({
      fields: {
        sent: { booleanValue: true },
        sentAt: { timestampValue: new Date().toISOString() },
        payload: { stringValue: JSON.stringify(payload).slice(0, 1500) },
      },
    }),
  });
}

async function fetchWorldCupEndpoint(endpoint) {
  const response = await fetch(`${TARGET}/get/${endpoint}`, {
    headers: { accept: "application/json" },
    cf: { cacheTtl: CACHE_SECONDS[endpoint] ?? 20, cacheEverything: true },
  });
  if (!response.ok) {
    throw new Error(`World Cup API ${endpoint} failed: ${response.status}`);
  }
  const data = await response.json();
  return data[endpoint] || [];
}

async function fetchStaticGames() {
  try {
    const response = await fetch(`${APP_URL}live-data/games.json?t=${Date.now()}`, {
      headers: { accept: "application/json" },
    });
    if (response.ok) {
      const data = await response.json();
      return data.games || [];
    }
  } catch (err) {
    console.error("Failed to fetch static games:", err);
  }
  return [];
}

async function fetchGamesEnriched() {
  const [rawGames, staticGames] = await Promise.all([
    fetchWorldCupEndpoint("games").catch(() => []),
    fetchStaticGames(),
  ]);

  const gamesToUse = rawGames.length ? rawGames : staticGames;

  // Merge espn_event_id from staticGames to rawGames
  const staticMap = new Map(staticGames.map((g) => [g.id, g]));
  return gamesToUse.map((g) => {
    const staticGame = staticMap.get(g.id);
    return {
      ...g,
      espn_event_id: g.espn_event_id || staticGame?.espn_event_id,
    };
  });
}

async function fetchEspnOdds(eventId) {
  if (!eventId) return null;
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${encodeURIComponent(eventId)}`;
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const summary = await response.json();
    
    // Parse odds
    const pickcenter = summary.pickcenter || [];
    const odds = summary.odds || [];
    const allOdds = [...pickcenter, ...odds];
    if (!allOdds.length) return null;
    
    const item = allOdds[0];
    const homeVal = item.homeTeamOdds?.moneyLine;
    const awayVal = item.awayTeamOdds?.moneyLine;
    const drawVal = item.drawOdds?.moneyLine;
    
    // Convert to decimal odds
    const toDecimal = (val) => {
      if (typeof val !== "number" || !Number.isFinite(val) || val === 0) return undefined;
      const dec = val > 0 ? val / 100 + 1 : 100 / Math.abs(val) + 1;
      return dec.toFixed(2);
    };
    
    const home = toDecimal(homeVal);
    const away = toDecimal(awayVal);
    const draw = toDecimal(drawVal);
    
    if (home || draw || away) {
      return { home, draw, away };
    }
  } catch (err) {
    console.error(`Failed to fetch ESPN odds for event ${eventId}:`, err);
  }
  return null;
}

function isFinished(game) {
  return String(game.finished).toLowerCase() === "true" || String(game.time_elapsed).toLowerCase() === "finished";
}

function parseScore(value) {
  const score = Number.parseInt(value, 10);
  return Number.isFinite(score) ? score : 0;
}

function matchPoints(prediction, game) {
  if (!isFinished(game)) return 0;

  const actualHome = parseScore(game.home_score);
  const actualAway = parseScore(game.away_score);

  if (prediction.home === actualHome && prediction.away === actualAway) return 5;

  const predictedDiff = prediction.home - prediction.away;
  const actualDiff = actualHome - actualAway;
  const predictedSign = Math.sign(predictedDiff);
  const actualSign = Math.sign(actualDiff);

  if (predictedSign === actualSign) {
    if (actualSign === 0) return 2;
    if (predictedDiff === actualDiff) return 3;
    return 2;
  }

  if (prediction.home === actualHome || prediction.away === actualAway) return 1;
  return 0;
}

function predictionGameId(prediction) {
  return prediction?.matchId ?? prediction?.gameId ?? prediction?.match_id ?? prediction?.id;
}

function standings(players, games) {
  return players
    .map((player) => {
      const predictions = Array.isArray(player.predictions) ? player.predictions : [];
      const points = predictions.reduce((sum, prediction) => {
        const game = games.find((item) => String(item.id) === String(predictionGameId(prediction)));
        return sum + (game ? matchPoints(prediction, game) : 0);
      }, 0);
      const exact = predictions.filter((prediction) => {
        const game = games.find((item) => String(item.id) === String(predictionGameId(prediction)));
        return game ? matchPoints(prediction, game) === 5 : false;
      }).length;
      return { name: player.name, points, exact };
    })
    .sort((a, b) => b.points - a.points || b.exact - a.exact || a.name.localeCompare(b.name, "fi"));
}

function standingsMessage(table) {
  const rankIcons = ["🥇", "🥈", "🥉", "4️⃣"];
  const rows = table.slice(0, 4).map((player, index) => `${rankIcons[index] || `${index + 1}.`} ${player.name} — ${player.points} p`);
  return ["🏆 VETOLIIGAN PISTETAULUKKO", "", ...rows, "", `👉 ${APP_URL}`].join("\n");
}

const TEAM_FI = {
  Algeria: "Algeria",
  Argentina: "Argentiina",
  Australia: "Australia",
  Austria: "Itävalta",
  Belgium: "Belgia",
  "Bosnia and Herzegovina": "Bosnia ja Hertsegovina",
  Brazil: "Brasilia",
  Canada: "Kanada",
  Chile: "Chile",
  Colombia: "Kolumbia",
  Croatia: "Kroatia",
  Curacao: "Curacao",
  "Curaçao": "Curacao",
  "Czech Republic": "Tsekki",
  "Democratic Republic of the Congo": "DR Kongo",
  Ecuador: "Ecuador",
  Egypt: "Egypti",
  England: "Englanti",
  France: "Ranska",
  Germany: "Saksa",
  Ghana: "Ghana",
  Haiti: "Haiti",
  Iran: "Iran",
  Iraq: "Irak",
  "Ivory Coast": "Norsunluurannikko",
  Japan: "Japani",
  Jordan: "Jordania",
  Mexico: "Meksiko",
  Morocco: "Marokko",
  Netherlands: "Hollanti",
  "New Zealand": "Uusi-Seelanti",
  Norway: "Norja",
  Panama: "Panama",
  Paraguay: "Paraguay",
  Portugal: "Portugali",
  Qatar: "Qatar",
  "Saudi Arabia": "Saudi-Arabia",
  Scotland: "Skotlanti",
  Senegal: "Senegal",
  "South Africa": "Etelä-Afrikka",
  "South Korea": "Etelä-Korea",
  Spain: "Espanja",
  Sweden: "Ruotsi",
  Switzerland: "Sveitsi",
  Tunisia: "Tunisia",
  Turkey: "Turkki",
  "United States": "Yhdysvallat",
  Uruguay: "Uruguay",
  Uzbekistan: "Uzbekistan",
};

function teamName(game, side) {
  const key = side === "home" ? "home_team_name_en" : "away_team_name_en";
  const labelKey = side === "home" ? "home_team_label" : "away_team_label";
  const value = game[key] || game[labelKey] || (side === "home" ? "Kotijoukkue" : "Vierasjoukkue");
  return TEAM_FI[value] || value;
}

const YLE_TEAM_FI = {
  "Democratic Republic of the Congo": "Kongon demokraattinen tasavalta",
  Curacao: "Curaçao",
  "Curaçao": "Curaçao",
  "Czech Republic": "Tšekki",
  "Ivory Coast": "Norsunluurannikko",
};

function yleTeamName(game, side) {
  const key = side === "home" ? "home_team_name_en" : "away_team_name_en";
  const labelKey = side === "home" ? "home_team_label" : "away_team_label";
  const raw = game[key] || game[labelKey] || "";
  return YLE_TEAM_FI[raw] || teamName(game, side);
}

const TEAM_EMOJIS = {
  Algeria: "🇩🇿",
  Argentina: "🇦🇷",
  Australia: "🇦🇺",
  Austria: "🇦🇹",
  Belgium: "🇧🇪",
  "Bosnia and Herzegovina": "🇧🇦",
  Brazil: "🇧🇷",
  Canada: "🇨🇦",
  Chile: "🇨🇱",
  Colombia: "🇨🇴",
  Croatia: "🇭🇷",
  "Curaçao": "🇨🇼",
  "Czech Republic": "🇨🇿",
  "Democratic Republic of the Congo": "🇨🇩",
  "DR Kongo": "🇨🇩",
  Ecuador: "🇪🇨",
  Egypt: "🇪🇬",
  England: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  France: "🇫🇷",
  Germany: "🇩🇪",
  Ghana: "🇬🇭",
  Haiti: "🇭🇹",
  Iran: "🇮🇷",
  Iraq: "🇮🇶",
  "Ivory Coast": "🇨🇮",
  Japan: "🇯🇵",
  Jordan: "🇯🇴",
  Mexico: "🇲🇽",
  Morocco: "🇲🇦",
  Netherlands: "🇳🇱",
  "New Zealand": "🇳🇿",
  Norway: "🇳🇴",
  Panama: "🇵🇦",
  Paraguay: "🇵🇾",
  Portugal: "🇵🇹",
  Qatar: "🇶🇦",
  "Saudi Arabia": "🇸🇦",
  Scotland: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
  Senegal: "🇸🇳",
  "South Africa": "🇿🇦",
  "South Korea": "🇰🇷",
  Spain: "🇪🇸",
  Sweden: "🇸🇪",
  Switzerland: "🇨🇭",
  Tunisia: "🇹🇳",
  Turkey: "🇹🇷",
  "United States": "🇺🇸",
  Uruguay: "🇺🇾",
  Uzbekistan: "🇺🇿",
};

function teamEmoji(game, side) {
  return TEAM_EMOJIS[teamName(game, side)] || TEAM_EMOJIS[game[side === "home" ? "home_team_name_en" : "away_team_name_en"]] || "";
}

function formatFinnishDate(date) {
  return new Intl.DateTimeFormat("fi-FI", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Helsinki",
  })
    .format(date)
    .replace(",", "");
}

function formatTime(date) {
  return new Intl.DateTimeFormat("fi-FI", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Helsinki",
  }).format(date);
}

function gameTimestamp(game) {
  const [datePart, timePart] = String(game.local_date || "").split(" ");
  const [month, day, year] = datePart.split("/").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const stadiumToFinlandHours = STADIUM_TO_FINLAND_HOURS[String(game.stadium_id)] ?? 0;
  return new Date(
    Date.UTC(
      year,
      month - 1,
      day,
      hour + stadiumToFinlandHours - HELSINKI_UTC_OFFSET_HOURS,
      minute || 0,
    ),
  );
}

function helsinkiParts(date) {
  const helsinkiDateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Helsinki",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type) => helsinkiDateParts.find((item) => item.type === type)?.value;
  return {
    year: Number(part("year")),
    month: Number(part("month")),
    day: Number(part("day")),
    hour: Number(part("hour")),
    minute: Number(part("minute")),
  };
}

function helsinkiLocalDateToUtc(year, month, day, hour, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour - HELSINKI_UTC_OFFSET_HOURS, minute));
}

function addUtcDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function roundWindow(now = new Date()) {
  const { year, month, day, hour } = helsinkiParts(now);
  const startDay = hour < ROUND_END_HOUR ? day - 1 : day;
  const start = helsinkiLocalDateToUtc(year, month, startDay, ROUND_START_HOUR);
  const end = helsinkiLocalDateToUtc(year, month, startDay + 1, ROUND_END_HOUR);
  const idParts = helsinkiParts(start);
  const id = `${idParts.year}-${String(idParts.month).padStart(2, "0")}-${String(idParts.day).padStart(2, "0")}`;
  return { id, start, end };
}

function nightGames(games, now = new Date()) {
  const { start, end } = roundWindow(now);

  return games
    .filter((game) => {
      const time = gameTimestamp(game);
      return time >= start && time <= end;
    })
    .sort((a, b) => gameTimestamp(a) - gameTimestamp(b));
}

function futureNightGames(games, now = new Date()) {
  return nightGames(games, now).filter((game) => gameTimestamp(game) > now && !isFinished(game));
}

function predictionNightGames(games, now = new Date()) {
  const seenWindows = new Set();

  for (let offset = 0; offset < 14; offset += 1) {
    const candidateNow = addUtcDays(now, offset);
    const window = roundWindow(candidateNow);
    if (seenWindows.has(window.id)) continue;
    seenWindows.add(window.id);

    const availableGames = games
      .filter((game) => {
        const time = gameTimestamp(game);
        return time >= window.start && time <= window.end && time > now && !isFinished(game);
      })
      .sort((a, b) => gameTimestamp(a) - gameTimestamp(b));

    if (availableGames.length) {
      return availableGames;
    }
  }

  return [];
}

function previousNightGames(games, now = new Date()) {
  return nightGames(games, addUtcDays(now, -1));
}

function completedNightGamesForSummary(games, now = new Date()) {
  const current = nightGames(games, now);
  if (current.length && current.every(isFinished)) return { games: current, window: roundWindow(now) };

  const previousNow = addUtcDays(now, -1);
  const previous = previousNightGames(games, now);
  if (previous.length && previous.every(isFinished)) return { games: previous, window: roundWindow(previousNow) };

  return { games: [], window: roundWindow(now) };
}

function highlightNightGames(games, now = new Date()) {
  const currentFinished = nightGames(games, now).filter(isFinished);
  if (currentFinished.length) return { games: currentFinished, window: roundWindow(now) };

  const previousNow = addUtcDays(now, -1);
  const previousFinished = nightGames(games, previousNow).filter(isFinished);
  return { games: previousFinished, window: roundWindow(previousNow) };
}

function normalizeHighlightText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—−]/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function highlightMatchKey(home, away) {
  return normalizeHighlightText(`${home}-${away}`);
}

function highlightKeysForGame(game) {
  const home = yleTeamName(game, "home");
  const away = yleTeamName(game, "away");
  return new Set([
    highlightMatchKey(home, away),
    highlightMatchKey(away, home),
  ]);
}

function areenaItemUrl(item) {
  const pointerUri = item?.pointer?.uri || "";
  const itemId = pointerUri.match(/items\/([^/?#]+)/)?.[1] || item?.labels?.find((label) => label.type === "itemId")?.raw;
  return itemId ? `https://areena.yle.fi/${itemId}` : undefined;
}

function areenaHighlightKey(item) {
  const title = normalizeHighlightText(item?.title);
  const withoutPrefix = title.replace(/^huippuhetket:\s*/, "");
  return withoutPrefix;
}

async function fetchYleHighlightItems() {
  const items = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total && offset < 100) {
    const url = new URL("https://areena.api.yle.fi/v1/ui/content/list");
    url.searchParams.set("client", "yle-areena-web");
    url.searchParams.set("language", "fi");
    url.searchParams.set("v", "10");
    url.searchParams.set("crop", "30");
    url.searchParams.set("token", YLE_HIGHLIGHTS_TOKEN);
    url.searchParams.set("app_id", YLE_AREENA_APP_ID);
    url.searchParams.set("app_key", YLE_AREENA_APP_KEY);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", "25");

    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0",
      },
      cf: { cacheTtl: 180, cacheEverything: true },
    });

    if (!response.ok) {
      throw new Error(`Yle Areena huippuhetket failed: ${response.status}`);
    }

    const data = await response.json();
    const batch = Array.isArray(data.data) ? data.data : [];
    total = Number(data.meta?.count) || batch.length;
    items.push(
      ...batch
        .filter((item) => normalizeHighlightText(item?.title).startsWith("huippuhetket:"))
        .map((item) => ({
          title: item.title,
          description: item.description,
          url: areenaItemUrl(item),
          key: areenaHighlightKey(item),
        }))
        .filter((item) => item.url),
    );

    if (!batch.length) break;
    offset += batch.length;
  }

  return items;
}

function findHighlightForGame(game, highlights) {
  const keys = highlightKeysForGame(game);
  return highlights.find((item) => keys.has(item.key));
}

function telegramHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function highlightGameLabel(game) {
  const score = `${parseScore(game.home_score)}-${parseScore(game.away_score)}`;
  return `${teamEmoji(game, "home")} ${teamName(game, "home")} ${score} ${teamName(game, "away")} ${teamEmoji(game, "away")}`;
}

function huippuhetketMessage(games, highlights) {
  if (!games.length) {
    return { text: ["🎬 Yön huippuhetket", "", "Tälle yölle ei löytynyt pelattuja otteluita.", "", `👉 ${APP_URL}`].join("\n") };
  }

  const lines = ["🎬 Yön huippuhetket"];

  games.forEach((game) => {
    const highlight = findHighlightForGame(game, highlights);
    const label = highlightGameLabel(game);
    lines.push("");
    if (highlight) {
      lines.push(`▶️ <a href="${telegramHtml(highlight.url)}">${telegramHtml(label)}</a>`);
    } else {
      lines.push(`⚽ ${telegramHtml(label)}`);
      lines.push("Tästä pelistä ei vielä ole huippuhetkiä saatavilla");
    }
  });

  lines.push("");
  lines.push(`👉 ${APP_URL}`);
  return { text: lines.join("\n"), parseMode: "HTML" };
}

function nightGamesMessage(games) {
  if (!games.length) {
    return "Vetoliigan yön pelit\n\nTälle yölle ei löytynyt pelejä.";
  }

  const rows = games.map((game) => {
    const time = formatFinnishDate(gameTimestamp(game));
    const status = isFinished(game) ? ` ${parseScore(game.home_score)}-${parseScore(game.away_score)}` : "";
    return `${time}: ${teamName(game, "home")} - ${teamName(game, "away")}${status}`;
  });
  return ["Vetoliigan yön pelit", "", ...rows].join("\n");
}

function nightSummaryRankingRows(rows) {
  const rankIcons = ["🥇", "🥈", "🥉", "4️⃣"];
  return rows.map((row, index) => `${rankIcons[index] || `${index + 1}.`} ${row.name} — ${row.points} p`);
}

function nightPoints(players, games) {
  return players
    .map((player) => {
      const points = games.reduce((sum, game) => {
        const prediction = predictionForGame(player, game);
        return sum + (prediction ? matchPoints(prediction, game) : 0);
      }, 0);
      return { name: player.name, points };
    })
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, "fi"));
}

function pointEmoji(points) {
  if (points === 5) return "🟢";
  if (points === 3) return "🔵";
  if (points === 2) return "🟡";
  if (points === 1) return "🟠";
  return "⚪";
}

function predictionText(prediction) {
  return predictionIsComplete(prediction) ? `${prediction.home}-${prediction.away}` : "–";
}

function nightSummaryMessage(games, players, allGames) {
  const lines = ["🌙 Yön MM-kierros on pelattu!"];

  games.forEach((game) => {
    lines.push("");
    lines.push(
      `⚽ ${teamEmoji(game, "home")} ${teamName(game, "home")} ${parseScore(game.home_score)}-${parseScore(game.away_score)} ${teamName(game, "away")} ${teamEmoji(game, "away")}`,
    );

    players.forEach((player) => {
      const prediction = predictionForGame(player, game);
      const points = prediction ? matchPoints(prediction, game) : 0;
      lines.push(`${player.name} ${predictionText(prediction)} ${pointEmoji(points)} +${points} p`);
    });
  });

  lines.push("");
  lines.push("━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("🌙 Yön pisteet");
  lines.push(...nightSummaryRankingRows(nightPoints(players, games)));
  lines.push("");
  lines.push("🏆 Kokonaistilanne");
  lines.push(...nightSummaryRankingRows(standings(players, allGames)));
  lines.push("");
  lines.push(`👉 ${APP_URL}`);

  return lines.join("\n");
}

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "Pelaaja";
}

function predictionForGame(player, game) {
  return (Array.isArray(player.predictions) ? player.predictions : []).find(
    (prediction) => String(predictionGameId(prediction)) === String(game.id),
  );
}

function predictionIsComplete(prediction) {
  return Number.isFinite(Number(prediction?.home)) && Number.isFinite(Number(prediction?.away));
}

function missingPlayersForGame(players, game) {
  return players.filter((player) => !predictionIsComplete(predictionForGame(player, game)));
}

function upsertPrediction(predictions, game, home, away) {
  const nextPrediction = {
    matchId: String(game.id),
    home,
    away,
    locked: false,
  };
  const next = Array.isArray(predictions) ? predictions.filter((prediction) => String(predictionGameId(prediction)) !== String(game.id)) : [];
  next.push(nextPrediction);
  return next;
}

function pluralGame(count) {
  return count === 1 ? "1 veikkaus puuttuu" : `${count} veikkausta puuttuu`;
}

function hoursText(hours) {
  return hours === 1 ? "1 tunnin" : `${hours} tunnin`;
}

function playerMentions(env) {
  try {
    return JSON.parse(env.TELEGRAM_PLAYER_MENTIONS || "{}");
  } catch {
    return {};
  }
}

function playerIdentities(env) {
  try {
    return JSON.parse(env.TELEGRAM_PLAYER_IDENTITIES || "{}");
  } catch {
    return {};
  }
}

function normalizeIdentity(value) {
  return String(value || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

function telegramUserCandidates(user) {
  return [
    user?.id,
    user?.username,
    user?.first_name,
    [user?.first_name, user?.last_name].filter(Boolean).join(" "),
  ]
    .map(normalizeIdentity)
    .filter(Boolean);
}

function playerNameForTelegramUser(user, env, players) {
  const candidates = new Set(telegramUserCandidates(user));
  const identities = playerIdentities(env);
  const mentions = playerMentions(env);

  for (const player of players) {
    const accepted = [
      player.name,
      firstName(player.name),
      mentions[player.name],
      ...(Array.isArray(identities[player.name]) ? identities[player.name] : []),
    ]
      .map(normalizeIdentity)
      .filter(Boolean);

    if (accepted.some((value) => candidates.has(value))) {
      return player.name;
    }
  }

  return undefined;
}

function missingReminderMessage(games, players, env, now = new Date()) {
  const firstGame = games[0];
  const hoursToFirst = Math.max(1, Math.round((gameTimestamp(firstGame) - now) / 3600000));
  const missingCounts = new Map(players.map((player) => [player.name, 0]));
  const lines = [`🌙 Yön MM-kierros alkaa ${hoursText(hoursToFirst)} päästä!`];

  games.forEach((game) => {
    const missing = missingPlayersForGame(players, game);
    missing.forEach((player) => {
      missingCounts.set(player.name, (missingCounts.get(player.name) || 0) + 1);
    });

    lines.push("");
    lines.push(
      `⚽ ${formatTime(gameTimestamp(game))} ${teamEmoji(game, "home")} ${teamName(game, "home")} – ${teamEmoji(game, "away")} ${teamName(game, "away")}`,
    );
    lines.push(missing.length ? `❌ Puuttuu: ${missing.map((player) => firstName(player.name)).join(", ")}` : "✅ Kaikki valmiina");
  });

  const missingSummary = [...missingCounts.entries()].filter(([, count]) => count > 0);
  lines.push("");

  if (missingSummary.length) {
    const mentions = playerMentions(env);
    lines.push("📝 Vielä ehtii:");
    missingSummary.forEach(([name, count]) => {
      lines.push(`${mentions[name] || firstName(name)} – ${pluralGame(count)}`);
    });
  } else {
    lines.push("🎉 Kaikki veikkaukset ovat sisällä!");
  }

  lines.push("");
  lines.push(`👉 ${APP_URL}`);
  lines.push("");
  lines.push("Voit myös veikata tuloksia kirjoittamalla /veikkaa");
  return lines.join("\n");
}

function shouldSendNightReminder(games, now = new Date()) {
  if (!games.length) return false;
  const firstStart = gameTimestamp(games[0]);
  const target = firstStart.getTime() - REMINDER_HOURS_BEFORE_FIRST_GAME * 3600000;
  return Math.abs(now.getTime() - target) <= REMINDER_WINDOW_MINUTES * 60000;
}

async function predictionPrompt(games, player) {
  const predictionIds = (Array.isArray(player.predictions) ? player.predictions : [])
    .map(predictionGameId)
    .filter((id) => id !== undefined && id !== null)
    .map(String);

  if (!games.length) {
    return [
      "🎯 Yön veikkaukset",
      "",
      "Tälle yölle ei löytynyt enää veikattavia pelejä.",
      "",
      `👉 ${APP_URL}`,
    ].join("\n");
  }

  // Fetch odds for all games in parallel
  const oddsList = await Promise.all(games.map(g => fetchEspnOdds(g.espn_event_id)));

  const lines = [
    "🎯 Yön veikkaukset",
    `Veikkaaja: ${player.name}`,
    `Tallennettuja veikkauksia: ${predictionIds.length}`,
    "",
    "Vastaa tähän privaan esim:",
    "1 2-1",
    "2 1-1",
    "",
    "Voit muokata veikkausta lähettämällä uuden tuloksen ennen pelin alkua.",
  ];

  games.forEach((game, index) => {
    const existing = predictionForGame(player, game);
    const odds = oddsList[index];
    lines.push("");
    lines.push(
      `${index + 1}. ${formatTime(gameTimestamp(game))} ${teamEmoji(game, "home")} ${teamName(game, "home")} – ${teamEmoji(game, "away")} ${teamName(game, "away")}`,
    );
    let betLine = `   Nykyinen: ${predictionIsComplete(existing) ? predictionText(existing) : "ei vielä veikkausta"}`;
    if (odds) {
      betLine += `\n   Kertoimet: 1: ${odds.home || "-"}  X: ${odds.draw || "-"}  2: ${odds.away || "-"}`;
    }
    lines.push(betLine);
  });

  lines.push("");
  lines.push(`👉 ${APP_URL}`);
  return lines.join("\n");
}

function parsePredictionLines(text, gameCount) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const parsed = [];

  lines.forEach((line) => {
    const indexed = line.match(/^(\d+)\s*[.)\-:]?\s*(\d+)\s*[-–:]\s*(\d+)$/);
    const single = line.match(/^(\d+)\s*[-–:]\s*(\d+)$/);

    if (indexed) {
      parsed.push({
        index: Number(indexed[1]) - 1,
        home: Number(indexed[2]),
        away: Number(indexed[3]),
      });
      return;
    }

    if (single && gameCount === 1) {
      parsed.push({
        index: 0,
        home: Number(single[1]),
        away: Number(single[2]),
      });
    }
  });

  return parsed.filter(
    (item) =>
      Number.isInteger(item.index) &&
      item.index >= 0 &&
      item.index < gameCount &&
      Number.isInteger(item.home) &&
      Number.isInteger(item.away) &&
      item.home >= 0 &&
      item.away >= 0,
  );
}

function predictionConfirmation(saved) {
  const lines = ["✅ Tallennettu:"];
  saved.forEach(({ game, home, away, edited }) => {
    lines.push(`${edited ? "↺" : "•"} ${teamName(game, "home")} – ${teamName(game, "away")} ${home}-${away}`);
  });
  lines.push("");
  lines.push("Voit muokata ennen pelin alkua lähettämällä /veikkaa ja uuden tuloksen.");
  return lines.join("\n");
}

async function handleBetCommand(message, env) {
  const [games, players] = await Promise.all([fetchGamesEnriched(), readPlayers(env)]);
  const chatId = message.chat.id;
  const from = message.from || {};
  const playerName = playerNameForTelegramUser(from, env, players);
  const player = players.find((item) => item.name === playerName);

  if (!player) {
    const help = "En tunnistanut sua Vetoliigan pelaajaksi. Tarkista, että Telegram-käyttäjänimi vastaa bottiin määritettyä nimeä.";
    await sendTelegramMessage(env, chatId, help);
    return;
  }

  const availableGames = predictionNightGames(games, new Date());
  const prompt = await predictionPrompt(availableGames, player);

  if (message.chat.type === "private") {
    await sendTelegramMessage(env, chatId, prompt);
    return;
  }

  try {
    await sendTelegramMessage(env, from.id, prompt);
    await sendTelegramMessage(env, chatId, `${firstName(player.name)}, lähetin veikkausviestin privana.`);
  } catch {
    await sendTelegramMessage(
      env,
      chatId,
      `${firstName(player.name)}, en saanut privaviestiä läpi. Avaa @JR7FPL_Bot, paina Start ja kirjoita sitten /veikkaa uudestaan.`,
    );
  }
}

async function handlePrivatePredictionMessage(message, env) {
  if (message.chat.type !== "private") return;

  const [games, players] = await Promise.all([fetchGamesEnriched(), readPlayers(env)]);
  const playerName = playerNameForTelegramUser(message.from || {}, env, players);
  const player = players.find((item) => item.name === playerName);

  if (!player) {
    await sendTelegramMessage(env, message.chat.id, "En tunnistanut sua Vetoliigan pelaajaksi. Kirjoita /veikkaa ryhmässä tai tarkista Telegram-käyttäjänimi.");
    return;
  }

  const availableGames = predictionNightGames(games, new Date());
  const parsed = parsePredictionLines(message.text, availableGames.length);

  if (!parsed.length) {
    await sendTelegramMessage(env, message.chat.id, await predictionPrompt(availableGames, player));
    return;
  }

  let nextPredictions = Array.isArray(player.predictions) ? [...player.predictions] : [];
  const saved = [];

  parsed.forEach(({ index, home, away }) => {
    const game = availableGames[index];
    if (!game || gameTimestamp(game) <= new Date() || isFinished(game)) return;
    const edited = Boolean(predictionForGame({ predictions: nextPredictions }, game));
    nextPredictions = upsertPrediction(nextPredictions, game, home, away);
    saved.push({ game, home, away, edited });
  });

  if (!saved.length) {
    await sendTelegramMessage(env, message.chat.id, "Nuo pelit eivät ole enää veikattavissa.");
    return;
  }

  await writePlayerPredictions(env, player.name, nextPredictions);
  await sendTelegramMessage(env, message.chat.id, predictionConfirmation(saved));
}

async function commandMessage(command, env) {
  const games = await fetchGamesEnriched();

  if (command === "/vetotaulukko") {
    const players = await readPlayers(env);
    return standingsMessage(standings(players, games));
  }

  if (command === "/huippuhetket") {
    const { games: completedGames } = highlightNightGames(games, new Date());
    const highlights = completedGames.length ? await fetchYleHighlightItems() : [];
    return huippuhetketMessage(completedGames, highlights);
  }

  return [
    "En tunnistanut komentoa.",
    "",
    "Käytössä olevat komennot:",
    "/vetotaulukko",
    "/veikkaa",
    "/huippuhetket",
  ].join("\n");
}

async function sendTelegramMessage(env, chatId, text) {
  const token = requireEnv(env, "TELEGRAM_BOT_TOKEN");
  const message = typeof text === "object" && text ? text : { text };
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message.text,
      ...(message.parseMode ? { parse_mode: message.parseMode } : {}),
      disable_web_page_preview: true,
    }),
  });
  if (!response.ok) {
    throw new Error(`Telegram send failed: ${response.status} ${await response.text()}`);
  }
}

async function sendNightReminder(env, now = new Date()) {
  const [games, players] = await Promise.all([fetchGamesEnriched(), readPlayers(env)]);
  const window = roundWindow(now);
  const roundGames = nightGames(games, now);
  const upcomingGames = roundGames.filter((game) => gameTimestamp(game) > now && !isFinished(game));
  const stateKey = `reminder-${window.id}`;

  if (!shouldSendNightReminder(roundGames, now)) {
    return { sent: false, reason: "Not in reminder window", games: upcomingGames.length };
  }

  if (await botStateSent(env, stateKey)) {
    return { sent: false, reason: "Already sent", games: upcomingGames.length };
  }

  await sendTelegramMessage(env, requireEnv(env, "TELEGRAM_CHAT_ID"), missingReminderMessage(upcomingGames, players, env, now));
  await markBotStateSent(env, stateKey, { type: "reminder", round: window.id, games: upcomingGames.map((game) => game.id) });
  return { sent: true, type: "reminder", games: upcomingGames.length };
}

function shouldSendNightSummary(games, now = new Date()) {
  if (!games.length || !games.every(isFinished)) return false;
  const latestKickoff = games.reduce((latest, game) => Math.max(latest, gameTimestamp(game).getTime()), 0);
  const earliestSend = latestKickoff + 90 * 60000;
  const latestSend = latestKickoff + 6 * 3600000;
  return now.getTime() >= earliestSend && now.getTime() <= latestSend;
}

async function sendNightSummary(env, now = new Date()) {
  const [games, players] = await Promise.all([fetchGamesEnriched(), readPlayers(env)]);
  const { games: completedGames, window } = completedNightGamesForSummary(games, now);
  const stateKey = `summary-${window.id}`;

  if (!shouldSendNightSummary(completedGames, now)) {
    return { sent: false, reason: "Not in summary window", games: completedGames.length };
  }

  if (await botStateSent(env, stateKey)) {
    return { sent: false, reason: "Already sent", games: completedGames.length };
  }

  await sendTelegramMessage(env, requireEnv(env, "TELEGRAM_CHAT_ID"), nightSummaryMessage(completedGames, players, games));
  await markBotStateSent(env, stateKey, { type: "summary", round: window.id, games: completedGames.map((game) => game.id) });
  return { sent: true, type: "summary", games: completedGames.length };
}

async function runScheduledTelegram(env, now = new Date()) {
  const [reminder, summary] = await Promise.allSettled([sendNightReminder(env, now), sendNightSummary(env, now)]);
  return { reminder, summary };
}

function telegramCommand(text) {
  const command = String(text || "").trim().split(/\s+/)[0].split("@")[0].toLowerCase();
  return command;
}

async function handleTelegramWebhook(request, env, ctx) {
  const expectedSecret = requireEnv(env, "TELEGRAM_WEBHOOK_SECRET");
  const actualSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (actualSecret !== expectedSecret) {
    return textResponse("Unauthorized", { status: 401 });
  }

  const update = await request.json();
  const message = update.message || update.edited_message;
  const chatId = message?.chat?.id;
  const text = message?.text;
  const command = telegramCommand(text);

  if (!chatId || !text) {
    return textResponse("OK");
  }

  if (command === "/vetotaulukko") {
    ctx.waitUntil(
      commandMessage(command, env)
        .then((reply) => sendTelegramMessage(env, chatId, reply))
        .catch((error) => sendTelegramMessage(env, chatId, `Botti kompastui: ${error.message}`)),
    );
    return textResponse("OK");
  }

  if (command === "/veikkaa") {
    ctx.waitUntil(
      handleBetCommand(message, env).catch((error) => sendTelegramMessage(env, chatId, `Botti kompastui: ${error.message}`)),
    );
    return textResponse("OK");
  }

  if (command.startsWith("/")) {
    ctx.waitUntil(
      commandMessage(command, env)
        .then((reply) => sendTelegramMessage(env, chatId, reply))
        .catch((error) => sendTelegramMessage(env, chatId, `Botti kompastui: ${error.message}`)),
    );
    return textResponse("OK");
  }

  if (message.chat?.type === "private") {
    ctx.waitUntil(
      handlePrivatePredictionMessage(message, env).catch((error) => sendTelegramMessage(env, chatId, `Botti kompastui: ${error.message}`)),
    );
  }

  return textResponse("OK");
}

async function registerTelegramWebhook(request, env) {
  const url = new URL(request.url);
  const expectedSecret = requireEnv(env, "TELEGRAM_WEBHOOK_SECRET");
  if (url.searchParams.get("secret") !== expectedSecret) {
    return textResponse("Unauthorized", { status: 401 });
  }

  const token = requireEnv(env, "TELEGRAM_BOT_TOKEN");
  const webhookUrl = `${url.origin}/telegram/webhook`;
  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: expectedSecret,
      allowed_updates: ["message", "edited_message"],
    }),
  });
  const body = await response.json();
  return jsonResponse({ webhookUrl, telegram: body }, { status: response.ok ? 200 : 500 });
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      if (request.method === "POST" && url.pathname === "/telegram/webhook") {
        return handleTelegramWebhook(request, env, ctx);
      }

      if (request.method === "GET" && url.pathname === "/telegram/register") {
        return registerTelegramWebhook(request, env);
      }

      if (request.method === "GET" && url.pathname === "/telegram/test-night-reminder") {
        const expectedSecret = requireEnv(env, "TELEGRAM_WEBHOOK_SECRET");
        if (url.searchParams.get("secret") !== expectedSecret) {
          return textResponse("Unauthorized", { status: 401 });
        }
        const dryRun = url.searchParams.get("dryRun") !== "0";
        const [games, players] = await Promise.all([fetchGamesEnriched(), readPlayers(env)]);
        const now = new Date(url.searchParams.get("now") || Date.now());
        const upcomingGames = futureNightGames(games, now);
        const message = upcomingGames.length
          ? missingReminderMessage(upcomingGames, players, env, now)
          : "Tälle yölle ei löytynyt tulevia pelejä.";
        if (!dryRun) {
          await sendTelegramMessage(env, requireEnv(env, "TELEGRAM_CHAT_ID"), message);
        }
        return jsonResponse({ dryRun, games: upcomingGames.length, message });
      }

      if (request.method === "GET" && url.pathname === "/telegram/test-night-summary") {
        const expectedSecret = requireEnv(env, "TELEGRAM_WEBHOOK_SECRET");
        if (url.searchParams.get("secret") !== expectedSecret) {
          return textResponse("Unauthorized", { status: 401 });
        }
        const dryRun = url.searchParams.get("dryRun") !== "0";
        const now = new Date(url.searchParams.get("now") || Date.now());
        const [games, players] = await Promise.all([fetchGamesEnriched(), readPlayers(env)]);
        const { games: completedGames, window } = completedNightGamesForSummary(games, now);
        const message = completedGames.length
          ? nightSummaryMessage(completedGames, players, games)
          : "Tälle yölle ei löytynyt pelattuja pelejä.";
        if (!dryRun) {
          await sendTelegramMessage(env, requireEnv(env, "TELEGRAM_CHAT_ID"), message);
        }
        return jsonResponse({ dryRun, round: window.id, games: completedGames.length, message });
      }

      if (request.method === "GET" && url.pathname === "/telegram/test-huippuhetket") {
        const expectedSecret = requireEnv(env, "TELEGRAM_WEBHOOK_SECRET");
        if (url.searchParams.get("secret") !== expectedSecret) {
          return textResponse("Unauthorized", { status: 401 });
        }
        const dryRun = url.searchParams.get("dryRun") !== "0";
        const now = new Date(url.searchParams.get("now") || Date.now());
        const games = await fetchGamesEnriched();
        const { games: completedGames, window } = highlightNightGames(games, now);
        const highlights = completedGames.length ? await fetchYleHighlightItems() : [];
        const message = huippuhetketMessage(completedGames, highlights);
        if (!dryRun) {
          await sendTelegramMessage(env, requireEnv(env, "TELEGRAM_CHAT_ID"), message);
        }
        return jsonResponse({ dryRun, round: window.id, games: completedGames.length, message });
      }

      const proxyResponse = await handleProxy(request, url);
      if (proxyResponse) return proxyResponse;

      return textResponse("Not found", { status: 404 });
    } catch (error) {
      return jsonResponse({ error: error.message }, { status: 500 });
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runScheduledTelegram(env));
  },
};
