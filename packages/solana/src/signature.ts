import {
  signBytes,
  verifySignature,
  type SignatureBytes,
} from "@solana/kit";
import type { Voucher } from "./voucher.js";
import { encodeVoucher } from "./voucher.js";

export async function signVoucher(
  privateKey: CryptoKey,
  voucher: Voucher,
): Promise<SignatureBytes> {
  return signBytes(privateKey, encodeVoucher(voucher));
}

export async function verifyVoucherSignature(
  publicKey: CryptoKey,
  signature: SignatureBytes,
  voucher: Voucher,
): Promise<boolean> {
  return verifySignature(publicKey, signature, encodeVoucher(voucher));
}
