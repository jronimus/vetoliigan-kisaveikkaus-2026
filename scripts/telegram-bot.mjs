import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PLAYERS_COLLECTION = "players";
const DEFAULT_FIREBASE_PROJECT_ID = "vetoliigan-kisaveikkaus-2026";
const APP_URL = "https://jronimus.github.io/vetoliigan-kisaveikkaus-2026/";

function usage() {
  return [
    "Usage:",
    "  node scripts/telegram-bot.mjs test",
    "  node scripts/telegram-bot.mjs standings",
    "",
    "Required for Telegram sends:",
    "  TELEGRAM_BOT_TOKEN",
    "  TELEGRAM_CHAT_ID",
    "",
    "Required for Firestore standings:",
    "  FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS_JSON",
    "",
    "Optional:",
    "  TELEGRAM_DRY_RUN=1 prints instead of sending",
  ].join("\n");
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function normalizePrivateKey(serviceAccount) {
  if (typeof serviceAccount.private_key === "string") {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
  }
  return serviceAccount;
}

function serviceAccountFromEnv() {
  const inline =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ||
    process.env.FIREBASE_SERVICE_ACCOUNT;

  if (inline) {
    return normalizePrivateKey(JSON.parse(inline));
  }

  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credentialPath) {
    return normalizePrivateKey(JSON.parse(fs.readFileSync(credentialPath, "utf8")));
  }

  throw new Error("Missing Firebase service account JSON. Set FIREBASE_SERVICE_ACCOUNT_JSON in GitHub Secrets.");
}

function initFirestore() {
  if (!getApps().length) {
    const serviceAccount = serviceAccountFromEnv();
    initializeApp({
      credential: cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id || DEFAULT_FIREBASE_PROJECT_ID,
    });
  }

  return getFirestore();
}

async function readPlayers() {
  const snapshot = await initFirestore().collection(PLAYERS_COLLECTION).get();
  return snapshot.docs.map((doc) => ({
    name: doc.data().name || doc.id,
    predictions: Array.isArray(doc.data().predictions) ? doc.data().predictions : [],
    bonus: doc.data().bonus || {},
  }));
}

function readGames() {
  const filePath = path.join(process.cwd(), "public", "live-data", "games.json");
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Array.isArray(parsed.games) ? parsed.games : [];
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

  if (prediction.home === actualHome && prediction.away === actualAway) {
    return 5;
  }

  const predictedDiff = prediction.home - prediction.away;
  const actualDiff = actualHome - actualAway;
  const predictedSign = Math.sign(predictedDiff);
  const actualSign = Math.sign(actualDiff);

  if (predictedSign === actualSign) {
    if (actualSign === 0) return 2;
    if (predictedDiff === actualDiff) return 3;
    return 2;
  }

  if (prediction.home === actualHome || prediction.away === actualAway) {
    return 1;
  }

  return 0;
}

function standings(players, games) {
  return players
    .map((player) => {
      const predictions = Array.isArray(player.predictions) ? player.predictions : [];
      const matchTotal = predictions.reduce((sum, prediction) => {
        const game = games.find((item) => String(item.id) === String(prediction.matchId));
        return sum + (game ? matchPoints(prediction, game) : 0);
      }, 0);

      const exact = predictions.filter((prediction) => {
        const game = games.find((item) => String(item.id) === String(prediction.matchId));
        return game ? matchPoints(prediction, game) === 5 : false;
      }).length;

      return { name: player.name, points: matchTotal, exact };
    })
    .sort((a, b) => b.points - a.points || b.exact - a.exact || a.name.localeCompare(b.name, "fi"));
}

function standingsMessage(table) {
  const rankIcons = ["🥇", "🥈", "🥉", "4️⃣"];
  const rows = table.slice(0, 4).map((player, index) => `${rankIcons[index] || `${index + 1}.`} ${player.name} — ${player.points} p`);
  return ["🏆 VETOLIIGAN PISTETAULUKKO", "", ...rows, "", `👉 ${APP_URL}`].join("\n");
}

async function sendTelegramMessage(text) {
  if (process.env.TELEGRAM_DRY_RUN === "1") {
    console.log(text);
    return;
  }

  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  const chatId = requireEnv("TELEGRAM_CHAT_ID");
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
    const body = await response.text();
    throw new Error(`Telegram send failed: HTTP ${response.status} ${body}`);
  }
}

async function main() {
  const command = process.argv[2] || "help";

  if (command === "test") {
    await sendTelegramMessage("Firebase/GitHub Actions Telegram-botti toimii");
    return;
  }

  if (command === "standings") {
    const players = await readPlayers();
    const games = readGames();
    await sendTelegramMessage(standingsMessage(standings(players, games)));
    return;
  }

  console.log(usage());
  if (command !== "help" && command !== "--help" && command !== "-h") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
