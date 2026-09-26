import { CanalisClient } from "@canalis/sdk";

const apiKey = process.env.CANALIS_API_KEY?.trim();
if (!apiKey) {
  throw new Error("Set CANALIS_API_KEY to a sandbox key created in Canalis Developers.");
}

const baseUrl = process.env.CANALIS_BASE_URL?.trim() || "https://canalis-sigma.vercel.app";
const canalis = new CanalisClient({ apiKey, baseUrl });
const runId = `example-${Date.now()}`;

const created = await canalis.tasks.create(
  {
    name: `Agent integration ${runId}`,
    description: "Clean server-to-server Canalis SDK example.",
    mode: "deterministic",
    budgetUsd: "1.00",
    maxPerCallUsd: "0.25",
    allowedProviders: ["search", "data", "inference"],
  },
  { idempotencyKey: `task:create:${runId}` },
);

const task = created.task as { id?: string } | undefined;
if (!task?.id) throw new Error("Canalis did not return a task id.");

console.log(`Created task ${task.id}`);

const executed = await canalis.tasks.execute(task.id, {
  idempotencyKey: `task:execute:${runId}`,
});
console.log("Execution status:", (executed.task as { status?: string } | undefined)?.status ?? "unknown");

const [channels, receipts] = await Promise.all([
  canalis.tasks.channels(task.id),
  canalis.tasks.receipts(task.id),
]);

console.log("Channels:", channels);
console.log("Receipts and settlements:", receipts);
