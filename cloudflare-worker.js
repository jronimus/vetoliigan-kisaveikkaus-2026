const TARGET = "https://worldcup26.ir";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);


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
