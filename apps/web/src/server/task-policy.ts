import {
  ApplicationError,
  mergePolicyRules,
  protocolForMode,
  validatePolicyRules,
  type ResolvedTaskPolicy,
  type TaskWorkspaceCreateInput,
} from "@canalis/application";
import {
  CANALIS_DEVNET_SANDBOX_MINT,
  SOLANA_DEVNET_CAIP2,
} from "@canalis/solana";
import { getPolicyRepository } from "./policies";

function effectiveMint(mode: TaskWorkspaceCreateInput["mode"]) {
  return mode === "x402" ? CANALIS_DEVNET_SANDBOX_MINT : "USDC";
}

function normalizeMintAliases(values: readonly string[], mode: TaskWorkspaceCreateInput["mode"]) {
  const actual = effectiveMint(mode);
  return [...new Set(values.map((value) => value === "USDC" ? actual : value))];
}

export async function resolveTaskPolicy(
  ownerWallet: string,
  input: TaskWorkspaceCreateInput,
): Promise<ResolvedTaskPolicy> {
  if (input.policyId === "inline-bounded") {
    const rules = validatePolicyRules({
      totalCeilingUsd: input.budgetUsd,
      maxPerCallUsd: input.maxPerCallUsd,
      allowedProviders: input.allowedProviders,
      blockedProviders: [],
      providerCapsUsd: {},
      durationMinutes: input.expiryMinutes,
      allowedNetworks: input.mode === "x402" ? [SOLANA_DEVNET_CAIP2] : [],
      allowedMints: [effectiveMint(input.mode)],
      allowedProtocols: [protocolForMode(input.mode)],
    });
    return {
      sourcePolicyName: "Inline bounded policy",
      rules,
      overrides: {},
    };
  }

  const repository = await getPolicyRepository();
  const policy = await repository.get(input.policyId, ownerWallet, input.policyVersion);
  if (!policy) throw new ApplicationError("POLICY_NOT_FOUND", "Selected policy or policy version was not found.", 404);
  if (policy.status === "archived") {
    throw new ApplicationError("POLICY_ARCHIVED", "Archived policies cannot be selected for new tasks.", 409);
  }
  const selectedVersion = policy.latest;
  const merged = mergePolicyRules(selectedVersion.rules, input.policyOverrides);
  const requiredProtocol = protocolForMode(input.mode);
  if (!merged.allowedProtocols.includes(requiredProtocol)) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${policy.name} v${selectedVersion.version} does not allow ${requiredProtocol.toUpperCase()} execution.`,
      400,
    );
  }
  const normalizedMints = normalizeMintAliases(merged.allowedMints, input.mode);
  const actualMint = effectiveMint(input.mode);
  if (normalizedMints.length > 0 && !normalizedMints.includes(actualMint)) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${policy.name} v${selectedVersion.version} does not allow the task asset ${actualMint}.`,
      400,
    );
  }
  if (
    input.mode === "x402" &&
    merged.allowedNetworks.length > 0 &&
    !merged.allowedNetworks.includes(SOLANA_DEVNET_CAIP2)
  ) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      `${policy.name} v${selectedVersion.version} does not allow the live sandbox network ${SOLANA_DEVNET_CAIP2}.`,
      400,
    );
  }
  if (input.mode === "deterministic" && merged.allowedNetworks.length > 0) {
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "A deterministic task cannot use a policy restricted to blockchain networks.",
      400,
    );
  }

  return {
    sourcePolicyId: policy.id,
    sourcePolicyVersion: selectedVersion.version,
    sourcePolicyName: policy.name,
    rules: { ...merged, allowedMints: normalizedMints },
    overrides: input.policyOverrides,
  };
}
