import type Agent from "@tokenring-ai/agent/Agent";
import type { TokenRingToolResult } from "@tokenring-ai/chat/schema";
import markdownList from "@tokenring-ai/utility/string/markdownList";
import DatabaseService from "../DatabaseService.ts";
import type { DataSource } from "../types.ts";

/**
 * Looks up a datasource by name, returning a ready-to-return tool failure when
 * the name doesn't match anything — every database_* tool needs the same
 * "here's what actually exists" error.
 */
export function resolveDatasource(
  datasourceName: string,
  toolLabel: string,
  agent: Agent,
): { datasource: DataSource; service: DatabaseService; failure?: undefined } | { failure: TokenRingToolResult; datasource?: undefined; service?: undefined } {
  const service = agent.requireService(DatabaseService);
  const datasource = service.getDataSource(datasourceName);

  if (!datasource) {
    return {
      failure: {
        failed: true,
        message: `**Database** Error while running ${toolLabel}: Incorrect datasource value`,
        result: `No datasource named ${datasourceName} found. Currently available datasources:
${markdownList(service.getDatasourceNames())}
    `,
      },
    };
  }

  return { datasource, service };
}
