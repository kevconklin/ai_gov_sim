export type SqlValue = string | number | null;

export interface Statement {
  sql: string;
  params: readonly SqlValue[];
}

export interface Db {
  readonly kind: "sqlite" | "postgres";
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  get<T>(sql: string, params?: readonly SqlValue[]): Promise<T | undefined>;
  /** Run write statements atomically, in order. */
  transaction(statements: readonly Statement[]): Promise<void>;
}

export type DbTarget =
  | { kind: "sqlite"; path: string }
  | { kind: "postgres"; url: string };
