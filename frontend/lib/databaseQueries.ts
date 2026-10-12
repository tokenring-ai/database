import { databaseRPCClient, useTypedSWR } from "@tokenring-ai/one-frontend/rpc.ts";

/**
 * Data hooks for the Database views that the shared frontend RPC module does
 * not provide. They use the plugin's own RPC schema through `databaseRPCClient`.
 */

/** `CREATE TABLE` (or equivalent) text for every table of a datasource, keyed by table name. */
export function useDatasourceDdl(datasource: string | undefined) {
  return useTypedSWR(datasource ? `/database/showSchema/${datasource}` : null, () => databaseRPCClient.showSchema({ datasource: datasource! }));
}
