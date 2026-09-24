import { signBytes, verifySignature } from "@solana/kit";
import type { Voucher } from "./voucher.js";
import { encodeVoucher } from "./voucher.js";

export async function signVoucher(
  privateKey: CryptoKey,
  voucher: Voucher,
): Promise<Uint8Array> {
  return signBytes(privateKey, encodeVoucher(voucher));
}

export async function verifyVoucherSignature(
  publicKey: CryptoKey,
  signature: Uint8Array,
  voucher: Voucher,
): Promise<boolean> {
  return verifySignature(publicKey, signature, encodeVoucher(voucher));
}
