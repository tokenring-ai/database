import {z} from "zod";

export const DatabaseConfigSchema = z.object({
  providers: z.record(z.string(), z.any())
}).optional();


export {default as DatabaseProvider} from "./DatabaseProvider.js";
export {default as DatabaseService} from "./DatabaseService.ts";
