// Generates the Android (Trusted Web Activity) project from the live web app manifest.
// Usage: node android/generate.mjs [https://clipfetch.onrender.com]
// Re-run after changing the manifest or icons, then build with build.ps1 / bubblewrap build.

import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// use the core library that ships with the globally installed Bubblewrap CLI
const npmRoot = execSync("npm root -g").toString().trim();
const core = require(path.join(npmRoot, "@bubblewrap/cli/node_modules/@bubblewrap/core"));
const { TwaManifest, TwaGenerator, ConsoleLog } = core;

const site = new URL(process.argv[2] || "https://clipfetch.onrender.com");
const manifestUrl = new URL("/manifest.webmanifest", site);

const twa = await TwaManifest.fromWebManifest(manifestUrl.href);

twa.packageId = "com.akbarmujahid.clipfetch";
twa.name = "ClipFetch";
twa.launcherName = "ClipFetch";
twa.appVersionCode = 1;
twa.appVersionName = "1.0.0";
twa.signingKey = { path: path.join(here, "clipfetch-release.keystore"), alias: "clipfetch" };
twa.enableNotifications = false;
// if Chrome isn't installed, open in a custom tab instead of failing
twa.fallbackType = "customtabs";

const manifestFile = path.join(here, "twa-manifest.json");
await twa.saveToFile(manifestFile);
console.log("Wrote", manifestFile);

await new TwaGenerator().createTwaProject(here, twa, new ConsoleLog("generate"));
console.log("Android project generated in", here);
