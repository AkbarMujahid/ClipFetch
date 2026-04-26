import express from "express";
import cors from "cors";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(cors());
app.use(express.json());

// 🔥 FIX: __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🔥 SERVE FRONTEND (IMPORTANT)
app.use(express.static(path.join(__dirname, "public")));

// 🔥 FIX: dynamic port for Render
const PORT = process.env.PORT || 3000;

// store progress
let progress = { percent: 0, status: "idle" };

// clean filename
function cleanFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

// =========================
// GET FORMATS
// =========================
app.post("/formats", (req, res) => {
  const { url } = req.body;

  const proc = spawn("python", ["-m", "yt_dlp", "-j", url]);

  let data = "";

  proc.stdout.on("data", chunk => data += chunk);

  proc.on("close", () => {
    try {
      const json = JSON.parse(data);

      const qualities = [...new Set(
        json.formats
          .filter(f => f.height && f.vcodec !== "none")
          .map(f => f.height + "p")
      )].sort((a, b) => parseInt(a) - parseInt(b));

      res.json({
        title: json.title || "Video",
        thumbnail: json.thumbnail || "",
        formats: qualities.length
          ? qualities.map(q => ({ quality: q }))
          : [{ quality: "best" }]
      });

    } catch (err) {
      res.status(500).json({ error: "Failed to fetch formats" });
    }
  });
});

// =========================
// PROGRESS ROUTE
// =========================
app.get("/progress", (req, res) => {
  res.json(progress);
});

// =========================
// DOWNLOAD
// =========================
app.get("/download", (req, res) => {
  const { url, quality } = req.query;
  const height = parseInt((quality || "720p").replace("p", ""));

  progress = { percent: 0, status: "starting" };

  const infoProc = spawn("python", ["-m", "yt_dlp", "-j", url]);

  let infoData = "";

  infoProc.stdout.on("data", chunk => infoData += chunk);

  infoProc.on("close", () => {
    try {
      const json = JSON.parse(infoData);

      const title = cleanFilename(json.title || "video");
      const filename = `${title}.mp4`;
      const filepath = path.join(__dirname, filename);

      const format =
        quality === "best"
          ? "best"
          : `bestvideo[ext=mp4][height<=${height}]+bestaudio[ext=m4a]/best`;

      const args = [
        "-m", "yt_dlp",
        "-f", format,
        "--merge-output-format", "mp4",
        "-o", filepath,
        url
      ];

      // 🔥 IMPORTANT: DO NOT use Windows ffmpeg path (Render won't have it)
      const proc = spawn("python", args);

      proc.stdout.on("data", data => {
        const str = data.toString();

        const match = str.match(/(\d+\.\d+)%/);
        if (match) {
          progress.percent = parseFloat(match[1]);
          progress.status = "downloading";
        }
      });

      proc.stderr.on("data", d => console.log(d.toString()));

      proc.on("close", () => {
        progress.percent = 100;
        progress.status = "completed";

        if (!fs.existsSync(filepath)) {
          return res.status(500).send("Download failed");
        }

        res.download(filepath, filename, () => {
          fs.unlink(filepath, () => {});
        });
      });

    } catch (err) {
      res.status(500).send("Error processing download");
    }
  });
});

// =========================
// ROOT FIX (IMPORTANT)
// =========================
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// =========================
// START SERVER
// =========================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});