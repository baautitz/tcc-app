import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { pool } from "../../db/client.js";

let checkpointer: Promise<PostgresSaver> | undefined;

/** Shared Postgres checkpointer (own `langgraph` schema); tables are created on first use. */
export function getAiCheckpointer(): Promise<PostgresSaver> {
  checkpointer ??= (async () => {
    const saver = new PostgresSaver(pool, undefined, { schema: "langgraph" });
    await saver.setup();
    return saver;
  })().catch((error) => {
    checkpointer = undefined;
    throw error;
  });
  return checkpointer;
}
