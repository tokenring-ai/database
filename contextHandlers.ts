import {ContextHandler} from "@tokenring-ai/chat/types";
import availableDatabases from "./contextHandlers/availableDatabases.ts";

export default {
  'available-databases': availableDatabases,
} as Record<string, ContextHandler>;
