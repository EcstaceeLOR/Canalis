import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const tracked = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

const textExtensions = new Set([
  ".cjs",
  ".css",
  ".env",
  ".example",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const privateKeyBlock = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const suspiciousAssignment =
  /\b(?:private[_-]?key|secret[_-]?key|seed[_-]?phrase|mnemonic)\b\s*[:=]\s*["']?(?!\.\.\.|<|\$|process\.env)([A-Za-z0-9+/_=-]{20,})/i;
const rawSolanaSecretArray = /\b(?:secretKey|privateKey)\b[^\n]{0,40}\[(?:\s*\d{1,3}\s*,){31,}/i;

const findings = [];

for (const path of tracked) {
  let stats;
  try {
    stats = statSync(path);
  } catch {
    continue;
  }
  if (!stats.isFile() || stats.size > 1_000_000) continue;

  const lastDot = path.lastIndexOf(".");
  const extension = lastDot >= 0 ? path.slice(lastDot) : "";
  if (!textExtensions.has(extension) && !path.endsWith(".env.example")) continue;

  let contents;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    continue;
  }

  const patterns = [
    ["private-key PEM block", privateKeyBlock],
    ["suspicious secret assignment", suspiciousAssignment],
    ["raw Solana secret-key array", rawSolanaSecretArray],
  ];

  for (const [label, pattern] of patterns) {
    if (pattern.test(contents)) findings.push(`${path}: ${label}`);
  }
}

if (findings.length > 0) {
  console.error("Potential committed secret material detected:\n");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Secret check passed across ${tracked.length} tracked files.`);
