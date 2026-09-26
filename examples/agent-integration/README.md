# Canalis agent integration example

This is a clean server-to-server example using `@canalis/sdk` and a scoped sandbox API key. It does not require a wallet private key or seed phrase in the agent process.

From the repository root:

```bash
pnpm install --no-frozen-lockfile
export CANALIS_API_KEY='cnl_sbx_...'
export CANALIS_BASE_URL='https://canalis-sigma.vercel.app'
pnpm --filter @canalis/agent-example start
```

The example creates a deterministic task, executes it through the versioned `/api/v1` surface, then reads channels, receipts, and settlement evidence. Use a sandbox key with `tasks:write`, `tasks:execute`, `channels:read`, and `receipts:read` scopes.

For local development, set `CANALIS_BASE_URL` to your local web origin. Sandbox keys are blocked from mainnet workspaces by the server.
