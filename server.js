import express from "express";
import { spawn, spawnSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =========================
// CONFIG (all overridable with environment variables)
// =========================
const env = process.env;

function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function hostList(value) {
  return value.split(",").map(h => h.trim().toLowerCase()).filter(Boolean);
}

const CONFIG = {
  port: int(env.PORT, 3000),
  python: env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3"),
  // yt-dlp needs a JS runtime for YouTube; Node is always available here
  jsRuntimes: env.YTDLP_JS_RUNTIMES ?? "node",
  maxConcurrentJobs: int(env.MAX_CONCURRENT_JOBS, 2),
  maxQueuedJobs: int(env.MAX_QUEUED_JOBS, 10),
  maxJobsPerIp: int(env.MAX_JOBS_PER_IP, 2),
  maxHeight: int(env.MAX_HEIGHT, 1080),
  maxDurationSec: int(env.MAX_DURATION_MINUTES, 60) * 60,
  maxFilesize: env.MAX_FILESIZE || "500M",
  jobTimeoutMs: int(env.JOB_TIMEOUT_MINUTES, 15) * 60_000,
  infoTimeoutMs: int(env.INFO_TIMEOUT_SECONDS, 60) * 1000,
  fileTtlMs: int(env.FILE_TTL_MINUTES, 15) * 60_000,
  abandonAfterMs: 60_000,
  infoRateLimit: int(env.RATE_LIMIT_INFO, 30),
  downloadRateLimit: int(env.RATE_LIMIT_DOWNLOAD, 10),
  rateWindowMs: 10 * 60_000,
  tmpRoot: env.DOWNLOAD_DIR || path.join(os.tmpdir(), "clipfetch"),
  // Render mounts secret files at /etc/secrets/<name>
  cookiesFile: env.COOKIES_FILE || "/etc/secrets/cookies.txt",
  // optional extras for when a site blocks the server (e.g. YouTube on cloud hosts)
  proxy: env.YTDLP_PROXY || "",
  extractorArgs: env.YTDLP_EXTRACTOR_ARGS || "",
  // fail fast instead of retrying for a minute when a site blocks us
  extractorRetries: env.YTDLP_EXTRACTOR_RETRIES || "1",
  // free Cloudflare WARP tunnel started by scripts/warp.sh (Docker only)
  useWarp: env.USE_WARP === "true",
  warpProxy: env.WARP_PROXY || `socks5://127.0.0.1:${env.WARP_PORT || 40000}`,
  warpHosts: hostList(env.WARP_HOSTS || "youtube.com,youtu.be,youtube-nocookie.com"),
  allowedHosts: hostList(env.ALLOWED_HOSTS ||
    "youtube.com,youtu.be,youtube-nocookie.com,instagram.com,facebook.com,fb.watch,fb.com"),
  trustProxy: env.TRUST_PROXY ?? (env.RENDER ? "true" : "false")
};

const AUDIO_BITRATES = [320, 256, 192, 128];

// =========================
// STARTUP
// =========================
fs.rmSync(CONFIG.tmpRoot, { recursive: true, force: true });
fs.mkdirSync(CONFIG.tmpRoot, { recursive: true });

// yt-dlp writes cookies back on exit, so use a writable copy of the secret file
let cookiesPath = null;
if (fs.existsSync(CONFIG.cookiesFile)) {
  try {
    cookiesPath = path.join(CONFIG.tmpRoot, "cookies.txt");
    fs.copyFileSync(CONFIG.cookiesFile, cookiesPath);
    console.log("Using cookies from", CONFIG.cookiesFile);
  } catch (err) {
    cookiesPath = null;
    console.log("COULD NOT READ COOKIES FILE:", err.message);
  }
} else {
  console.log("No cookies file found at", CONFIG.cookiesFile);
}

function toolVersion(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true });
  return r.status === 0 ? r.stdout.split("\n")[0].trim() : null;
}

const ytdlpVersion = toolVersion(CONFIG.python, ["-m", "yt_dlp", "--version"]);
const ffmpegVersion = toolVersion("ffmpeg", ["-version"]);
console.log("yt-dlp:", ytdlpVersion || "NOT FOUND");
console.log("ffmpeg:", ffmpegVersion || "NOT FOUND");

// =========================
// HELPERS
// =========================
function validateUrl(raw) {
  if (typeof raw !== "string" || raw.length > 2048) return null;

  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  return hostMatches(url, CONFIG.allowedHosts) ? url.href : null;
}

function hostMatches(url, hosts) {
  const host = new URL(url).hostname.toLowerCase();
  return hosts.some(h => host === h || host.endsWith("." + h));
}

