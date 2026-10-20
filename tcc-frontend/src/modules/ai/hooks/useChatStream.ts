import { aiApi } from "@/modules/ai/api/ai.api";
import { readChatStream, type ChatEvent } from "@/modules/ai/model/chat-sse";

/** POSTs to the AI chat endpoint and feeds SSE events to onEvent. */
export async function runChatStream(
  body: unknown,
  signal: AbortSignal,
  onEvent: (event: ChatEvent) => void,
) {
  const response = await aiApi.streamAiChat(body, signal);
  if (!response.ok) {
    const result = (await response.json().catch(() => ({}))) as {
      error?: unknown;
    };
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : "Não foi possível iniciar a conversa com a IA.",
    );
  }
  if (!response.body)
    throw new Error("O servidor não iniciou o streaming da IA.");

  let receivedDone = false;
  let receivedError = false;
  await readChatStream(response.body, (event) => {
    if (event.type === "done") receivedDone = true;
    if (event.type === "error") receivedError = true;
    onEvent(event);
  });
  return { receivedDone, receivedError };
}
