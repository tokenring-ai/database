import { z } from "zod";

export const DatabaseConfigSchema = z.object({}).exactOptional();

export { default as DatabaseProvider } from "./DatabaseProvider.js";
export { default as DatabaseService } from "./DatabaseService.ts";