function parseQuality(type, raw) {
  const n = parseInt(String(raw ?? ""), 10);

  if (type === "audio") {
    return AUDIO_BITRATES.includes(n) ? n : null;
  }

  if (raw === "best") return CONFIG.maxHeight;
  return n > 0 ? Math.min(n, CONFIG.maxHeight) : null;
}

function friendlyError(stderr) {
  const s = stderr || "";

  if (/confirm you.?re not a bot|Sign in to confirm|Failed to extract any player response/i.test(s))
    return "YouTube is blocking downloads from this server right now. Instagram and Facebook links still work.";
  if (/HTTP Error 403/i.test(s))
    return "The video site refused the download. Please try again in a moment.";
  if (/larger than max-filesize/i.test(s))
    return `This video is too large (limit ${CONFIG.maxFilesize}).`;
  if (/does not pass filter/i.test(s))
    return "This video is too long or is a live stream.";
  if (/private/i.test(s))
    return "This video is private.";
  if (/Unsupported URL/i.test(s))
    return "This link isn't supported.";
  if (/login|log in|cookies|age/i.test(s))
    return "This video requires a login and can't be downloaded.";
  if (/unavailable|not available|removed|404/i.test(s))
    return "This video is unavailable.";

  return "Couldn't process this video. Check the link and try again.";
}

// the final error alone often hides the cause (e.g. an earlier bot-check warning)
function lastLines(text, count = 6) {
  return (text || "").trim().split("\n").slice(-count).join("\n  ");
}

function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;

  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true });
    } else {
      // yt-dlp starts ffmpeg as a child, so kill the whole process group
      process.kill(-proc.pid, "SIGKILL");
    }
  } catch {
    try { proc.kill("SIGKILL"); } catch {}
  }
}

// YTDLP_PROXY applies to every site; otherwise WARP is used only for its hosts
// and only while the tunnel is confirmed working, so a broken tunnel falls back to direct
function proxyFor(url) {
  if (CONFIG.proxy) return CONFIG.proxy;
  if (warp.connected && hostMatches(url, CONFIG.warpHosts)) return CONFIG.warpProxy;
  return "";
}

function runYtdlp(url, args, { timeoutMs, collect = false, onLine } = {}) {
  const fullArgs = [
    "-m", "yt_dlp",
    "--no-playlist",
    "--socket-timeout", "20",
    "--extractor-retries", CONFIG.extractorRetries
  ];
  if (CONFIG.jsRuntimes) fullArgs.push("--js-runtimes", CONFIG.jsRuntimes);
  if (cookiesPath) fullArgs.push("--cookies", cookiesPath);
  if (CONFIG.extractorArgs) fullArgs.push("--extractor-args", CONFIG.extractorArgs);

  const proxy = proxyFor(url);
  if (proxy) fullArgs.push("--proxy", proxy);

  fullArgs.push(...args, "--", url);

  const proc = spawn(CONFIG.python, fullArgs, {
    detached: process.platform !== "win32",
    windowsHide: true
  });

  let stdout = "";
  let stderr = "";
  let timedOut = false;

  const timer = timeoutMs && setTimeout(() => {
    timedOut = true;
    killTree(proc);
  }, timeoutMs);

  function lineSplitter(onText) {
    let buffer = "";
    return chunk => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n|\r/);
      buffer = lines.pop();
      lines.forEach(line => line && onText(line));
    };
  }

  proc.stdout.on("data", collect
    ? chunk => { stdout += chunk; }
    : lineSplitter(line => onLine?.(line)));

  proc.stderr.on("data", lineSplitter(line => {
    stderr += line + "\n";
    onLine?.(line);
  }));

  const done = new Promise(resolve => {
    proc.on("error", err => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + err.message, timedOut });
    });
    proc.on("close", code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });

  return { proc, done };
}

// =========================
// WARP TUNNEL STATUS
// =========================
const warp = { enabled: CONFIG.useWarp, connected: false, ip: null, checkedAt: null };

