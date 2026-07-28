import type { ContextHandler } from "@tokenring-ai/chat/schema";
import datasources from "./contextHandlers/datasources.ts";

export default {
  datasources: datasources,
} as Record<string, ContextHandler>;
