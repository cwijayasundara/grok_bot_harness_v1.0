import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function clampCount(count) {
  const value = Number(count);
  if (!Number.isInteger(value) || value < 1) return 1;
  return Math.min(value, 10);
}

export function hashSeed(text) {
  let hash = 2166136261;
  for (const char of String(text)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let next = Math.imul(state ^ (state >>> 15), 1 | state);
    next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

export async function fuzzPage(page, seed, steps) {
  const rand = mulberry32(seed);
  for (let step = 0; step < steps; step += 1) {
    const locator = page.locator("button, a, input, textarea");
    const count = await locator.count();
    if (count === 0) return;
    const element = locator.nth(Math.floor(rand() * count));
    const tag = await element.evaluate((node) => node.tagName).catch(() => "");
    if (tag === "INPUT" || tag === "TEXTAREA") await element.fill("swarm", { timeout: 2000 });
    else await element.click({ timeout: 2000 });
  }
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  return "application/octet-stream";
}

function serve(dir) {
  const root = path.resolve(dir);
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const requested = decodeURIComponent(url.pathname);
    const relative = requested === "/" ? "index.html" : requested.replace(/^\/+/, "");
    const file = path.resolve(root, relative);
    const inside = file === root || file.startsWith(`${root}${path.sep}`);
    if (!inside || !existsSync(file)) {
      response.writeHead(inside ? 404 : 403);
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": contentType(file) });
    response.end(readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

export async function runPlaywrightSwarm({ root, feature, scenarios, count, fuzz, baseURL }) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error("Playwright is not installed. From the harness repo run npm install, then npx playwright install chromium.");
  }
  const sessionsWanted = clampCount(count);
  const steps = Number.isInteger(Number(fuzz)) && Number(fuzz) > 0 ? Math.min(Number(fuzz), 20) : 0;
  const publicDir = path.join(root, "features", feature, "public");
  let server = null;
  let origin = baseURL;
  if (!origin) {
    if (!existsSync(path.join(publicDir, "index.html"))) {
      throw new Error(`No page to drive. Add features/${feature}/public/index.html or pass --base-url.`);
    }
    const served = await serve(publicDir);
    server = served.server;
    origin = served.url;
  }
  const browser = await chromium.launch({ headless: true });
  const sessions = [];
  try {
    for (let index = 1; index <= sessionsWanted; index += 1) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const problems = [];
      page.on("pageerror", (error) => problems.push(error.message));
      let detail = "";
      try {
        await page.goto(origin, { waitUntil: "domcontentloaded" });
        for (const scenario of scenarios) {
          const loaded = await import(`${pathToFileURL(scenario).href}?session=${index}`);
          const run = loaded.default;
          if (typeof run !== "function") throw new Error(`${path.basename(scenario)} must export a default function`);
          await run({ page, baseURL: origin, session: index });
        }
        if (steps > 0) await fuzzPage(page, hashSeed(`${feature}:${index}`), steps);
      } catch (error) {
        detail = error.message;
      }
      if (problems.length > 0) detail = [detail, ...problems].filter(Boolean).join("; ");
      sessions.push({ id: index, passed: detail === "", detail });
      await context.close();
    }
  } finally {
    await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  }
  return sessions;
}
