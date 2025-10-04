import Agent from "@tokenring-ai/agent/Agent";
import {IterableItem, IterableProvider, IterableSpec} from "@tokenring-ai/iterables";
import Database from "bun:sqlite";

export default class SqlIterableProvider implements IterableProvider {
  type = "sql";
  description = "Iterate over SQL query results";

  getArgsConfig() {
    return {
      options: {
        query: {type: 'string' as const},
        database: {type: 'string' as const}
      }
    };
  }

  async* generate(spec: IterableSpec, agent: Agent): AsyncGenerator<IterableItem> {
    const dbPath = spec.database || ':memory:';
    const db = new Database(dbPath, {readonly: true});

    try {
      const stmt = db.query(spec.query);
      const rows = stmt.all();

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] as Record<string, any>;

        yield {
          value: row,
          variables: {
            row,
            rowNumber: i + 1,
            totalRows: rows.length,
            json: JSON.stringify(row),
            ...row
          }
        };
      }
    } finally {
      db.close();
    }
  }
}
