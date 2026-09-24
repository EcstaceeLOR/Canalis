import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { UptoSvmScheme } from "@x402/svm/upto/client";

export type UptoClientSigner = ConstructorParameters<typeof UptoSvmScheme>[0];

export type ChannelSpikeResult = {
  resource: unknown;
  payment: unknown;
  elapsedMs: number;
};

/**
 * Execute the Canalis payment-channel spike with a signer supplied by the
 * calling environment (wallet, KMS, test harness, etc.). Secret-key loading is
 * intentionally kept outside this module.
 */
export async function runChannelSpike(
  signer: UptoClientSigner,
  resourceServerUrl = "http://localhost:4021",
): Promise<ChannelSpikeResult> {
  const client = new x402Client();
  client.setSpendControls({ maxAmountPerPayment: "$0.10" });
  client.register("solana:*", new UptoSvmScheme(signer));

  const paidFetch = wrapFetchWithPayment(fetch, client);
  const httpClient = new x402HTTPClient(client);
  const startedAt = performance.now();

  const response = await paidFetch(`${resourceServerUrl}/api/tool`, {
    method: "GET",
  });
  const payment = await httpClient.processResponse(response);
  const resource: unknown = await response.json();

  if (!response.ok) {
    throw new Error(`Paid request failed with HTTP ${response.status}`);
  }

  return {
    resource,
    payment,
    elapsedMs: performance.now() - startedAt,
  };
}
