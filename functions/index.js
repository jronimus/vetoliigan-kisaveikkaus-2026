const { setGlobalOptions } = require("firebase-functions");
const { onRequest } = require("firebase-functions/v2/https");

setGlobalOptions({ maxInstances: 10 });

exports.telegramTest = onRequest({ secrets: ["TELEGRAM_BOT_TOKEN"] }, async (req, res) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = "-1001048034441";

    if (!token) {
        res.status(500).send("Missing TELEGRAM_BOT_TOKEN");
        return;
    }

    const text = "🤖 Firebase-botti toimii.";

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: chatId,
            text,
        }),
    });

    const data = await response.json();
    res.json(data);
});