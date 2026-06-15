const TARGET = "https://worldcup26.ir";
const CACHE_SECONDS = {
  games: 20,
  groups: 60,
  teams: 86400,
  stadiums: 86400,
};

export default {
  async fetch(request) {
    const url = new URL(request.url);

    const target = new URL(url.pathname + url.search, TARGET);

    if (!target.pathname.startsWith("/get/")) {
      return new Response("Not found", { status: 404 });
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
      headers: {
        accept: "application/json",
      },
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
  },
};
