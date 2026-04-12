"use client";

import { useState, useTransition } from "react";

export default function AgentChat({ goal, template, reference, inputs }) {
  const [messages, setMessages] = useState([]);
  const [draftMessage, setDraftMessage] = useState(
    "Help me turn this into the right workflow app.",
  );
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event) {
    event.preventDefault();

    const text = draftMessage.trim();
    if (!text || isPending) {
      return;
    }

    const nextMessages = [
      ...messages,
      {
        id: createId(),
        role: "user",
        text,
      },
    ];

    setMessages(nextMessages);
    setDraftMessage("");
    setError("");

    startTransition(async () => {
      try {
        const result = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: nextMessages.map((message) => ({
              role: message.role,
              text: message.text,
            })),
            goal,
            template,
            reference,
            inputs,
          }),
        });
        const json = await result.json();
        if (!result.ok || !json.ok) {
          throw new Error(json.error || "Chat request failed.");
        }

        setMessages((currentMessages) => [
          ...currentMessages,
          {
            id: createId(),
            role: "assistant",
            text: json.data.reply || "No reply returned.",
            toolCalls: Array.isArray(json.data.toolCalls) ? json.data.toolCalls : [],
          },
        ]);
      } catch (requestError) {
        setError(requestError.message);
      }
    });
  }

  return (
    <section className="chat-panel panel">
      <div className="panel-head">
        <p className="panel-kicker">Chat Copilot</p>
        <h2>Talk to the planner</h2>
        <p>
          This assistant uses the same deterministic workflow tools as the rest of
          the app. It stays on the non-spending path and reports the exact tool work
          it performed.
        </p>
      </div>

      <div className="chat-scroll">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <p>Try prompts like:</p>
            <ul className="flat-list">
              <li>What template would you start from for this workflow?</li>
              <li>Prepare this flow and tell me what inputs are still missing.</li>
              <li>Bootstrap a copy and summarize what got exposed.</li>
            </ul>
          </div>
        ) : null}

        {messages.map((message) => (
          <article className={`chat-bubble chat-${message.role}`} key={message.id}>
            <header>
              <span>{message.role === "user" ? "You" : "Agent"}</span>
            </header>

            <div className="chat-parts">
              <p className="chat-text">{message.text}</p>

              {Array.isArray(message.toolCalls)
                ? message.toolCalls.map((toolCall, index) => (
                    <div className="tool-card" key={`${message.id}-tool-${index}`}>
                      <strong>{toolCall.name}</strong>
                      <pre>{JSON.stringify(toolCall.args, null, 2)}</pre>
                      <details>
                        <summary>Tool result</summary>
                        <pre>{JSON.stringify(toolCall.result, null, 2)}</pre>
                      </details>
                    </div>
                  ))
                : null}
            </div>
          </article>
        ))}
      </div>

      <form className="chat-form" onSubmit={handleSubmit}>
        <textarea
          onChange={(event) => setDraftMessage(event.target.value)}
          placeholder="Ask the agent what to do next..."
          rows={3}
          value={draftMessage}
        />
        <div className="chat-actions">
          <span className="chat-status">
            {isPending ? "Thinking..." : error ? error : "Ready"}
          </span>
          <button className="action action-primary" disabled={isPending} type="submit">
            {isPending ? "Working..." : "Send"}
          </button>
        </div>
      </form>
    </section>
  );
}

function createId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
