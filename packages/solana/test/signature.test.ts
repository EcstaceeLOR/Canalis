import { generateKeyPair } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  signVoucher,
  verifyVoucherSignature,
  type Voucher,
} from "../src/index.js";

const voucher: Voucher = {
  channelId: Uint8Array.from({ length: 32 }, (_, index) => 255 - index),
  cumulativeAmount: 42_000n,
  expiresAt: 1_900_000_000n,
};

describe("voucher signatures", () => {
  it("signs and verifies the canonical voucher bytes with Ed25519", async () => {
    const keyPair = await generateKeyPair();
    const signature = await signVoucher(keyPair.privateKey, voucher);

    expect(signature).toHaveLength(64);
    await expect(
      verifyVoucherSignature(keyPair.publicKey, signature, voucher),
    ).resolves.toBe(true);
  });

  it("fails verification when the cumulative amount is changed", async () => {
    const keyPair = await generateKeyPair();
    const signature = await signVoucher(keyPair.privateKey, voucher);

    await expect(
      verifyVoucherSignature(keyPair.publicKey, signature, {
        ...voucher,
        cumulativeAmount: voucher.cumulativeAmount + 1n,
      }),
    ).resolves.toBe(false);
  });
});
