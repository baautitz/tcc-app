import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { pool } from "../../../shared/db/client.js";

/** Shared Postgres checkpointer (own `langgraph` schema); tables are created on first use. */
export class AiCheckpointer {
  private saver: Promise<PostgresSaver> | undefined;

  get(): Promise<PostgresSaver> {
    this.saver ??= (async () => {
      const saver = new PostgresSaver(pool, undefined, { schema: "langgraph" });
      await saver.setup();
      return saver;
    })().catch((error) => {
      this.saver = undefined;
      throw error;
    });
    return this.saver;
  }
}

export const aiCheckpointer = new AiCheckpointer();
