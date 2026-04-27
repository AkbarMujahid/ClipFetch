import express from "express";
import cors from "cors";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// serve frontend
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

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

  const proc = spawn("python3", ["-m", "yt_dlp", "-j", url]);

  let data = "";
  let error = "";
  let responded = false;

  proc.stdout.on("data", chunk => data += chunk);
  proc.stderr.on("data", err => error += err.toString());

  proc.on("error", err => {
    if (!responded) {
      responded = true;
      console.log("SPAWN ERROR:", err);
      res.status(500).json({ error: "Python error" });
    }
  });

  proc.on("close", () => {
    if (responded) return;

    try {
      if (!data) {
        responded = true;
        console.log("YT-DLP ERROR:", error);
        return res.status(500).json({ error: "yt-dlp failed" });
      }

      const json = JSON.parse(data);

      const qualities = [...new Set(
        json.formats
          .filter(f => f.height && f.vcodec !== "none")
          .map(f => f.height + "p")
      )].sort((a, b) => parseInt(a) - parseInt(b));

      responded = true;

      res.json({
        title: json.title || "Video",
        thumbnail: json.thumbnail || "",
        formats: qualities.length
          ? qualities.map(q => ({ quality: q }))
          : [{ quality: "best" }]
      });

    } catch (err) {
      if (!responded) {
        responded = true;
        console.log("PARSE ERROR:", err);
        res.status(500).json({ error: "Parse failed" });
      }
    }
  });
});

// =========================
// PROGRESS
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

  const infoProc = spawn("python3", ["-m", "yt_dlp", "-j", url]);

  let infoData = "";
  let responded = false;

  infoProc.stdout.on("data", chunk => infoData += chunk);

  infoProc.on("error", err => {
    if (!responded) {
      responded = true;
      console.log("INFO SPAWN ERROR:", err);
      res.status(500).send("Python error");
    }
  });

  infoProc.on("close", () => {
    if (responded) return;

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

      const proc = spawn("python3", args);

      proc.stdout.on("data", data => {
        const str = data.toString();
        const match = str.match(/(\d+\.\d+)%/);
        if (match) {
          progress.percent = parseFloat(match[1]);
          progress.status = "downloading";
        }
      });

      proc.stderr.on("data", d => console.log("YT-DLP:", d.toString()));

      proc.on("error", err => {
        if (!responded) {
          responded = true;
          console.log("DOWNLOAD SPAWN ERROR:", err);
          res.status(500).send("Download failed");
        }
      });

      proc.on("close", () => {
        if (responded) return;

        progress.percent = 100;
        progress.status = "completed";

        if (!fs.existsSync(filepath)) {
          responded = true;
          return res.status(500).send("Download failed");
        }

        responded = true;

        res.download(filepath, filename, () => {
          fs.unlink(filepath, () => {});
        });
      });

    } catch (err) {
      if (!responded) {
        responded = true;
        console.log("DOWNLOAD ERROR:", err);
        res.status(500).send("Error processing download");
      }
    }
  });
});

// =========================
// FALLBACK
// =========================
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// =========================
// START
// =========================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
