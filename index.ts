import {AgentTeam, TokenRingPackage} from "@tokenring-ai/agent";
import {z} from "zod";
import DatabaseService from "./DatabaseService.ts";
import packageJSON from './package.json' with {type: 'json'};
import * as tools from "./tools.ts";

export const DatabaseConfigSchema = z.object({
  providers: z.record(z.string(), z.any())
}).optional();

export default {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(agentTeam: AgentTeam) {
    const config = agentTeam.getConfigSlice('database', DatabaseConfigSchema);
    if (config) {
      agentTeam.addTools(packageJSON.name, tools);
      agentTeam.addServices(new DatabaseService());
    }
  }
} as TokenRingPackage;

export {default as DatabaseProvider} from "./DatabaseProvider.js";
export {default as DatabaseService} from "./DatabaseService.ts";