// Cloudflare's trace page reports "warp=on" when the request came through WARP
function checkWarp() {
  const socks = CONFIG.warpProxy.replace(/^socks5:/, "socks5h:");
  const proc = spawn("curl", [
    "-s", "--max-time", "10", "-x", socks,
    "https://www.cloudflare.com/cdn-cgi/trace"
  ], { windowsHide: true });

  let out = "";
  proc.stdout.on("data", chunk => { out += chunk; });

  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;

    const wasConnected = warp.connected;
    warp.connected = /^warp=(on|plus)$/m.test(out);
    warp.ip = warp.connected ? (out.match(/^ip=(.+)$/m) || [])[1] || null : null;
    warp.checkedAt = new Date().toISOString();

    if (warp.connected !== wasConnected) {
      console.log(warp.connected
        ? `[warp] tunnel connected (${warp.ip}); YouTube requests now go through WARP`
        : "[warp] tunnel down; YouTube requests go direct");
    }

    // check often until it comes up, then occasionally
    setTimeout(checkWarp, warp.connected ? 5 * 60_000 : 30_000).unref();
  };

  proc.on("error", settle);
  proc.on("close", settle);
}

if (warp.enabled) {
  setTimeout(checkWarp, 5000).unref();
}

function rateLimit(max, windowMs) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.reset <= now) hits.delete(key);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    let entry = hits.get(req.ip);

    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(req.ip, entry);
    }

    if (++entry.count > max) {
      res.set("Retry-After", String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({ error: "Too many requests. Please wait a few minutes and try again." });
    }

    next();
  };
}

// =========================
// JOBS
// =========================
const jobs = new Map();
const queue = [];
let activeJobs = 0;

const FINISHED = new Set(["done", "error", "cancelled"]);

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    percent: job.percent,
    message: job.message,
    speed: job.speed,
    eta: job.eta,
    filename: job.filename,
    error: job.error,
    queuePosition: job.status === "queued" ? queue.indexOf(job) + 1 : 0
  };
}

function update(job, changes) {
  Object.assign(job, changes);
  const payload = `data: ${JSON.stringify(publicJob(job))}\n\n`;
  job.listeners.forEach(res => res.write(payload));
}

function finish(job, changes, ttlMs) {
  update(job, changes);
  job.expiresAt = Date.now() + ttlMs;
  job.listeners.forEach(res => res.end());
  job.listeners.clear();
}

function removeJob(job) {
  killTree(job.proc);
  clearTimeout(job.abandonTimer);
  job.listeners.forEach(res => res.end());
  job.listeners.clear();

  const index = queue.indexOf(job);
  if (index !== -1) queue.splice(index, 1);

  jobs.delete(job.id);
  fs.rm(job.dir, { recursive: true, force: true }, () => {});
}

function cancelJob(job) {
  if (FINISHED.has(job.status)) return;

  job.cancelled = true;
  killTree(job.proc);

  const index = queue.indexOf(job);
  if (index !== -1) {
    queue.splice(index, 1);
    notifyQueue();
  }

  finish(job, { status: "cancelled", message: "Cancelled" }, 60_000);
}

function scheduleAbandon(job) {
  clearTimeout(job.abandonTimer);
  job.abandonTimer = setTimeout(() => {
    if (!job.listeners.size) cancelJob(job);
  }, CONFIG.abandonAfterMs);
}

function notifyQueue() {
  queue.forEach(job => update(job, {}));
}

function startNext() {
  while (activeJobs < CONFIG.maxConcurrentJobs && queue.length) {
    runJob(queue.shift());
    notifyQueue();
  }
}

function downloadArgs(job) {
  const args = [
    "--newline",
    "--windows-filenames",
    "--max-filesize", CONFIG.maxFilesize,
    "--match-filters", `!is_live & duration <=? ${CONFIG.maxDurationSec}`,
    "-o", path.join(job.dir, "%(title).80B.%(ext)s")
  ];

  if (job.type === "audio") {
    args.push(
      "-f", "ba/b",
      "-x",
      "--audio-format", "mp3",
      "--audio-quality", `${job.quality}K`
    );
  } else {
    // prefer the best resolution up to the chosen height, with MP4-friendly codecs
    args.push(
      "-f", "bv*+ba/b",
      "-S", `res:${job.quality},ext:mp4:m4a`,
      "--merge-output-format", "mp4",
      "--remux-video", "mp4"
    );
  }

  return args;
}

function handleProgressLine(job, line) {
  if (/^\[download\] Destination:/.test(line)) {
    job.part += 1;
    const what = job.type === "audio" ? "audio" : job.part > 1 ? "audio" : "video";
    return update(job, { message: `Downloading ${what}…`, percent: 0, speed: "", eta: "" });
  }

  const progress = line.match(/^\[download\]\s+([\d.]+)%/);
  if (progress) {
    const speed = line.match(/at\s+(\S+\/s)/);
    const eta = line.match(/ETA\s+(\S+)/);
    return update(job, {
      percent: Math.min(100, parseFloat(progress[1])),
      speed: speed ? speed[1] : "",
      eta: eta && eta[1] !== "Unknown" ? eta[1] : ""
    });
  }

  const step = line.match(/^\[(Merger|VideoRemuxer|ExtractAudio|Fixup\w*|VideoConvertor)\]/);
  if (step) {
    const message = step[1] === "ExtractAudio" ? "Converting to MP3…" : "Merging video and audio…";
    update(job, { status: "processing", message, percent: 100, speed: "", eta: "" });
  }
}

