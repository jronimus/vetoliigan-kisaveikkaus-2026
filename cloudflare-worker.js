const TARGET = "https://worldcup26.ir";
const PLAYERS_COLLECTION = "players";
const FIREBASE_PROJECT_ID = "vetoliigan-kisaveikkaus-2026";
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

async function firestoreJson(env, path) {
  const token = await googleAccessToken(env);
  const response = await fetch(`https://firestore.googleapis.com/v1/${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
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
  const rows = table.map((player, index) => {
    const exact = player.exact === 1 ? "1 täysosuma" : `${player.exact} täysosumaa`;
    return `${index + 1}. ${player.name}: ${player.points} p (${exact})`;
  });
  return ["Vetoliigan pistetaulukko", "", ...rows].join("\n");
}

function teamName(game, side) {
  const key = side === "home" ? "home_team_name_en" : "away_team_name_en";
  const labelKey = side === "home" ? "home_team_label" : "away_team_label";
  const value = game[key] || game[labelKey] || (side === "home" ? "Kotijoukkue" : "Vierasjoukkue");
  if (value === "Democratic Republic of the Congo") return "DR Kongo";
  return value;
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

function gameTimestamp(game) {
  const [datePart, timePart] = String(game.local_date || "").split(" ");
  const [month, day, year] = datePart.split("/").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 3, minute || 0));
}

function nightGames(games, now = new Date()) {
  const helsinkiNowParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Helsinki",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type) => helsinkiNowParts.find((item) => item.type === type)?.value;
  const year = Number(part("year"));
  const month = Number(part("month"));
  const day = Number(part("day"));
  const hour = Number(part("hour"));
  const startDay = hour < 10 ? day - 1 : day;
  const start = new Date(Date.UTC(year, month - 1, startDay, 19, 0));
  const end = new Date(Date.UTC(year, month - 1, startDay + 1, 7, 0));

  return games
    .filter((game) => {
      const time = gameTimestamp(game);
      return time >= start && time <= end;
    })
    .sort((a, b) => gameTimestamp(a) - gameTimestamp(b));
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

async function commandMessage(command, env) {
  const games = await fetchWorldCupEndpoint("games");

  if (command === "/vetotaulukko") {
    const players = await readPlayers(env);
    return standingsMessage(standings(players, games));
  }

  if (command === "/vetoyönpelit" || command === "/vetoyonpelit") {
    return nightGamesMessage(nightGames(games));
  }

  return [
    "En tunnistanut komentoa.",
    "",
    "Käytössä olevat komennot:",
    "/vetotaulukko",
    "/vetoyönpelit",
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

  if (command === "/vetotaulukko" || command === "/vetoyönpelit" || command === "/vetoyonpelit") {
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

      const proxyResponse = await handleProxy(request, url);
      if (proxyResponse) return proxyResponse;

      return textResponse("Not found", { status: 404 });
    } catch (error) {
      return jsonResponse({ error: error.message }, { status: 500 });
    }
  },
};
