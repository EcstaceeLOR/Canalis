import {
  CHANNEL_ID_LENGTH,
  VOUCHER_LENGTH,
  VOUCHER_MAGIC,
} from "./constants.js";

const MAX_U64 = (1n << 64n) - 1n;
const MIN_I64 = -(1n << 63n);
const MAX_I64 = (1n << 63n) - 1n;

export type Voucher = {
  channelId: Uint8Array;
  cumulativeAmount: bigint;
  expiresAt: bigint;
};

function assertChannelId(channelId: Uint8Array): void {
  if (channelId.length !== CHANNEL_ID_LENGTH) {
    throw new RangeError(
      `channelId must be ${CHANNEL_ID_LENGTH} bytes; received ${channelId.length}`,
    );
  }
}

function assertU64(value: bigint, field: string): void {
  if (value < 0n || value > MAX_U64) {
    throw new RangeError(`${field} must fit in an unsigned 64-bit integer`);
  }
}

function assertI64(value: bigint, field: string): void {
  if (value < MIN_I64 || value > MAX_I64) {
    throw new RangeError(`${field} must fit in a signed 64-bit integer`);
  }
}

/**
 * Encode the canonical Solana payment-channel voucher payload.
 *
 * Wire format (50 bytes total):
 * - 0..2   magic [0x56, 0x01]
 * - 2..34  channel PDA bytes
 * - 34..42 cumulative amount, u64 little-endian
 * - 42..50 expiry unix timestamp, i64 little-endian (0 = no expiry)
 */
export function encodeVoucher(voucher: Voucher): Uint8Array {
  assertChannelId(voucher.channelId);
  assertU64(voucher.cumulativeAmount, "cumulativeAmount");
  assertI64(voucher.expiresAt, "expiresAt");

  const encoded = new Uint8Array(VOUCHER_LENGTH);
  encoded.set(VOUCHER_MAGIC, 0);
  encoded.set(voucher.channelId, 2);

  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
  view.setBigUint64(34, voucher.cumulativeAmount, true);
  view.setBigInt64(42, voucher.expiresAt, true);

  return encoded;
}

export function decodeVoucher(encoded: Uint8Array): Voucher {
  if (encoded.length !== VOUCHER_LENGTH) {
    throw new RangeError(
      `voucher must be ${VOUCHER_LENGTH} bytes; received ${encoded.length}`,
    );
  }

  if (encoded[0] !== VOUCHER_MAGIC[0] || encoded[1] !== VOUCHER_MAGIC[1]) {
    throw new Error("unsupported voucher magic/version");
  }

  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);

  return {
    channelId: encoded.slice(2, 34),
    cumulativeAmount: view.getBigUint64(34, true),
    expiresAt: view.getBigInt64(42, true),
  };
}

export function isVoucherExpired(
  voucher: Pick<Voucher, "expiresAt">,
  nowUnixSeconds: bigint,
): boolean {
  return voucher.expiresAt !== 0n && voucher.expiresAt < nowUnixSeconds;
}

export function assertMonotonicVoucherAmount(
  previousAmount: bigint,
  nextAmount: bigint,
  depositCeiling: bigint,
): void {
  assertU64(previousAmount, "previousAmount");
  assertU64(nextAmount, "nextAmount");
  assertU64(depositCeiling, "depositCeiling");

  if (nextAmount <= previousAmount) {
    throw new Error("voucher cumulative amount must increase monotonically");
  }

  if (nextAmount > depositCeiling) {
    throw new Error("voucher cumulative amount exceeds channel deposit ceiling");
  }
}
