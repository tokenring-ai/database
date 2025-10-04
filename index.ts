import {AgentTeam, TokenRingPackage} from "@tokenring-ai/agent";
import {IterableService} from "@tokenring-ai/iterables";
import {z} from "zod";
import DatabaseService from "./DatabaseService.ts";
import packageJSON from './package.json' with {type: 'json'};
import SqlIterableProvider from "./SqlIterableProvider.ts";
import * as tools from "./tools.ts";

export const DatabaseConfigSchema = z.object({
  providers: z.record(z.string(), z.any())
}).optional();

export const packageInfo: TokenRingPackage = {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(agentTeam: AgentTeam) {
    const config = agentTeam.getConfigSlice('database', DatabaseConfigSchema);
    if (config) {
      agentTeam.addTools(packageInfo, tools);
      agentTeam.addServices(new DatabaseService());
      agentTeam.services.waitForItemByType(IterableService).then((iterableService: IterableService) => {
        iterableService.registerProvider("sql", new SqlIterableProvider());
      });
    }
  }
};

export {default as DatabaseProvider} from "./DatabaseProvider.js";
export {default as DatabaseService} from "./DatabaseService.ts";
