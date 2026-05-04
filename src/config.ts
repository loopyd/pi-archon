import * as fs from "node:fs";
import { ARCHON_DEFAULT_HOME, ARCHON_ENDPOINT_CONFIG_NAMES, ARCHON_ROOT, DEFAULT_ARCHON_ENDPOINTS } from "./constants";
import type { ArchonEndpointConfig } from "./types";
import { maybeString, normalizeString } from "./helpers";

function parseScalarYamlValue(value: string): string | undefined {
  const trimmed = normalizeString(value.split("#")[0] ?? "");
  return trimmed.length > 0 ? trimmed : undefined;
}

function readArchonEndpointConfigFile(path: string): Partial<ArchonEndpointConfig> {
  if (!fs.existsSync(path)) return {};
  const lines = fs.readFileSync(path, "utf8").split(/\r?\n/);
  const config: Partial<ArchonEndpointConfig> = {};
  let section: "archon" | "endpoints" | undefined;

  for (const rawLine of lines) {
    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const sectionMatch = line.match(/^([A-Za-z0-9_-]+):\s*$/);
    if (sectionMatch) {
      section = indent === 0 && sectionMatch[1] === "archon" ? "archon" : section === "archon" && indent > 0 && sectionMatch[1] === "endpoints" ? "endpoints" : undefined;
      continue;
    }
    const valueMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (!valueMatch) continue;
    const value = parseScalarYamlValue(valueMatch[2]);
    if (!value) continue;
    const key = valueMatch[1];
    if (section === "endpoints") {
      if (key === "host") config.host = value;
      if (key === "serverPort") config.serverPort = value;
      if (key === "webPort") config.webPort = value;
      continue;
    }
    if (key === "archonHost") config.host = value;
    if (key === "archonServerPort") config.serverPort = value;
    if (key === "archonWebPort") config.webPort = value;
  }
  return config;
}

export function resolveArchonEndpointConfig(projectCwd?: string): ArchonEndpointConfig {
  const home = process.env.HOME || process.cwd();
  const files = [
    ...ARCHON_ENDPOINT_CONFIG_NAMES.map((name) => `${home}/${name}`),
    ...(projectCwd ? ARCHON_ENDPOINT_CONFIG_NAMES.map((name) => `${projectCwd}/${name}`) : []),
  ];
  return files.reduce((config, path) => ({ ...config, ...readArchonEndpointConfigFile(path) }), { ...DEFAULT_ARCHON_ENDPOINTS });
}

export function getArchonServerUrl(projectCwd?: string): string {
  const { host, serverPort } = resolveArchonEndpointConfig(projectCwd);
  return `http://${host}:${serverPort}`;
}

export function getArchonWebUrl(projectCwd?: string, port?: string): string {
  const { host, webPort } = resolveArchonEndpointConfig(projectCwd);
  return `http://${host}:${port || webPort}/`;
}

export function resolveProjectArchonAssistant(projectCwd: string): string | undefined {
  const configPath = `${projectCwd}/.archon/config.yaml`;
  if (!fs.existsSync(configPath)) return undefined;
  const raw = fs.readFileSync(configPath, "utf8").split(/\r?\n/);
  for (const line of raw) {
    for (const key of ["assistant", "provider"]) {
      const match = line.match(new RegExp(`^${key}:\\s*([^#\\s]+)`));
      if (match?.[1]) return match[1].trim();
    }
  }
  return undefined;
}

export function resolveArchonHome(projectCwd?: string): string {
  if (projectCwd) {
    const projectArchon = `${projectCwd}/.archon`;
    if (fs.existsSync(projectArchon)) return projectArchon;
  }
  const envPath = `${ARCHON_ROOT}/.env`;
  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, "utf8");
    const match = raw.match(/^ARCHON_HOME=(.+)$/m);
    const value = maybeString(match?.[1]);
    if (value) return value;
  }
  return maybeString(process.env.ARCHON_HOME) ?? ARCHON_DEFAULT_HOME;
}
