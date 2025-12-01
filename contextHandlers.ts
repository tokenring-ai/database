import {ContextHandler} from "@tokenring-ai/chat/types";
import {default as availableDatabases} from "./contextHandlers/availableDatabases.ts";

export default {
  'available-databases': availableDatabases,
} as Record<string, ContextHandler>;
