import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const failures = [];
const requireText = (content, needle, label) => {
  if (!content.includes(needle)) failures.push(`${label}: missing ${needle}`);
};
const requireFile = (path) => {
  if (!existsSync(new URL(`../${path}`, import.meta.url))) failures.push(`missing file: ${path}`);
};

const page = read("apps/web/src/app/page.tsx");
const layout = read("apps/web/src/app/layout.tsx");
const release = read("apps/web/src/lib/release.ts");
const onboarding = read("apps/web/src/components/product/onboarding-workspace.tsx");
const health = read("apps/web/src/app/api/health/route.ts");
const readme = read("README.md");

requireText(page, 'href="/onboarding"', "landing");
requireText(page, "Real Solana devnet evidence", "landing");
requireText(page, "Intentionally blocked", "landing");
requireText(page, "non-custodial signer/session runtime", "landing");
if (page.includes("/tasks/demo")) failures.push("landing: demo-only /tasks/demo CTA returned");

requireText(layout, "metadataBase", "metadata");
requireText(layout, "openGraph", "metadata");
requireText(layout, "twitter", "metadata");
requireText(release, "https://canalis-sigma.vercel.app", "release metadata");
requireText(health, 'durableStorage ? "configured" : "not-configured"', "health endpoint");

requireText(onboarding, "runtime-ready provider", "onboarding");
requireText(onboarding, "Create a reusable spending policy", "onboarding");
requireText(onboarding, "Create your first governed task", "onboarding");
requireText(onboarding, "mainnet-capable non-custodial signer/runtime", "onboarding");

for (const path of [
  "apps/web/src/app/(product)/onboarding/page.tsx",
  "apps/web/src/app/api/onboarding/route.ts",
  "apps/web/src/app/robots.ts",
  "apps/web/src/app/sitemap.ts",
  "apps/web/src/app/manifest.ts",
  "apps/web/src/app/opengraph-image.tsx",
]) requireFile(path);

requireText(readme, "https://canalis-sigma.vercel.app", "README");
if (readme.includes("canalis-git-deploy-web-standalone-demola-codes.vercel.app")) {
  failures.push("README: stale branch-style Vercel URL returned");
}

if (failures.length) {
  console.error("Public product contract check failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log("Public product contract check passed.");
