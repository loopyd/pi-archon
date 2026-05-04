import * as fs from "node:fs";

export function readPidFile(pidFile: string): string | undefined {
  if (!fs.existsSync(pidFile)) return undefined;
  const pid = fs.readFileSync(pidFile, "utf8").trim();
  return /^\d+$/.test(pid) ? pid : undefined;
}

export function readLogTail(logFile: string, maxLines = 60): string {
  if (!fs.existsSync(logFile)) return "";
  return fs.readFileSync(logFile, "utf8").split(/\r?\n/).slice(-maxLines).join("\n").trim();
}

export async function isHttpReachable(url: string, timeoutMs = 5000, ok: (status: number) => boolean = (status) => status >= 200 && status < 300): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return ok(response.status);
  } catch {
    return false;
  }
}

export function isPidRunning(pid: string): boolean {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch {
    return false;
  }
}