function findOutputFile(job) {
  const wanted = job.type === "audio" ? ".mp3" : ".mp4";

  const files = fs.readdirSync(job.dir)
    .filter(name => !/\.(part|ytdl|temp)$/i.test(name) && !name.includes(".part-"))
    .map(name => ({ name, size: fs.statSync(path.join(job.dir, name)).size }))
    .sort((a, b) => b.size - a.size);

  return files.find(f => f.name.toLowerCase().endsWith(wanted)) || files[0] || null;
}

async function runJob(job) {
  activeJobs++;
  fs.mkdirSync(job.dir, { recursive: true });
  update(job, { status: "downloading", message: "Starting…", percent: 0 });

  try {
    const { proc, done } = runYtdlp(job.url, downloadArgs(job), {
      timeoutMs: CONFIG.jobTimeoutMs,
      onLine: line => handleProgressLine(job, line)
    });
    job.proc = proc;

    const { code, stderr, timedOut } = await done;
    job.proc = null;

    if (job.cancelled) return;

    if (timedOut) {
      return finish(job, { status: "error", error: "The download took too long and was stopped." }, 120_000);
    }

    if (code !== 0) {
      console.log(`JOB ${job.id} FAILED:\n  ${lastLines(stderr)}`);
      return finish(job, { status: "error", error: friendlyError(stderr) }, 120_000);
    }

    const output = findOutputFile(job);
    if (!output) {
      // yt-dlp exits successfully when a match filter or size limit skips the video
      return finish(job, { status: "error", error: friendlyError(stderr || "does not pass filter") }, 120_000);
    }

    job.file = path.join(job.dir, output.name);
    finish(job, {
      status: "done",
      message: "Ready",
      percent: 100,
      speed: "",
      eta: "",
      filename: output.name
    }, CONFIG.fileTtlMs);
  } catch (err) {
    console.log(`JOB ${job.id} ERROR:`, err);
    if (!job.cancelled) {
      finish(job, { status: "error", error: "Something went wrong on the server." }, 120_000);
    }
  } finally {
    activeJobs--;
    startNext();
  }
}

// remove expired jobs and their files
setInterval(() => {
  const now = Date.now();
  for (const job of jobs.values()) {
    if (job.expiresAt && job.expiresAt <= now) removeJob(job);
  }
}, 60_000).unref();

// =========================
// APP
// =========================
const app = express();

app.disable("x-powered-by");
app.set("trust proxy", CONFIG.trustProxy === "true" ? true : CONFIG.trustProxy === "false" ? false : CONFIG.trustProxy);
app.use(express.json({ limit: "10kb" }));

app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY"
  });
  next();
});

// serve frontend
app.use(express.static(path.join(__dirname, "public")));

// =========================
// HEALTH
// =========================
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    ytdlp: ytdlpVersion,
    ffmpeg: Boolean(ffmpegVersion),
    cookies: Boolean(cookiesPath),
    proxy: Boolean(CONFIG.proxy),
    warp: warp.enabled
      ? { connected: warp.connected, ip: warp.ip, checkedAt: warp.checkedAt }
      : "off",
    activeJobs,
    queuedJobs: queue.length
  });
});

