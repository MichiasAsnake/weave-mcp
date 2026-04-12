"use client";

import { useMemo, useState } from "react";
import AgentChat from "./agent-chat";
import AgentStudio from "./agent-studio";

const DEFAULT_GOAL =
  "Create a reusable workflow app where I upload a reference image and get styled outputs";
const DEFAULT_REFERENCE =
  "https://res.cloudinary.com/dpp2flk93/image/upload/v1745432958/uploads/vnol6b2g8mzwzbsom5dv.png";

export default function WorkbenchShell({ initialAuth, initialTemplates }) {
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [template, setTemplate] = useState(initialTemplates?.[0]?.alias || "multi-views");
  const [reference, setReference] = useState(DEFAULT_REFERENCE);
  const [inlineInputs, setInlineInputs] = useState("");

  const parsedInputs = useMemo(() => parseInlineInputs(inlineInputs), [inlineInputs]);

  return (
    <>
      <AgentStudio
        goal={goal}
        initialAuth={initialAuth}
        initialTemplates={initialTemplates}
        inlineInputs={inlineInputs}
        reference={reference}
        setGoal={setGoal}
        setInlineInputs={setInlineInputs}
        setReference={setReference}
        setTemplate={setTemplate}
        template={template}
      />
      <AgentChat
        goal={goal}
        inputs={parsedInputs}
        reference={reference}
        template={template}
      />
    </>
  );
}

function parseInlineInputs(value) {
  const entries = {};

  for (const line of String(value || "")
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean)) {
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (key) {
      entries[key] = rawValue;
    }
  }

  return entries;
}
