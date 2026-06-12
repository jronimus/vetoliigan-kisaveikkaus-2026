const TARGET = "https://worldcup26.ir";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/yle-proxy") {
      const appId = (env && env.YLE_APP_ID) || "7aab0368abac138f49f840118ff44f59";
      const appKey = (env && env.YLE_APP_KEY) || "42a40fda";
      const yleUrl = `https://external.api.yle.fi/v1/teletext/pages/601.json?app_id=${appId}&app_key=${appKey}`;

      try {
        const response = await fetch(yleUrl);
        const data = await response.text();

        return new Response(data, {
          status: response.status,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "access-control-allow-origin": "*",
            "cache-control": "public, max-age=10",
          },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: {
            "content-type": "application/json",
            "access-control-allow-origin": "*",
          }
        });
      }
    }

    const target = new URL(url.pathname + url.search, TARGET);

    if (!target.pathname.startsWith("/get/")) {
      return new Response("Not found", { status: 404 });
    }

    const response = await fetch(target, {
      headers: {
        accept: "application/json",
      },
    });

    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") || "application/json",
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=20",
      },
    });
  },
};
