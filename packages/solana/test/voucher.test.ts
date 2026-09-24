import { describe, expect, it } from "vitest";
import {
  VOUCHER_LENGTH,
  assertMonotonicVoucherAmount,
  decodeVoucher,
  encodeVoucher,
  isVoucherExpired,
} from "../src/index.js";

const channelId = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const MAX_U64 = (1n << 64n) - 1n;
const MIN_I64 = -(1n << 63n);
const MAX_I64 = (1n << 63n) - 1n;

describe("payment-channel voucher codec", () => {
  it("encodes the canonical 50-byte layout", () => {
    const encoded = encodeVoucher({
      channelId,
      cumulativeAmount: 125_000n,
      expiresAt: 1_800_000_000n,
    });

    expect(encoded).toHaveLength(VOUCHER_LENGTH);
    expect(Array.from(encoded.slice(0, 2))).toEqual([0x56, 0x01]);
    expect(Array.from(encoded.slice(2, 34))).toEqual(Array.from(channelId));

    const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
    expect(view.getBigUint64(34, true)).toBe(125_000n);
    expect(view.getBigInt64(42, true)).toBe(1_800_000_000n);
  });

  it("round-trips a voucher without losing integer precision", () => {
    const original = {
      channelId,
      cumulativeAmount: 9_007_199_254_740_993n,
      expiresAt: 0n,
    };

    const decoded = decodeVoucher(encodeVoucher(original));

    expect(Array.from(decoded.channelId)).toEqual(Array.from(channelId));
    expect(decoded.cumulativeAmount).toBe(original.cumulativeAmount);
    expect(decoded.expiresAt).toBe(0n);
  });

  it("round-trips the exact u64/i64 wire boundaries", () => {
    for (const expiresAt of [MIN_I64, 0n, MAX_I64]) {
      const decoded = decodeVoucher(
        encodeVoucher({ channelId, cumulativeAmount: MAX_U64, expiresAt }),
      );
      expect(decoded.cumulativeAmount).toBe(MAX_U64);
      expect(decoded.expiresAt).toBe(expiresAt);
    }
  });

  it("rejects values outside the canonical integer widths", () => {
    expect(() =>
      encodeVoucher({
        channelId,
        cumulativeAmount: -1n,
        expiresAt: 0n,
      }),
    ).toThrow(/unsigned 64-bit/);

    expect(() =>
      encodeVoucher({
        channelId,
        cumulativeAmount: MAX_U64 + 1n,
        expiresAt: 0n,
      }),
    ).toThrow(/unsigned 64-bit/);

    expect(() =>
      encodeVoucher({
        channelId,
        cumulativeAmount: 1n,
        expiresAt: MIN_I64 - 1n,
      }),
    ).toThrow(/signed 64-bit/);

    expect(() =>
      encodeVoucher({
        channelId,
        cumulativeAmount: 1n,
        expiresAt: MAX_I64 + 1n,
      }),
    ).toThrow(/signed 64-bit/);
  });

  it("rejects malformed voucher versions, lengths, and channel ids", () => {
    expect(() =>
      encodeVoucher({
        channelId: new Uint8Array(31),
        cumulativeAmount: 1n,
        expiresAt: 0n,
      }),
    ).toThrow(/32 bytes/);

    const encoded = encodeVoucher({
      channelId,
      cumulativeAmount: 1n,
      expiresAt: 0n,
    });
    encoded[1] = 0xff;

    expect(() => decodeVoucher(encoded)).toThrow(/magic\/version/);
    expect(() => decodeVoucher(new Uint8Array(VOUCHER_LENGTH - 1))).toThrow(
      /voucher must be/,
    );
    expect(() => decodeVoucher(new Uint8Array(VOUCHER_LENGTH + 1))).toThrow(
      /voucher must be/,
    );
  });

  it("enforces monotonic cumulative spend and the deposit ceiling", () => {
    expect(() => assertMonotonicVoucherAmount(10n, 11n, 20n)).not.toThrow();
    expect(() => assertMonotonicVoucherAmount(10n, 10n, 20n)).toThrow(
      /increase monotonically/,
    );
    expect(() => assertMonotonicVoucherAmount(10n, 9n, 20n)).toThrow(
      /increase monotonically/,
    );
    expect(() => assertMonotonicVoucherAmount(10n, 21n, 20n)).toThrow(
      /deposit ceiling/,
    );
    expect(() => assertMonotonicVoucherAmount(MAX_U64 - 1n, MAX_U64, MAX_U64)).not.toThrow();
  });

  it("treats zero expiry as no expiry", () => {
    expect(isVoucherExpired({ expiresAt: 0n }, 2_000n)).toBe(false);
    expect(isVoucherExpired({ expiresAt: 1_999n }, 2_000n)).toBe(true);
    expect(isVoucherExpired({ expiresAt: 2_001n }, 2_000n)).toBe(false);
  });
});
