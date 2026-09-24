const USDC_DECIMALS = 6n;
const USDC_SCALE = 10n ** USDC_DECIMALS;

export function parseUsdc(value: string): bigint {
  const normalized = value.trim();
  const match = /^(\d+)(?:\.(\d{0,6}))?$/.exec(normalized);
  if (!match) {
    throw new Error("Enter a valid USDC amount with at most 6 decimals.");
  }

  const whole = BigInt(match[1] ?? "0");
  const fraction = (match[2] ?? "").padEnd(Number(USDC_DECIMALS), "0");
  return whole * USDC_SCALE + BigInt(fraction || "0");
}

export function formatUsdcAtomic(value: bigint, maxFractionDigits = 2): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / USDC_SCALE;
  const fraction = (absolute % USDC_SCALE)
    .toString()
    .padStart(Number(USDC_DECIMALS), "0")
    .slice(0, Math.max(0, Math.min(maxFractionDigits, Number(USDC_DECIMALS))))
    .replace(/0+$/, "");

  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function jsonSafe<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, entry) =>
      typeof entry === "bigint" ? entry.toString() : entry,
    ),
  );
}
