import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'

type BindValue = ArrayBuffer | ArrayBufferView | null | number | string | boolean
type Row = Record<string, unknown>

interface RunOutcome<T = Row> {
  results: T[]
  changes: number
  lastRowId: number
}

class SerialExecutor {
  private tail = Promise.resolve()

  run<T>(operation: () => T): Promise<T> {
    const pending = this.tail.then(operation, operation)
    this.tail = pending.then(() => undefined, () => undefined)
    return pending
  }
}

export class LocalD1PreparedStatement {
  private readonly values: BindValue[]

  constructor(
    private readonly database: LocalD1Database,
    readonly query: string,
    values: BindValue[] = [],
  ) {
    this.values = values
  }

  bind(...values: BindValue[]): LocalD1PreparedStatement {
    return new LocalD1PreparedStatement(this.database, this.query, values)
  }

  first<T = Row>(columnName?: string): Promise<T | null> {
    return this.database.execute(() => {
      const row = this.getStatement().get(...this.boundValues()) as Row | undefined
      if (!row) return null
      const normalized = normalizeRow(row)
      return (columnName === undefined ? normalized : normalized[columnName]) as T ?? null
    })
  }

  all<T = Row>(): Promise<D1Result<T>> {
    return this.database.execute(() => {
      const started = performance.now()
      const results = this.getStatement().all(...this.boundValues()).map(normalizeRow) as T[]
      return result(results, 0, 0, performance.now() - started)
    })
  }

  run<T = Row>(): Promise<D1Result<T>> {
    return this.database.execute(() => {
      const started = performance.now()
      const outcome = this.runSync<T>()
      return result(outcome.results, outcome.changes, outcome.lastRowId, performance.now() - started)
    })
  }

  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    return this.database.execute(() => {
      const statement = this.getStatement()
      const rows = statement.all(...this.boundValues()) as Row[]
      const columns = statement.columns().map((column) => column.name)
      const values = rows.map((row) => columns.map((column) => normalizeValue(row[column])))
      return (options?.columnNames ? [columns, ...values] : values) as T[]
    })
  }

  runSync<T = Row>(): RunOutcome<T> {
    const statement = this.getStatement()
    const values = this.boundValues()
    if (returnsRows(this.query)) {
      return {
        results: statement.all(...values).map(normalizeRow) as T[],
        changes: Number(this.database.sqliteChanges()),
        lastRowId: Number(this.database.sqliteLastInsertRowId()),
      }
    }
    const outcome = statement.run(...values)
    return {
      results: [],
      changes: Number(outcome.changes),
      lastRowId: Number(outcome.lastInsertRowid),
    }
  }

  belongsTo(database: LocalD1Database): boolean {
    return this.database === database
  }

  private getStatement(): StatementSync {
    return this.database.statement(this.query)
  }

  private boundValues(): Array<null | number | bigint | string | Uint8Array> {
    return this.values.map(normalizeBindValue)
  }
}

export class LocalD1Database {
  private readonly sqlite: DatabaseSync
  private readonly serial = new SerialExecutor()
  private closed = false

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.sqlite = new DatabaseSync(path)
    this.sqlite.exec('PRAGMA journal_mode = WAL')
    this.sqlite.exec('PRAGMA foreign_keys = ON')
    this.sqlite.exec('PRAGMA busy_timeout = 5000')
  }

  prepare(query: string): LocalD1PreparedStatement {
    this.assertOpen()
    return new LocalD1PreparedStatement(this, query)
  }

  batch<T = Row>(statements: LocalD1PreparedStatement[]): Promise<D1Result<T>[]> {
    return this.execute(() => {
      if (statements.some((statement) => !statement.belongsTo(this))) {
        throw new Error('d1_batch_database_mismatch')
      }
      this.sqlite.exec('BEGIN IMMEDIATE')
      try {
        const outcomes = statements.map((statement) => {
          const started = performance.now()
          const outcome = statement.runSync<T>()
          return result(outcome.results, outcome.changes, outcome.lastRowId, performance.now() - started)
        })
        this.sqlite.exec('COMMIT')
        return outcomes
      } catch (error) {
        this.sqlite.exec('ROLLBACK')
        throw error
      }
    })
  }

  exec(query: string): Promise<D1ExecResult> {
    return this.execute(() => {
      const started = performance.now()
      this.sqlite.exec(query)
      return {
        count: query.split(';').filter((statement) => statement.trim()).length,
        duration: performance.now() - started,
      }
    })
  }

  close(): Promise<void> {
    return this.execute(() => {
      this.sqlite.close()
      this.closed = true
    })
  }

  asD1Database(): D1Database {
    return this as unknown as D1Database
  }

  execute<T>(operation: () => T): Promise<T> {
    this.assertOpen()
    return this.serial.run(() => {
      this.assertOpen()
      return operation()
    })
  }

  statement(query: string): StatementSync {
    this.assertOpen()
    return this.sqlite.prepare(query)
  }

  sqliteChanges(): number | bigint {
    const row = this.sqlite.prepare('SELECT changes() AS value').get() as { value: number | bigint }
    return row.value
  }

  sqliteLastInsertRowId(): number | bigint {
    const row = this.sqlite.prepare('SELECT last_insert_rowid() AS value').get() as { value: number | bigint }
    return row.value
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('d1_database_closed')
  }
}

function normalizeBindValue(value: BindValue): null | number | bigint | string | Uint8Array {
  if (value === null) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number' || typeof value === 'string') return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}

function normalizeRow(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeValue(value)]))
}

function normalizeValue(value: unknown): unknown {
  if (!(value instanceof Uint8Array)) return value
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
}

function returnsRows(query: string): boolean {
  const normalized = query.trimStart().toUpperCase()
  return /^(?:SELECT|PRAGMA|EXPLAIN|WITH)\b/.test(normalized) || /\bRETURNING\b/.test(normalized)
}

function result<T>(results: T[], changes: number, lastRowId: number, duration: number): D1Result<T> {
  return {
    results,
    success: true,
    meta: {
      duration,
      size_after: 0,
      rows_read: results.length,
      rows_written: changes,
      last_row_id: lastRowId,
      changed_db: changes > 0,
      changes,
    },
  }
}
