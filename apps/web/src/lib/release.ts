const DEFAULT_CANONICAL_SITE_URL = "https://canalis-sigma.vercel.app";

function normalizeSiteUrl(value: string | undefined): string {
  const candidate = value?.trim() || DEFAULT_CANONICAL_SITE_URL;
  try {
    const url = new URL(candidate.startsWith("http") ? candidate : `https://${candidate}`);
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_CANONICAL_SITE_URL;
  }
}

export const CANONICAL_SITE_URL = normalizeSiteUrl(process.env.CANALIS_SITE_URL);

export type CanalisReleaseMetadata = {
  version: string;
  commit: string | null;
  environment: string;
  canonicalUrl: string;
  deploymentUrl: string | null;
};

export function releaseMetadata(): CanalisReleaseMetadata {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null;
  const version = process.env.CANALIS_RELEASE_VERSION?.trim()
    || (commit ? `git-${commit.slice(0, 7)}` : "development");
  const environment = process.env.VERCEL_ENV?.trim() || process.env.NODE_ENV || "development";
  const deploymentHost = process.env.VERCEL_URL?.trim();

  return {
    version,
    commit,
    environment,
    canonicalUrl: CANONICAL_SITE_URL,
    deploymentUrl: deploymentHost ? normalizeSiteUrl(deploymentHost) : null,
  };
}
