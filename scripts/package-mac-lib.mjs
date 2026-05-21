import { createRequire } from "node:module";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const { packager } = require("@electron/packager");

export async function preparePackagedAppStaging(options) {
  const rootDir = options.rootDir;
  const stagingDir = options.stagingDir;
  const appResourcesPath = join(stagingDir, "resources");

  await rm(stagingDir, { force: true, recursive: true });
  await mkdir(appResourcesPath, { recursive: true });

  await cp(join(rootDir, "dist", "electron-app", "main.cjs"), join(stagingDir, "main.cjs"));
  await cp(join(rootDir, "src", "electron", "packagedDaemon.cjs"), join(stagingDir, "packagedDaemon.cjs"));
  await cp(join(rootDir, "dist", "app-js"), join(appResourcesPath, "dist", "app-js"), { recursive: true });
  await cp(join(rootDir, "dist", "renderer"), join(appResourcesPath, "dist", "renderer"), { recursive: true });
  await cp(join(rootDir, "scripts", "key-activity.swift"), join(appResourcesPath, "scripts", "key-activity.swift"));
  await cp(join(rootDir, "config"), join(appResourcesPath, "config"), { recursive: true });
  await cp(join(rootDir, "pnpm-lock.yaml"), join(stagingDir, "pnpm-lock.yaml"));

  const rootPackage = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8"));
  const runtimeDependencies = pickRuntimeDependencies(rootPackage.dependencies);
  await writeFile(
    join(stagingDir, "package.json"),
    JSON.stringify(
      {
        name: rootPackage.name,
        version: rootPackage.version,
        type: "module",
        main: "main.cjs",
        dependencies: runtimeDependencies
      },
      null,
      2
    ),
    "utf8"
  );

  if (options.installDependencies !== false) {
    await execFileAsync("pnpm", ["install", "--prod", "--no-frozen-lockfile", "--ignore-scripts"], {
      cwd: stagingDir,
      env: {
        ...process.env,
        npm_config_update_notifier: "false"
      }
    });
  }

  return { appResourcesPath, stagingDir };
}

function pickRuntimeDependencies(allDependencies) {
  const runtimeNames = ["active-win"];
  const runtimeDependencies = {};

  for (const name of runtimeNames) {
    const version = allDependencies?.[name];
    if (typeof version === "string" && version.trim()) {
      runtimeDependencies[name] = version;
    }
  }

  return runtimeDependencies;
}

export async function packageMacApp(options) {
  const root = options.rootDir;
  const releaseRoot = join(root, "release");
  const releaseDir = join(releaseRoot, "mac");
  const stagingDir = join(root, "dist", "package-app");
  const appName = "Termial Combo";
  const appPath = join(releaseDir, `${appName}.app`);
  const zipPath = join(releaseDir, `${appName}-mac-unsigned.zip`);

  await rm(releaseDir, { force: true, recursive: true });
  await rm(stagingDir, { force: true, recursive: true });

  await preparePackagedAppStaging({
    rootDir: root,
    stagingDir,
    installDependencies: options.installDependencies
  });

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

  return { appPath, zipPath };
}

async function findGeneratedAppPath(generatedPath) {
  if (generatedPath.endsWith(".app")) return generatedPath;
  const entries = await readdir(generatedPath);
  const appEntry = entries.find((entry) => entry.endsWith(".app"));
  if (!appEntry) throw new Error(`No .app bundle found in ${generatedPath}`);
  return join(generatedPath, appEntry);
}
