// shared by the page tests: serves the extension folder locally and runs one simulated store
// page in headless chrome with every outside host blocked. the page prints its result as
// "RESULT <json>" inside a <pre>. these are simulated pages, not live websites.
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const haveChrome = existsSync(CHROME);

export async function startServer() {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    let body = readFileSync(file);
    // ?stub: the real side panel page, with the stand-in chrome apis loaded before its own scripts
    if (new URL(req.url, "http://x").searchParams.has("stub") && extname(file) === ".html") {
      body = String(body).replace("<head>", '<head><script src="/tests/panel/stub.js"></script>');
    }
    res.writeHead(200, { "Content-Type": extname(file) === ".js" ? "text/javascript" : "text/html" }).end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

// the page as drawn after its scripts ran (for pages that don't print a RESULT)
export function domOf(url) {
  return new Promise((resolve, reject) => {
    execFile(
      CHROME,
      ["--headless=new", "--disable-gpu", "--no-first-run", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1", "--virtual-time-budget=3000", "--dump-dom", url],
      { timeout: 60_000 },
      (error, stdout) => (stdout ? resolve(stdout) : reject(error || new Error(`no page from ${url}`))),
    );
  });
}

export function resultOf(url) {
  return new Promise((resolve, reject) => {
    execFile(
      CHROME,
      ["--headless=new", "--disable-gpu", "--no-first-run", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1", "--virtual-time-budget=3000", "--dump-dom", url],
      { timeout: 60_000 },
      (error, stdout) => {
        const found = stdout.match(/RESULT (.*?)<\/pre>/s);
        if (!found) return reject(error || new Error(`no result from ${url}`));
        resolve(JSON.parse(found[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")));
      },
    );
  });
}
