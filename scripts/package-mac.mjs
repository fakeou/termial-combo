import { createRequire } from "node:module";
import { cp, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const { packager } = require("@electron/packager");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = join(root, "release");
const releaseDir = join(releaseRoot, "mac");
const stagingDir = join(root, "dist", "package-app");
const appName = "Termial Combo";
const appPath = join(releaseDir, `${appName}.app`);
const appResourcesPath = join(stagingDir, "resources");
const zipPath = join(releaseDir, `${appName}-mac-unsigned.zip`);

await rm(releaseDir, { force: true, recursive: true });
await rm(stagingDir, { force: true, recursive: true });
await mkdir(appResourcesPath, { recursive: true });

await cp(join(root, "dist", "electron-app", "main.cjs"), join(stagingDir, "main.cjs"));
await cp(join(root, "src", "electron", "packagedDaemon.cjs"), join(stagingDir, "packagedDaemon.cjs"));
await cp(join(root, "dist", "app-js"), join(appResourcesPath, "dist", "app-js"), { recursive: true });
await cp(join(root, "dist", "renderer"), join(appResourcesPath, "dist", "renderer"), { recursive: true });
await cp(join(root, "scripts", "key-activity.swift"), join(appResourcesPath, "scripts", "key-activity.swift"));
await cp(join(root, "config"), join(appResourcesPath, "config"), { recursive: true });
await writeFile(
  join(stagingDir, "package.json"),
  JSON.stringify({ name: "termial-combo", version: "0.1.0", main: "main.cjs" }, null, 2),
  "utf8"
);

const [generatedPath] = await packager({
  dir: stagingDir,
  out: releaseDir,
  name: appName,
  platform: "darwin",
  arch: process.arch === "arm64" ? "arm64" : "x64",
  overwrite: true,
  asar: false,
  appBundleId: "local.termial-combo",
  appVersion: "0.1.0",
  buildVersion: "0.1.0",
  darwinDarkModeSupport: true,
  extendInfo: {
    LSMinimumSystemVersion: "12.0",
    NSAppleEventsUsageDescription: "Termial Combo uses accessibility and input monitoring to detect Warp activity and keyboard commits."
  }
});

const generatedAppPath = await findGeneratedAppPath(generatedPath);
if (generatedAppPath !== appPath) {
  await rm(appPath, { force: true, recursive: true });
  await rename(generatedAppPath, appPath);
  await rm(generatedPath, { force: true, recursive: true });
}

await execFileAsync("zip", ["-qry", zipPath, `${appName}.app`], { cwd: releaseDir });

console.log(`Created ${appPath}`);
console.log(`Created ${zipPath}`);

async function findGeneratedAppPath(generatedPath) {
  if (generatedPath.endsWith(".app")) return generatedPath;
  const entries = await readdir(generatedPath);
  const appEntry = entries.find((entry) => entry.endsWith(".app"));
  if (!appEntry) throw new Error(`No .app bundle found in ${generatedPath}`);
  return join(generatedPath, appEntry);
}
