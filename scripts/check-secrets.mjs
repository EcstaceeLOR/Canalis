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
const knownToken = /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{32,})\b/;
const environmentDump = /console\.(?:log|info|debug|warn|error)\([^\n]*(?:process\.env|import\.meta\.env)/i;
const sensitiveLogging = /console\.(?:log|info|debug|warn|error)\([^\n]*\b(?:credential|secretKey|privateKey|signatureBase64|paymentPayload|mnemonic|seedPhrase)\b/i;

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
    ["known credential/token format", knownToken],
    ["environment dump in application logs", environmentDump],
    ["sensitive material passed to application logs", sensitiveLogging],
  ];

  for (const [label, pattern] of patterns) {
    if (pattern.test(contents)) findings.push(`${path}: ${label}`);
  }
}

if (findings.length > 0) {
  console.error("Potential committed secret material or unsafe secret logging detected:\n");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Secret check passed across ${tracked.length} tracked files.`);
