# 🎬 ClipFetch

ClipFetch is a simple and powerful video downloader web app that allows users to download videos from platforms like YouTube, Instagram, and Facebook in different qualities, or as MP3 audio.

Built with a clean UI and a Node.js backend using yt-dlp, it provides a smooth and fast downloading experience — locally or deployed for free on Render.

---

## 🚀 Features

* 🎥 Download videos in multiple qualities (MP4)
* 🎵 Download audio as MP3 (320 / 256 / 128 kbps)
* 🌐 Supports YouTube, Instagram, Facebook links
* 📊 Live download progress with speed, ETA and cancel button
* ⚡ Fast and lightweight backend using yt-dlp
* 🎨 Modern UI with animations and dark/light mode
* 🖼 Thumbnail preview before download
* 📜 Download history with re-download option
* 📱 Responsive design (works on mobile & desktop)
* 🛡 Safe for public hosting: URL validation, rate limits, download queue, size/length limits, automatic cleanup

---

## 🛠 Tech Stack

* Frontend: HTML, CSS, JavaScript
* Backend: Node.js (Express)
* Video Processing: yt-dlp (Python) + FFmpeg
* Deployment: Docker on Render
* Styling: Custom CSS + Font Awesome

---

## 📁 Project Structure

```
ClipFetch/
├── public/
│   ├── index.html      # frontend (UI + JavaScript)
│   └── logo.png
├── server.js           # Express backend
├── package.json
├── Dockerfile          # image with Node, Python, yt-dlp and FFmpeg
├── render.yaml         # Render Blueprint (one-click deploy)
└── .dockerignore
```

---

## ⚙️ How it works

1. `POST /api/formats` — reads the video's title, thumbnail and available qualities.
2. `POST /api/download` — starts a download **job** on the server and returns its id.
3. `GET /api/jobs/:id/events` — streams live progress (Server-Sent Events).
4. `GET /api/jobs/:id/file` — sends the finished file to the browser.

Each job downloads into its own temporary folder, which is deleted automatically after the file is sent (or after 15 minutes). This job-based flow avoids the request timeouts that hosting platforms apply to long-running requests.

`GET /health` reports the server status (used by Render's health check).

---

## 💻 Run Locally

Requirements: **Node.js 20+**, **Python 3.9+**, **FFmpeg** (on your PATH).

```
git clone https://github.com/AkbarMujahid/ClipFetch.git
cd ClipFetch
npm install
pip install -U "yt-dlp[default]"
npm start
```

Then open http://localhost:3000

> Keep yt-dlp updated (`pip install -U "yt-dlp[default]"`). YouTube changes often, and an old yt-dlp version is the most common cause of "HTTP Error 403" or failed downloads.

Or run it with Docker:

```
docker build -t clipfetch .
docker run -p 3000:3000 clipfetch
```

---

## ☁️ Deploy to Render (free)

1. Push this repository to GitHub.
2. Sign in to [Render](https://render.com) and choose **New → Blueprint**.
3. Select your ClipFetch repository. Render reads `render.yaml` and creates a free Docker web service.
4. Click **Apply** and wait for the build (first build takes a few minutes).
5. Open the `https://clipfetch-xxxx.onrender.com` URL Render gives you.

Every push to the connected branch redeploys automatically.

**About the free plan:**

* The service **sleeps after 15 minutes without visitors**. The first visit after that takes about 30–60 seconds while it wakes up (the app shows "Waking up server...").
* It has very little CPU and memory, so `render.yaml` runs one download at a time (others wait in a queue), limits quality to 1080p, videos to 30 minutes and files to 300 MB.
* The disk is temporary; that's fine, because files are only kept until they are downloaded.

### YouTube on Render

YouTube often blocks requests from cloud servers ("Sign in to confirm you're not a bot"). Instagram and Facebook usually work fine. If YouTube downloads fail on Render, you can give yt-dlp browser cookies:

1. Create a **separate, throwaway Google account** (the account can get flagged — don't use your main one).
2. Log in to YouTube with it and export cookies in Netscape format using a "cookies.txt" browser extension.
3. In Render, open your service → **Environment → Secret Files** → add a file named `cookies.txt` with the exported content.
4. Redeploy. The server detects `/etc/secrets/cookies.txt` automatically.

Never commit `cookies.txt` to Git (it's already in `.gitignore`).

---

## 🔧 Configuration

All settings are optional environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port to listen on (set automatically by Render) |
| `PYTHON_BIN` | `python3` (`python` on Windows) | Python used to run yt-dlp |
| `MAX_CONCURRENT_JOBS` | `2` | Downloads running at the same time |
| `MAX_QUEUED_JOBS` | `10` | Downloads allowed to wait in the queue |
| `MAX_JOBS_PER_IP` | `2` | Active downloads per visitor |
| `MAX_HEIGHT` | `1080` | Highest video quality offered |
| `MAX_DURATION_MINUTES` | `60` | Longest video allowed |
| `MAX_FILESIZE` | `500M` | Largest file allowed |
| `JOB_TIMEOUT_MINUTES` | `15` | A download is stopped after this long |
| `FILE_TTL_MINUTES` | `15` | Finished files are deleted after this long |
| `RATE_LIMIT_INFO` | `30` | Format lookups per visitor per 10 minutes |
| `RATE_LIMIT_DOWNLOAD` | `10` | Downloads per visitor per 10 minutes |
| `ALLOWED_HOSTS` | YouTube, Instagram, Facebook domains | Comma-separated list of allowed sites |
| `COOKIES_FILE` | `/etc/secrets/cookies.txt` | Cookies file for yt-dlp (used if it exists) |
| `YTDLP_JS_RUNTIMES` | `node` | JavaScript runtime yt-dlp uses for YouTube (empty to disable) |
| `AUTO_UPDATE_YTDLP` | `true` | Docker only: update yt-dlp each time the container starts |
| `TRUST_PROXY` | `true` on Render, else `false` | Express `trust proxy` setting (for correct visitor IPs) |

---

## 📸 Usage

1. Paste a video URL
2. Click **Get Formats**
3. Choose the **Video** or **Audio** tab and a quality
4. Watch the progress bar — the file downloads automatically when ready

---

## ⚠️ Notes

* Downloading content may be against the terms of service of some platforms. Only download videos you have the right to download.
* Playlists and live streams aren't supported — paste a single video link.

---

## 🧠 Future Improvements

* 📱 Convert into Android APK
* ⚡ Improve download speed & caching
* 🔐 Add user authentication

---

## 📄 License

This project is licensed under the MIT License — Akbar Alauddin Mujahid

---

## 🤝 Contributing

Feel free to fork this repository and improve it. Pull requests are welcome!

---

👨‍💻 Author
Akbar Alauddin Mujahid 💼 Web and App Developer and Enthusiast

📧 Mail: akbarmujahid1114@gmail.com

🌐 https://github.com/AkbarMujahid

---

## ⭐ Support

If you like this project, consider giving it a ⭐ on GitHub!
