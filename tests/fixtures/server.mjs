import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"

const port = Number(process.env.ROOTLINE_FIXTURE_PORT || 4178)
const root = fileURLToPath(new URL("./site/", import.meta.url))
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" }

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://127.0.0.1:${port}`)
  if (url.pathname === "/api/fail") {
    response.writeHead(500, {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": "session_id=server-secret",
      "X-Fixture": "rootline",
    })
    response.end(JSON.stringify({ error: "fixture failure", access_token: "response-secret" }))
    return
  }
  if (url.pathname === "/api/xhr") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "X-Fixture": "xhr" })
    response.end(JSON.stringify({ ok: true, refresh_token: "xhr-response-secret" }))
    return
  }
  const relative = url.pathname === "/" ? "html.html" : decodeURIComponent(url.pathname.slice(1))
  const file = normalize(join(root, relative))
  if (!file.startsWith(root)) {
    response.writeHead(403).end("Forbidden")
    return
  }
  try {
    await stat(file)
    response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" })
    createReadStream(file).pipe(response)
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
    response.end("Not found")
  }
})

server.listen(port, "127.0.0.1", () => console.log(`Rootline fixtures: http://127.0.0.1:${port}`))
