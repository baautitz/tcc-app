import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  insertAfter,
  insertBefore,
  type ChatItem,
  type ChatMessage,
} from "@/modules/ai/model/chat-items";

/** Stable updaters over a ChatItem[] state setter. */
export function chatItemOps(setItems: Dispatch<SetStateAction<ChatItem[]>>) {
  return {
    updateAssistant: (
      assistantId: string,
      update: (message: ChatMessage) => ChatMessage,
    ) =>
      setItems((current) =>
        current.map((item) =>
          item.kind === "message" && item.id === assistantId
            ? update(item)
            : item,
        ),
      ),
    insertBeforeAssistant: (assistantId: string, item: ChatItem) =>
      setItems((current) => insertBefore(current, assistantId, item)),
    insertAfterAssistant: (assistantId: string, item: ChatItem) =>
      setItems((current) => insertAfter(current, assistantId, item)),
  };
}

export function useChatSession() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [activityProgress, setActivityProgress] = useState<string>();
  const [dashboardPickerOpen, setDashboardPickerOpen] = useState(false);
  // setItems is stable, so the ops are stable too.
  const ops = useMemo(() => chatItemOps(setItems), []);
  return {
    items,
    setItems,
    draft,
    setDraft,
    busy,
    setBusy,
    activityProgress,
    setActivityProgress,
    dashboardPickerOpen,
    setDashboardPickerOpen,
    ...ops,
  };
}
