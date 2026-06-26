const TARGET = "https://worldcup26.ir";
const PLAYERS_COLLECTION = "players";
const FIREBASE_PROJECT_ID = "vetoliigan-kisaveikkaus-2026";
const APP_URL = "https://jronimus.github.io/vetoliigan-kisaveikkaus-2026/";
const REMINDER_HOURS_BEFORE_FIRST_GAME = 4;
const REMINDER_WINDOW_MINUTES = 8;
const ROUND_START_HOUR = 18;
const ROUND_END_HOUR = 10;
const HELSINKI_UTC_OFFSET_HOURS = 3;
const BOT_STATE_COLLECTION = "telegramBotState";
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

function standings(players, games) {
  return players
    .map((player) => {
      const predictions = Array.isArray(player.predictions) ? player.predictions : [];
      const points = predictions.reduce((sum, prediction) => {
        const game = games.find((item) => String(item.id) === String(prediction.matchId));
        return sum + (game ? matchPoints(prediction, game) : 0);
      }, 0);
      const exact = predictions.filter((prediction) => {
        const game = games.find((item) => String(item.id) === String(prediction.matchId));
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

function teamName(game, side) {
  const key = side === "home" ? "home_team_name_en" : "away_team_name_en";
  const labelKey = side === "home" ? "home_team_label" : "away_team_label";
  const value = game[key] || game[labelKey] || (side === "home" ? "Kotijoukkue" : "Vierasjoukkue");
  if (value === "Democratic Republic of the Congo") return "DR Kongo";
  return value;
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
  England: "🏴",
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
  return new Date(Date.UTC(year, month - 1, day, hour - HELSINKI_UTC_OFFSET_HOURS, minute || 0));
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
    (prediction) => String(prediction.matchId) === String(game.id),
  );
}

function predictionIsComplete(prediction) {
  return Number.isFinite(Number(prediction?.home)) && Number.isFinite(Number(prediction?.away));
}

function missingPlayersForGame(players, game) {
  return players.filter((player) => !predictionIsComplete(predictionForGame(player, game)));
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
  return lines.join("\n");
}

function shouldSendNightReminder(games, now = new Date()) {
  if (!games.length) return false;
  const firstStart = gameTimestamp(games[0]);
  const target = firstStart.getTime() - REMINDER_HOURS_BEFORE_FIRST_GAME * 3600000;
  return Math.abs(now.getTime() - target) <= REMINDER_WINDOW_MINUTES * 60000;
}

async function commandMessage(command, env) {
  const games = await fetchWorldCupEndpoint("games");

  if (command === "/vetotaulukko") {
    const players = await readPlayers(env);
    return standingsMessage(standings(players, games));
  }

  return [
    "En tunnistanut komentoa.",
    "",
    "Käytössä olevat komennot:",
    "/vetotaulukko",
  ].join("\n");
}

async function sendTelegramMessage(env, chatId, text) {
  const token = requireEnv(env, "TELEGRAM_BOT_TOKEN");
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!response.ok) {
    throw new Error(`Telegram send failed: ${response.status} ${await response.text()}`);
  }
}

async function sendNightReminder(env, now = new Date()) {
  const [games, players] = await Promise.all([fetchWorldCupEndpoint("games"), readPlayers(env)]);
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
  const [games, players] = await Promise.all([fetchWorldCupEndpoint("games"), readPlayers(env)]);
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

  if (!chatId || !command.startsWith("/")) {
    return textResponse("OK");
  }

  if (command === "/vetotaulukko") {
    ctx.waitUntil(
      commandMessage(command, env)
        .then((reply) => sendTelegramMessage(env, chatId, reply))
        .catch((error) => sendTelegramMessage(env, chatId, `Botti kompastui: ${error.message}`)),
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
        const [games, players] = await Promise.all([fetchWorldCupEndpoint("games"), readPlayers(env)]);
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
        const [games, players] = await Promise.all([fetchWorldCupEndpoint("games"), readPlayers(env)]);
        const { games: completedGames, window } = completedNightGamesForSummary(games, now);
        const message = completedGames.length
          ? nightSummaryMessage(completedGames, players, games)
          : "Tälle yölle ei löytynyt pelattuja pelejä.";
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
