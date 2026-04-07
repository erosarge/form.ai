"use client";

import { useEffect, useRef, useState } from "react";

type AnyRecord = Record<string, unknown>;

type ChatTurn = {
  role: "user" | "assistant";
  content: string;
  ts: number;
};

export function CoachClient() {
  const [chat, setChat] = useState<ChatTurn[]>([
    {
      role: "assistant",
      content: "How can I help you with your training today?",
      ts: Date.now(),
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatLogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = chatLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat]);

  async function sendChatMessage() {
    const text = chatInput.trim();
    if (!text || chatBusy) return;

    setChatError(null);
    setChatInput("");
    setChatBusy(true);

    const userTurn: ChatTurn = { role: "user", content: text, ts: Date.now() };
    const assistantTurn: ChatTurn = {
      role: "assistant",
      content: "",
      ts: Date.now() + 1,
    };

    setChat((prev) => [...prev, userTurn, assistantTurn]);

    try {
      const historyForApi = chat
        .filter((t) => t.role === "user" || t.role === "assistant")
        .slice(-10)
        .map((t) => ({ role: t.role, content: t.content }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, history: historyForApi }),
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        const msg =
          body && typeof body === "object" && "error" in body
            ? String((body as AnyRecord).error)
            : `Chat request failed (${res.status})`;
        throw new Error(msg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const snapshot = acc;
        setChat((prev) => {
          const next = prev.slice();
          const last = next[next.length - 1];
          if (!last || last.role !== "assistant") return prev;
          next[next.length - 1] = { ...last, content: snapshot };
          return next;
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Chat failed";
      setChatError(msg);
      setChat((prev) => {
        const next = prev.slice();
        const last = next[next.length - 1];
        if (!last || last.role !== "assistant") return prev;
        next[next.length - 1] = {
          ...last,
          content: last.content || `[error] ${msg}`,
        };
        return next;
      });
    } finally {
      setChatBusy(false);
    }
  }

  return (
    <div className="coachChatWrap">
      <div className="row space-between" style={{ flexShrink: 0 }}>
        <p className="sectionTitle">AI Coach</p>
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: chatBusy ? "var(--accent)" : "var(--text-muted)",
          }}
        >
          {chatBusy ? "Thinking…" : "Ready"}
        </span>
      </div>

      <div className="coachChatLog" ref={chatLogRef} aria-live="polite">
        <div className="stack" style={{ gap: 8 }}>
          {chat.map((t, i) => (
            <div key={`${t.ts}-${i}`} className={`chatMsg ${t.role}`}>
              <div className="chatMeta">{t.role === "user" ? "You" : "Coach"}</div>
              <div className="chatText">{t.content}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flexShrink: 0 }}>
        <div className="chatInputRow">
          <textarea
            className="textarea"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                sendChatMessage();
            }}
            placeholder="Ask your coach anything…"
            disabled={chatBusy}
          />
          <button
            className="button"
            onClick={sendChatMessage}
            disabled={chatBusy}
          >
            Send
          </button>
        </div>
        {chatError ? (
          <div className="error" style={{ marginTop: 8 }}>
            {chatError}
          </div>
        ) : null}
      </div>
    </div>
  );
}
