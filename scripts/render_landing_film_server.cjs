const http = require("node:http");
const { createReadStream } = require("node:fs");
const { readFile, stat, writeFile } = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pagePath = path.join(__dirname, "render_landing_film.html");
const assets = {
  "/poster": {
    file: path.join(root, "frontend", "public", "striklenz-overview-poster.jpg"),
    type: "image/jpeg",
    writable: true,
  },
  "/video": {
    file: path.join(root, "frontend", "public", "striklenz-overview.mp4"),
    type: "video/mp4",
    writable: true,
  },
  "/vendor/mp4-muxer.js": {
    file: path.join(__dirname, "vendor", "mp4-muxer.js"),
    type: "text/javascript; charset=utf-8",
  },
};
const maxUploadBytes = 25 * 1024 * 1024;
const port = 4350;

const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/") {
    readFile(pagePath)
      .then((page) => {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(page);
      })
      .catch((error) => {
        console.error("Could not read the film renderer:", error);
        response.writeHead(500).end("Could not read the film renderer");
      });
    return;
  }

  const asset = assets[request.url];
  if ((request.method === "GET" || request.method === "HEAD") && asset) {
    stat(asset.file)
      .then((file) => {
        const range = request.headers.range;
        let start = 0;
        let end = file.size - 1;
        let status = 200;
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (!match) {
            response.writeHead(416, { "Content-Range": `bytes */${file.size}` }).end();
            return;
          }
          if (match[1]) {
            start = Number(match[1]);
            if (match[2]) end = Number(match[2]);
          } else {
            const suffixLength = Number(match[2]);
            start = Math.max(0, file.size - suffixLength);
          }
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= file.size) {
            response.writeHead(416, { "Content-Range": `bytes */${file.size}` }).end();
            return;
          }
          end = Math.min(end, file.size - 1);
          status = 206;
        }
        const headers = {
          "Accept-Ranges": "bytes",
          "Content-Length": end - start + 1,
          "Content-Type": asset.type,
        };
        if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${file.size}`;
        response.writeHead(status, headers);
        if (request.method === "HEAD") {
          response.end();
          return;
        }
        createReadStream(asset.file, { start, end })
          .on("error", (error) => {
            console.error(`Could not stream ${path.basename(asset.file)}:`, error);
            if (!response.headersSent) response.writeHead(500).end("Could not read motion asset");
            else response.destroy(error);
          })
          .pipe(response);
      })
      .catch((error) => {
        const status = error.code === "ENOENT" ? 404 : 500;
        if (status === 500) console.error(`Could not read ${path.basename(asset.file)}:`, error);
        response.writeHead(status).end(status === 404 ? "Motion asset has not been rendered" : "Could not read motion asset");
      });
    return;
  }

  if (request.method !== "POST" || !asset?.writable) {
    response.writeHead(404).end("Not found");
    return;
  }

  const chunks = [];
  let receivedBytes = 0;
  let tooLarge = false;
  request.on("data", (chunk) => {
    receivedBytes += chunk.length;
    if (receivedBytes > maxUploadBytes) {
      if (!tooLarge) {
        tooLarge = true;
        chunks.length = 0;
        response.writeHead(413).end("Motion asset exceeds 25 MB");
      }
      return;
    }
    if (!tooLarge) chunks.push(chunk);
  });
  request.on("end", () => {
    if (tooLarge || response.writableEnded || request.destroyed) return;
    writeFile(asset.file, Buffer.concat(chunks))
      .then(() => {
        response.writeHead(201, { "Content-Type": "text/plain; charset=utf-8" });
        response.end(path.basename(asset.file));
        console.log(`Saved ${path.basename(asset.file)} (${receivedBytes} bytes)`);
      })
      .catch((error) => {
        console.error(`Could not save ${path.basename(asset.file)}:`, error);
        response.writeHead(500).end("Could not save the motion asset");
      });
  });
  request.on("error", (error) => {
    console.error("Motion asset upload failed:", error.message);
    if (!response.headersSent) response.writeHead(400).end("Motion asset upload failed");
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Open http://127.0.0.1:${port}/ to preview and render the StrikLenz film.`);
});
