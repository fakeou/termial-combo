import { getActiveWindowInfo, isWarpWindow } from "../windowDetector.js";

try {
  const info = await getActiveWindowInfo();
  console.log(JSON.stringify({ info, isWarp: info ? isWarpWindow(info) : false }, null, 2));
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        hint: "On macOS, grant Accessibility permission to the terminal app running this command."
      },
      null,
      2
    )
  );
  process.exitCode = 1;
}
