// Minimal static file server for the buildless TURN app.
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname); // project root on Replit
const APP_ROOT = path.join(ROOT, "app");
const PORT = process.env.PORT || 5000;
const PUBLIC_ROOT_FILES = new Set([
  "TURN.html",
  "privacy.html",
  "terms.html",
  "favicon.svg",
]);
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".jsx": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".ico": "image/x-icon", ".zip": "application/zip",
};

// Block any path segment beginning with a dot (.git, .env, .replit, ., .., hidden files at any depth)
const DOTSEG = /(?:^|\/)\./;

http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split("?")[0]);
  } catch {
    res.writeHead(400); return res.end("bad request"); // malformed %-encoding must not crash the process
  }
  // Reject NUL bytes: fs.readFile throws synchronously on them, which would crash the process.
  if (urlPath.includes("\0")) { res.writeHead(400); return res.end("bad request"); }
  if (urlPath === "/") urlPath = "/TURN.html";

  // Block dotfiles/dirs before resolving.
  if (DOTSEG.test(urlPath)) { res.writeHead(403); return res.end("forbidden"); }

  // Resolve first, then enforce the boundary with a trailing separator so a
  // sibling dir sharing the prefix (e.g. workspace-backup) can't be served.
  const filePath = path.resolve(ROOT, "." + urlPath);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end("forbidden"); }
  const relativePath = path.relative(ROOT, filePath);
  const isPublicRootFile = PUBLIC_ROOT_FILES.has(relativePath);
  const isAppAsset = filePath.startsWith(APP_ROOT + path.sep);
  if (!isPublicRootFile && !isAppAsset) { res.writeHead(403); return res.end("forbidden"); }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    const headers = {
      "Content-Type": TYPES[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    };
    if (urlPath === "/app/downloads/cinema-machine-blender.zip") {
      headers["Content-Disposition"] = 'attachment; filename="cinema-machine-blender.zip"';
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}).listen(PORT, "0.0.0.0", () => console.log("TURN serving on port " + PORT));
