import Agent from "@tokenring-ai/agent/Agent";
import joinDefault from "@tokenring-ai/utility/joinDefault";
import {z} from "zod";
import DatabaseService from "../DatabaseService.js";

export const name = "database/listDatabases";

export async function execute(
  {},
  agent: Agent
): Promise<string> {
  const databaseService = agent.requireFirstServiceByType(DatabaseService);

  return `Available databases: ${joinDefault(", ", databaseService.getActiveResourceNames(), "No databases available.")}`;
}

export const description = "Lists all databases accessible by the configured database connections.";
export const inputSchema = z.object({});