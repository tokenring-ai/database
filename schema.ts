import { z } from "zod";

export const DatabaseConfiguration = z.object({
  url: z.url(),
  allowWrites: z.boolean().default(false),
});

export type DatabaseConfiguration = z.infer<typeof DatabaseConfiguration>;

export const DatabaseServiceConfigSchema = z.record(z.string(), DatabaseConfiguration).prefault({});

export type DatabaseServiceConfig = z.input<typeof DatabaseServiceConfigSchema>;
export type ParsedDatabaseServiceConfig = z.output<typeof DatabaseServiceConfigSchema>;
