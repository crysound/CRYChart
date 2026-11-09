import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const root = resolve(process.cwd()),
  port = Number(process.env.PORT || 4178);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
export const server = http
  .createServer(async (req, res) => {
    try {
      let name = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      if (name === "/") name = "/examples/index.html";
      const path = resolve(root, "." + name);
      if (!path.startsWith(root + sep)) {
        res.writeHead(403).end();
        return;
      }
      if (!(await stat(path)).isFile()) {
        res.writeHead(404).end();
        return;
      }
      res
        .writeHead(200, {
          "Content-Type": mime[extname(path)] || "application/octet-stream",
          "Cache-Control": "no-store",
        })
        .end(await readFile(path));
    } catch {
      res.writeHead(404).end("Not found");
    }
  })
  .listen(port, "127.0.0.1", () =>
    console.log(`CRYChart http://127.0.0.1:${port}`),
  );
