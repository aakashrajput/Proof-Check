import type { Client } from "@libsql/client";
export const SCHEMA_VERSION: number;
export const SCHEMA: string[];
export const COLUMNS: [string, string, string][];
export function applySchema(client: Pick<Client, "execute">): Promise<{ created: number; columnsAdded: string[]; version: number }>;