// =========================
// GET FORMATS
// =========================
app.post("/api/formats", rateLimit(CONFIG.infoRateLimit, CONFIG.rateWindowMs), async (req, res) => {
  const url = validateUrl(req.body?.url);

  if (!url) {
    return res.status(400).json({ error: "Please paste a valid YouTube, Instagram or Facebook link." });
  }

  const { code, stdout, stderr, timedOut } = await runYtdlp(
    url,
    ["-J", "--flat-playlist"],
    { timeoutMs: CONFIG.infoTimeoutMs, collect: true }
  ).done;

  if (timedOut) {
    return res.status(504).json({ error: "The video site took too long to respond. Please try again." });
  }

  if (code !== 0 || !stdout) {
    console.log(`FORMATS FAILED:\n  ${lastLines(stderr)}`);
    return res.status(502).json({ error: friendlyError(stderr) });
  }

  let info;
  try {
    info = JSON.parse(stdout);
  } catch (err) {
    console.log("PARSE ERROR:", err.message);
    return res.status(502).json({ error: "Couldn't read this video's details." });
  }

  if (info._type === "playlist") {
    return res.status(400).json({ error: "Playlists aren't supported. Please paste a single video link." });
  }

  if (info.is_live) {
    return res.status(400).json({ error: "Live streams can't be downloaded." });
  }

  if (info.duration && info.duration > CONFIG.maxDurationSec) {
    return res.status(400).json({
      error: `Videos longer than ${CONFIG.maxDurationSec / 60} minutes aren't supported.`
    });
  }

  const heights = [...new Set(
    (info.formats || [])
      .filter(f => f.height && f.vcodec !== "none" && f.height <= CONFIG.maxHeight)
      .map(f => f.height)
  )].sort((a, b) => b - a);

  res.json({
    title: info.title || "Video",
    thumbnail: info.thumbnail || "",
    duration: info.duration || 0,
    formats: heights.length
      ? heights.map(h => ({ quality: h + "p" }))
      : [{ quality: "best" }]
  });
});

// =========================
// START DOWNLOAD JOB
// =========================
app.post("/api/download", rateLimit(CONFIG.downloadRateLimit, CONFIG.rateWindowMs), (req, res) => {
  const url = validateUrl(req.body?.url);
  const type = req.body?.type === "audio" ? "audio" : "video";
  const quality = parseQuality(type, req.body?.quality);

  if (!url) {
    return res.status(400).json({ error: "Please paste a valid YouTube, Instagram or Facebook link." });
  }

  if (!quality) {
    return res.status(400).json({ error: "Please choose a valid quality." });
  }

  const running = [...jobs.values()].filter(j => j.ip === req.ip && !FINISHED.has(j.status));
  if (running.length >= CONFIG.maxJobsPerIp) {
    return res.status(429).json({ error: "You already have downloads in progress. Please wait for them to finish." });
  }

  if (queue.length >= CONFIG.maxQueuedJobs) {
    return res.status(503).json({ error: "The server is busy right now. Please try again in a few minutes." });
  }

  const id = crypto.randomUUID();
  const job = {
    id,
    url,
    type,
    quality,
    ip: req.ip,
    dir: path.join(CONFIG.tmpRoot, id),
    status: "queued",
    message: "Waiting in queue…",
    percent: 0,
    speed: "",
    eta: "",
    part: 0,
    listeners: new Set()
  };

  jobs.set(id, job);
  queue.push(job);
  scheduleAbandon(job);
  startNext();

  res.status(202).json(publicJob(job));
});

// =========================
// JOB STATUS / PROGRESS / FILE
// =========================
app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Download not found or expired." });
  res.json(publicJob(job));
});

// live progress via Server-Sent Events
app.get("/api/jobs/:id/events", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Download not found or expired." });

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.flushHeaders();
  res.write("retry: 3000\n\n");
  res.write(`data: ${JSON.stringify(publicJob(job))}\n\n`);

  if (FINISHED.has(job.status)) return res.end();

  job.listeners.add(res);
  clearTimeout(job.abandonTimer);

  // keep proxies from closing an idle connection
  const ping = setInterval(() => res.write(": ping\n\n"), 15_000);

  req.on("close", () => {
    clearInterval(ping);
    job.listeners.delete(res);
    if (!job.listeners.size && !FINISHED.has(job.status)) scheduleAbandon(job);
  });
});

app.post("/api/jobs/:id/cancel", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Download not found or expired." });
  cancelJob(job);
  res.json(publicJob(job));
});

app.get("/api/jobs/:id/file", (req, res) => {
  const job = jobs.get(req.params.id);

  if (!job || job.status !== "done" || !job.file || !fs.existsSync(job.file)) {
    return res.status(404).send("This download has expired. Please go back and download it again.");
  }

  res.download(job.file, job.filename, err => {
    // keep the file briefly so an interrupted download can be retried
    if (!err) job.expiresAt = Math.min(job.expiresAt, Date.now() + 2 * 60_000);
  });
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found" });
});

// =========================
// FALLBACK
// =========================
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed" || err.type === "entity.too.large") {
    return res.status(400).json({ error: "Invalid request." });
  }
  console.log("SERVER ERROR:", err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

// =========================
// START
// =========================
const server = app.listen(CONFIG.port, () => {
  console.log(`Server running on port ${CONFIG.port}`);
});

function shutdown() {
  console.log("Shutting down…");
  [...jobs.values()].forEach(removeJob);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
