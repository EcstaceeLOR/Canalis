import { describe, expect, it } from "vitest";
import { buildOnboardingProgress } from "./onboarding";

describe("first-run onboarding progress", () => {
  it("guides a new wallet from provider readiness to a policy recommendation", () => {
    const progress = buildOnboardingProgress({
      runtimeReadyProviders: 3,
      customProviders: 0,
      verifiedExternalProviders: 0,
      policies: 0,
      tasks: 0,
    });

    expect(progress.complete).toBe(false);
    expect(progress.completedSteps).toBe(1);
    expect(progress.nextStep).toBe("policy");
    expect(progress.steps.find((step) => step.id === "policy")?.optional).toBe(true);
  });

  it("moves to task creation after a reusable policy exists", () => {
    const progress = buildOnboardingProgress({
      runtimeReadyProviders: 3,
      customProviders: 1,
      verifiedExternalProviders: 1,
      policies: 1,
      tasks: 0,
    });

    expect(progress.complete).toBe(false);
    expect(progress.nextStep).toBe("task");
    expect(progress.completedSteps).toBe(2);
  });

  it("finishes first-run guidance after a valid first task exists", () => {
    const progress = buildOnboardingProgress({
      runtimeReadyProviders: 3,
      customProviders: 0,
      verifiedExternalProviders: 0,
      policies: 0,
      tasks: 1,
    });

    expect(progress.complete).toBe(true);
    expect(progress.nextStep).toBeNull();
  });

  it("does not claim setup readiness when no executable provider path exists", () => {
    const progress = buildOnboardingProgress({
      runtimeReadyProviders: 0,
      customProviders: 1,
      verifiedExternalProviders: 1,
      policies: 1,
      tasks: 0,
    });

    expect(progress.complete).toBe(false);
    expect(progress.nextStep).toBe("providers");
  });
});
