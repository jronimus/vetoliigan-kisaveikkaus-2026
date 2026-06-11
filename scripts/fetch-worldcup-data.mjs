import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const API = process.env.WORLDCUP_DATA_SOURCE || "https://worldcup26.ir/get";
const outDir = join(process.cwd(), "public", "live-data");

async function getJson(path) {
  const res = await fetch(`${API}/${path}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
  return res.text();
}

await mkdir(outDir, { recursive: true });

const [games, teams] = await Promise.all([getJson("games"), getJson("teams")]);

await writeFile(join(outDir, "games.json"), games);
await writeFile(join(outDir, "teams.json"), teams);
