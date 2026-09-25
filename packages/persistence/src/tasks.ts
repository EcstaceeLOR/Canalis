import type {
  TaskListQuery,
  TaskListResult,
  TaskWorkspaceMetadata,
  TaskWorkspaceSummary,
} from "@canalis/application";
import type { TaskStatus } from "@canalis/core";
import postgres, { type Sql } from "postgres";

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function summary(row: Record<string, unknown>): TaskWorkspaceSummary {
  const budgetAtomic = BigInt(String(row.budget_atomic));
  const spentAtomic = BigInt(String(row.spent_atomic ?? 0));
  return {
    id: String(row.id),
    name: String(row.name ?? row.agent_id),
    description: String(row.description ?? ""),
    owner: String(row.owner),
    agentId: String(row.agent_id),
    mode: String(row.mode),
    status: String(row.status) as TaskStatus,
    mint: String(row.mint),
    budgetAtomic: budgetAtomic.toString(),
    spentAtomic: spentAtomic.toString(),
    recoverableAtomic: (budgetAtomic - spentAtomic).toString(),
    allowedProviders: stringArray(row.allowed_provider_ids),
    policyId: String(row.policy_id ?? "inline-bounded"),
    createdAtUnixSeconds: String(row.created_at_unix),
    expiresAtUnixSeconds: String(row.expires_at_unix),
    updatedAtUnixSeconds: String(row.updated_at_unix),
  };
}

export class PostgresTaskWorkspaceRepository {
  private readonly sql: Sql;

  constructor(databaseUrl: string) {
    if (!databaseUrl.trim()) throw new Error("databaseUrl is required");
    this.sql = postgres(databaseUrl, { max: 5, prepare: false });
  }

  async upsertMetadata(metadata: TaskWorkspaceMetadata): Promise<void> {
    await this.sql`
      INSERT INTO task_workspace_metadata (task_id, name, description, policy_id)
      VALUES (${metadata.taskId}, ${metadata.name}, ${metadata.description}, ${metadata.policyId})
      ON CONFLICT (task_id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        policy_id = EXCLUDED.policy_id,
        updated_at = NOW()
    `;
  }

  async getMetadata(taskId: string, owner: string): Promise<TaskWorkspaceMetadata | null> {
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT m.task_id, m.name, m.description, m.policy_id
      FROM task_workspace_metadata m
      JOIN tasks t ON t.id = m.task_id
      WHERE m.task_id = ${taskId} AND t.owner = ${owner}
      LIMIT 1
    `;
    const row = rows[0];
    return row ? {
      taskId: String(row.task_id),
      name: String(row.name),
      description: String(row.description ?? ""),
      policyId: String(row.policy_id ?? "inline-bounded"),
    } : null;
  }

  async listTasks(query: TaskListQuery): Promise<TaskListResult> {
    const params: Array<string | number> = [query.owner];
    const clauses = ["t.owner = $1"];
    const add = (value: string | number) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (query.search) {
      const placeholder = add(`%${query.search}%`);
      clauses.push(`(m.name ILIKE ${placeholder} OR m.description ILIKE ${placeholder} OR t.id ILIKE ${placeholder} OR t.agent_id ILIKE ${placeholder})`);
    }
    if (query.statuses?.length) {
      const statusPlaceholders = query.statuses.map((status) => add(status));
      clauses.push(`t.status IN (${statusPlaceholders.join(", ")})`);
    }
    if (query.providerId) {
      const placeholder = add(query.providerId);
      clauses.push(`EXISTS (SELECT 1 FROM channels cf WHERE cf.task_id = t.id AND cf.provider_id = ${placeholder})`);
    }
    if (query.createdFromUnixSeconds !== undefined) {
      clauses.push(`t.created_at_unix >= ${add(query.createdFromUnixSeconds.toString())}`);
    }
    if (query.createdToUnixSeconds !== undefined) {
      clauses.push(`t.created_at_unix <= ${add(query.createdToUnixSeconds.toString())}`);
    }

    const where = clauses.join(" AND ");
    const sort = query.sort === "created_desc"
      ? "t.created_at_unix DESC"
      : query.sort === "created_asc"
        ? "t.created_at_unix ASC"
        : query.sort === "name_asc"
          ? "LOWER(COALESCE(m.name, t.agent_id)) ASC, t.updated_at_unix DESC"
          : "t.updated_at_unix DESC";

    const countRows = await this.sql.unsafe<Record<string, unknown>[]>(
      `SELECT COUNT(*)::int AS total
       FROM tasks t
       LEFT JOIN task_workspace_metadata m ON m.task_id = t.id
       WHERE ${where}`,
      params,
    );
    const total = Number(countRows[0]?.total ?? 0);
    const offset = (query.page - 1) * query.pageSize;
    const selectParams: Array<string | number> = [...params, query.pageSize, offset];
    const limitPlaceholder = `$${selectParams.length - 1}`;
    const offsetPlaceholder = `$${selectParams.length}`;
    const rows = await this.sql.unsafe<Record<string, unknown>[]>(
      `SELECT t.*, p.allowed_provider_ids,
              COALESCE(m.name, t.agent_id) AS name,
              COALESCE(m.description, '') AS description,
              COALESCE(m.policy_id, 'inline-bounded') AS policy_id,
              COALESCE((SELECT SUM(c.spent_atomic) FROM channels c WHERE c.task_id = t.id), 0) AS spent_atomic
       FROM tasks t
       JOIN policies p ON p.task_id = t.id
       LEFT JOIN task_workspace_metadata m ON m.task_id = t.id
       WHERE ${where}
       ORDER BY ${sort}
       LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
      selectParams,
    );

    return {
      tasks: rows.map(summary),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async getSummary(taskId: string, owner: string): Promise<TaskWorkspaceSummary | null> {
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT t.*, p.allowed_provider_ids,
             COALESCE(m.name, t.agent_id) AS name,
             COALESCE(m.description, '') AS description,
             COALESCE(m.policy_id, 'inline-bounded') AS policy_id,
             COALESCE((SELECT SUM(c.spent_atomic) FROM channels c WHERE c.task_id = t.id), 0) AS spent_atomic
      FROM tasks t
      JOIN policies p ON p.task_id = t.id
      LEFT JOIN task_workspace_metadata m ON m.task_id = t.id
      WHERE t.id = ${taskId} AND t.owner = ${owner}
      LIMIT 1
    `;
    return rows[0] ? summary(rows[0]) : null;
  }

  async getStatus(taskId: string, owner: string): Promise<TaskStatus | null> {
    const rows = await this.sql<{ status: TaskStatus }[]>`
      SELECT status FROM tasks WHERE id = ${taskId} AND owner = ${owner} LIMIT 1
    `;
    return rows[0]?.status ?? null;
  }

  async setStatus(
    taskId: string,
    owner: string,
    status: TaskStatus,
    updatedAtUnixSeconds: bigint,
    expiresAtUnixSeconds?: bigint,
  ): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      UPDATE tasks
      SET status = ${status},
          updated_at_unix = ${updatedAtUnixSeconds.toString()},
          expires_at_unix = COALESCE(${expiresAtUnixSeconds?.toString() ?? null}, expires_at_unix)
      WHERE id = ${taskId} AND owner = ${owner}
      RETURNING id
    `;
    return rows.length > 0;
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
