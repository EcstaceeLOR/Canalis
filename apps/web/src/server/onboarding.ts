export type OnboardingStepId = "providers" | "policy" | "task";

export type OnboardingInventory = {
  runtimeReadyProviders: number;
  customProviders: number;
  verifiedExternalProviders: number;
  policies: number;
  tasks: number;
};

export type OnboardingStep = {
  id: OnboardingStepId;
  label: string;
  complete: boolean;
  optional: boolean;
};

export type OnboardingProgress = {
  complete: boolean;
  completedSteps: number;
  totalSteps: number;
  nextStep: OnboardingStepId | null;
  steps: OnboardingStep[];
};

export function buildOnboardingProgress(inventory: OnboardingInventory): OnboardingProgress {
  const steps: OnboardingStep[] = [
    {
      id: "providers",
      label: "Review provider readiness",
      complete: inventory.runtimeReadyProviders > 0,
      optional: false,
    },
    {
      id: "policy",
      label: "Create a reusable spending policy",
      complete: inventory.policies > 0,
      optional: true,
    },
    {
      id: "task",
      label: "Create your first governed task",
      complete: inventory.tasks > 0,
      optional: false,
    },
  ];

  const complete = inventory.tasks > 0 && inventory.runtimeReadyProviders > 0;
  const requiredNext = steps.find((step) => !step.optional && !step.complete)?.id ?? null;
  const recommendedNext = steps.find((step) => !step.complete)?.id ?? null;

  return {
    complete,
    completedSteps: steps.filter((step) => step.complete).length,
    totalSteps: steps.length,
    nextStep: complete ? null : (recommendedNext ?? requiredNext),
    steps,
  };
}
