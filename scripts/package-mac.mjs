import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packageMacApp } from "./package-mac-lib.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const { appPath, zipPath } = await packageMacApp({ rootDir: root });

console.log(`Created ${appPath}`);
console.log(`Created ${zipPath}`);
