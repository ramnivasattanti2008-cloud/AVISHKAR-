/**
 * Starts the real Python engine as a child process for integration tests (no mocks). Skipped, with the reason, when Python or
 * the engine's packages are not available, unless REQUIRE_ENGINE=1 (CI sets it), in which case it fails loudly instead.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ENGINE_DIR = path.resolve(here, "../../engine");
export const REPO_ROOT = path.resolve(here, "../../..");

export function pythonPath(): string | null {
  const candidates = [process.env.ENGINE_PYTHON, path.join(REPO_ROOT, ".venv", "Scripts", "python.exe"), path.join(REPO_ROOT, ".venv", "bin", "python"), "python3", "python"].filter((c): c is string => Boolean(c));
  for (const c of candidates) {
    if (c.includes(path.sep) && !existsSync(c)) continue;
    const r = spawnSync(c, ["-c", "import fastapi, scipy, highspy, pydantic, pvlib, sklearn, pandas"], { encoding: "utf8" });
    if (r.status === 0) return c;
  }
  return null;
}

export const required = process.env.REQUIRE_ENGINE === "1";
export const python = pythonPath();
/** True when the real-engine tests should run. If it is required but missing, tests fail rather than skip. */
export const engineAvailable = python !== null || required;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

export interface RunningEngine {
  url: string;
  key: string;
  stop(): Promise<void>;
}

export async function startEngine(key = "integration-test-key-0123456789"): Promise<RunningEngine> {
  if (!python) throw new Error("REQUIRE_ENGINE=1 but no Python with fastapi, scipy and highspy was found (set ENGINE_PYTHON).");
  const port = await freePort();
  const child: ChildProcess = spawn(python, ["-m", "uvicorn", "avishkar_engine.app:create_app", "--factory", "--host", "127.0.0.1", "--port", String(port), "--log-level", "warning"], {
    cwd: ENGINE_DIR,
    env: { ...process.env, ENGINE_API_KEY: key, PYTHONUTF8: "1", PYTHONPATH: ENGINE_DIR },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (d) => (output += d));
  child.stderr?.on("data", (d) => (output += d));
  let exited = false;
  child.on("exit", () => (exited = true));

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`The engine process exited during start-up:\n${output}`);
    try {
      const r = await fetch(`${url}/health`);
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (Date.now() >= deadline) {
    child.kill();
    throw new Error(`The engine did not come up in 40 s:\n${output}`);
  }
  return {
    url,
    key,
    async stop() {
      if (exited) return;
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.kill();
        setTimeout(resolve, 3_000);
      });
    },
  };
}
