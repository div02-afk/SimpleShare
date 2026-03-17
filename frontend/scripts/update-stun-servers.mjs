import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SOURCE_URL =
  "https://gist.githubusercontent.com/mondain/b0ec1cf5f60ae726202e/raw/public-stun-list.txt";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendDirectory = path.resolve(scriptDirectory, "..");
const utilsDirectory = path.join(frontendDirectory, "src", "utils");
const serversTextPath = path.join(utilsDirectory, "servers.txt");
const serversJsonPath = path.join(utilsDirectory, "servers.json");

function getArgumentValue(argumentsList, name) {
  const prefix = `${name}=`;
  const match = argumentsList.find((argument) => argument.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function normalizeServerEntries(fileContents) {
  const seen = new Set();
  const normalizedServers = [];

  for (const rawLine of fileContents.split(/\r?\n/u)) {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const [candidate] = trimmedLine.split(/\s+/u);
    if (!candidate) {
      continue;
    }

    if (/^turns?:/iu.test(candidate)) {
      continue;
    }

    const normalizedServer = candidate.replace(/^stun:/iu, "");
    if (!normalizedServer || seen.has(normalizedServer)) {
      continue;
    }

    seen.add(normalizedServer);
    normalizedServers.push(normalizedServer);
  }

  return normalizedServers;
}

async function loadSource({ sourceFilePath, sourceUrl }) {
  if (sourceFilePath) {
    return readFile(sourceFilePath, "utf8");
  }

  const response = await fetch(sourceUrl, {
    headers: {
      "user-agent": "SimpleShare STUN updater",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch STUN source: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function buildServersJson(servers) {
  const entries = servers.map((server) => `  { "urls": "stun:${server}" }`);
  return `[\n${entries.join(",\n")}\n]\n`;
}

async function readCurrentFile(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

async function writeIfChanged(filePath, nextContents) {
  const currentContents = await readCurrentFile(filePath);
  if (currentContents === nextContents) {
    return false;
  }

  await writeFile(filePath, nextContents, "utf8");
  return true;
}

async function main() {
  const argumentsList = process.argv.slice(2);
  const checkOnly = argumentsList.includes("--check");
  const sourceFileArgument = getArgumentValue(argumentsList, "--source-file");
  const sourceUrlArgument = getArgumentValue(argumentsList, "--source-url");
  const environmentSourceFile = process.env.STUN_SOURCE_FILE?.trim();
  const environmentSourceUrl = process.env.STUN_SOURCE_URL?.trim();

  const sourceFilePath = environmentSourceFile
    ? path.resolve(frontendDirectory, environmentSourceFile)
    : sourceFileArgument
      ? path.resolve(frontendDirectory, sourceFileArgument)
      : undefined;
  const sourceUrl = environmentSourceUrl || sourceUrlArgument || DEFAULT_SOURCE_URL;

  const sourceContents = await loadSource({ sourceFilePath, sourceUrl });
  const normalizedServers = normalizeServerEntries(sourceContents);

  if (normalizedServers.length === 0) {
    throw new Error("No STUN servers were produced from the configured source.");
  }

  const nextServersText = `${normalizedServers.join("\n")}\n`;
  const nextServersJson = buildServersJson(normalizedServers);

  const currentServersText = await readCurrentFile(serversTextPath);
  const currentServersJson = await readCurrentFile(serversJsonPath);
  const hasChanges =
    currentServersText !== nextServersText || currentServersJson !== nextServersJson;

  if (checkOnly) {
    if (hasChanges) {
      console.error("STUN server files are out of date.");
      process.exitCode = 1;
      return;
    }

    console.log(`STUN server files are up to date (${normalizedServers.length} entries).`);
    return;
  }

  const textChanged = await writeIfChanged(serversTextPath, nextServersText);
  const jsonChanged = await writeIfChanged(serversJsonPath, nextServersJson);
  const sourceDescription = sourceFilePath ? sourceFilePath : sourceUrl;

  if (!textChanged && !jsonChanged) {
    console.log(`STUN server files already match ${sourceDescription}.`);
    return;
  }

  console.log(
    `Updated STUN server files from ${sourceDescription} with ${normalizedServers.length} entries.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
