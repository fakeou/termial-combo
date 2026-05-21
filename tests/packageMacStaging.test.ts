import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
// @ts-expect-error The packaging helper is a Node ESM script consumed directly by this integration-style test.
import { preparePackagedAppStaging } from "../scripts/package-mac-lib.mjs";

describe("preparePackagedAppStaging", () => {
  it("writes the root package manifest and lockfile into the staging dir", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "package-mac-root-"));
    const stagingDir = await mkdtemp(join(tmpdir(), "package-mac-staging-"));

    await mkdir(join(rootDir, "dist", "electron-app"), { recursive: true });
    await mkdir(join(rootDir, "dist", "app-js", "cli"), { recursive: true });
    await mkdir(join(rootDir, "dist", "renderer"), { recursive: true });
    await mkdir(join(rootDir, "scripts"), { recursive: true });
    await mkdir(join(rootDir, "config"), { recursive: true });
    await mkdir(join(rootDir, "src", "electron"), { recursive: true });
    await writeFile(join(rootDir, "dist", "electron-app", "main.cjs"), "module.exports = {};", "utf8");
    await writeFile(join(rootDir, "src", "electron", "packagedDaemon.cjs"), "module.exports = {};", "utf8");
    await writeFile(join(rootDir, "dist", "app-js", "cli", "daemon.js"), "console.log('daemon');", "utf8");
    await writeFile(join(rootDir, "dist", "renderer", "index.html"), "<!doctype html><title>test</title>", "utf8");
    await writeFile(join(rootDir, "scripts", "key-activity.swift"), "print(\"ok\")", "utf8");
    await writeFile(join(rootDir, "config", "sticker-rules.json"), "[]", "utf8");
    await writeFile(
      join(rootDir, "package.json"),
      JSON.stringify(
        {
          name: "termial-combo",
          version: "0.1.0",
          dependencies: {
            "active-win": "^9.0.0"
          },
          devDependencies: {
            "@vitejs/plugin-react": "^6.0.1"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await writeFile(join(rootDir, "pnpm-lock.yaml"), "lockfileVersion: '1'\n", "utf8");

    await preparePackagedAppStaging({
      rootDir,
      stagingDir,
      installDependencies: false
    });

    const packageJson = JSON.parse(await readFile(join(stagingDir, "package.json"), "utf8")) as {
      main?: string;
      type?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.main).toBe("main.cjs");
    expect(packageJson.type).toBe("module");
    expect(packageJson.dependencies?.["active-win"]).toBeDefined();
    expect(packageJson.devDependencies).toBeUndefined();
    expect((await stat(join(stagingDir, "pnpm-lock.yaml"))).isFile()).toBe(true);
  });
});
