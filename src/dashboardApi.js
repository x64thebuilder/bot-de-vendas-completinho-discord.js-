const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const DATA_ROOT = path.join(__dirname, "..", "data");
const SECRET = process.env.DASHBOARD_API_SECRET;
function isAuthorized(header) {
  if (!header) return false;
  const expected = `Bearer ${SECRET}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
function safeResolve(relPath) {
  const clean = String(relPath || "").replace(/^[/\\]+/, "");
  const full = path.join(DATA_ROOT, clean);
  const normalizedRoot = DATA_ROOT + path.sep;
  if (full !== DATA_ROOT && !full.startsWith(normalizedRoot)) return null; 
  return full;
}
function send(res, status, body, extraHeaders = {}) {
  const isString = typeof body === "string";
  res.writeHead(status, {
    "Content-Type": isString ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    ...extraHeaders
  });
  res.end(isString ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 10 * 1024 * 1024) req.destroy(); 
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
function startDashboardApi(port) {
  if (!SECRET) {
    console.warn("[DashboardAPI] DASHBOARD_API_SECRET nao definido no .env — API interna do dashboard desativada.");
    return null;
  }
  const server = http.createServer(async (req, res) => {
    try {
      if (!isAuthorized(req.headers.authorization)) {
        return send(res, 401, { error: "unauthorized" });
      }
      const url = new URL(req.url, "http://internal");
      const relPath = url.searchParams.get("path") || "";
      if (url.pathname === "/internal/health") {
        return send(res, 200, { ok: true, uptime: process.uptime() });
      }
      if (url.pathname === "/internal/file" && req.method === "GET") {
        const full = safeResolve(relPath);
        if (!full) return send(res, 400, { error: "invalid path" });
        fs.readFile(full, "utf8", (err, content) => {
          if (err) return send(res, 404, { error: "not found" });
          send(res, 200, content);
        });
        return;
      }
      if (url.pathname === "/internal/file" && (req.method === "PUT" || req.method === "POST")) {
        const full = safeResolve(relPath);
        if (!full) return send(res, 400, { error: "invalid path" });
        const body = await readBody(req);
        fs.mkdir(path.dirname(full), { recursive: true }, (mkErr) => {
          if (mkErr) return send(res, 500, { error: "mkdir failed" });
          fs.writeFile(full, body, "utf8", (wErr) => {
            if (wErr) return send(res, 500, { error: "write failed" });
            send(res, 200, { ok: true });
          });
        });
        return;
      }
      if (url.pathname === "/internal/folder" && req.method === "GET") {
        const full = safeResolve(relPath || "/");
        if (!full) return send(res, 400, { error: "invalid path" });
        fs.readdir(full, { withFileTypes: true }, (err, entries) => {
          if (err) return send(res, 200, []); 
          send(
            res,
            200,
            entries.map((e) => ({ name: e.name, type: e.isDirectory() ? "directory" : "file" }))
          );
        });
        return;
      }
      send(res, 404, { error: "unknown route" });
    } catch (error) {
      console.error("[DashboardAPI] Erro:", error);
      send(res, 500, { error: "internal error" });
    }
  });
  server.listen(port, () => {
    console.log(`[DashboardAPI] Ouvindo na porta ${port} (uso interno do dashboard).`);
  });
  server.on("error", (error) => {
    console.error("[DashboardAPI] Falha ao iniciar:", error.message);
  });
  return server;
}
module.exports = { startDashboardApi };
