"""Long-running yt-dlp process for format lookups.

Starting Python, importing yt-dlp, detecting the JS runtime and loading
YouTube's player code takes several seconds per run, much more on a small
server. This worker does that once and then answers lookups over stdin/stdout:

    request:  {"id": 1, "url": "...", "args": ["--no-playlist", ...]}
    response: {"id": 1, "ok": true, "info": {...}, "log": "WARNING: ..."}

"args" are normal yt-dlp command-line options, so the server can build them
the same way for this worker and for the yt-dlp command used for downloads.
"""

import json
import sys

import yt_dlp

# keep stdout for responses only; anything yt-dlp prints goes to stderr
OUT = sys.stdout
sys.stdout = sys.stderr

MAX_INSTANCES = 3


class LogCollector:
    """Collects warnings and errors so the server can explain failures."""

    def __init__(self):
        self.lines = []

    def debug(self, msg):
        pass

    def info(self, msg):
        pass

    def warning(self, msg):
        self.lines.append("WARNING: " + msg)

    def error(self, msg):
        self.lines.append(msg)


# one YoutubeDL per distinct set of options (e.g. with and without a proxy),
# reused so extractor caches such as YouTube's player code stay in memory
instances = {}


def get_ydl(args):
    key = json.dumps(args)
    ydl = instances.get(key)

    if ydl is None:
        if len(instances) >= MAX_INSTANCES:
            oldest = next(iter(instances))
            instances.pop(oldest).close()

        opts = yt_dlp.parse_options(args).ydl_opts
        opts["quiet"] = True
        opts["logger"] = LogCollector()
        ydl = yt_dlp.YoutubeDL(opts)
        instances[key] = ydl

    return ydl


def handle(request):
    log = LogCollector()
    reply = {"id": request.get("id")}

    try:
        ydl = get_ydl(request["args"])
        ydl.params["logger"] = log
        info = ydl.extract_info(request["url"], download=False)
        reply["ok"] = True
        reply["info"] = ydl.sanitize_info(info)
    except Exception as err:  # yt-dlp's DownloadError and anything unexpected
        if not any(line.startswith("ERROR") for line in log.lines):
            log.lines.append(f"ERROR: {err}")
        reply["ok"] = False

    reply["log"] = "\n".join(log.lines)
    return reply


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue

    try:
        reply = handle(json.loads(line))
    except Exception as err:
        reply = {"id": None, "ok": False, "log": f"ERROR: bad request: {err}"}

    OUT.write(json.dumps(reply) + "\n")
    OUT.flush()
