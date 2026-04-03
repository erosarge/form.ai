import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server-client";
import {
  fetchIntervalsAthleteProfile,
  fetchIntervalsRecent,
} from "@/lib/intervals/intervals-client";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

function getAnthropicEnv() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-0";

  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY in environment.");
  }

  return { apiKey, model };
}

function clampInt(n: unknown, { min, max, fallback }: { min: number; max: number; fallback: number }) {
  const num = typeof n === "number" ? n : typeof n === "string" ? Number(n) : NaN;
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(num)));
}

function buildSystemPrompt({
  athleteProfile,
  recent,
}: {
  athleteProfile: unknown;
  recent: unknown;
}) {
  return [
    "You are a helpful endurance training assistant.",
    "Use the user's Intervals.icu data as context. Be concrete and reference the provided data when helpful.",
    "If you are missing key details, ask targeted questions rather than guessing.",
    "",
    "ATHLETE_PROFILE_JSON:",
    JSON.stringify(athleteProfile),
    "",
    "RECENT_INTERVALS_DATA_JSON:",
    JSON.stringify(recent),
  ].join("\n");
}

async function* anthropicTextStream(response: Response): AsyncGenerator<string> {
  const body = response.body;
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Anthropic streams as SSE. We parse by event blocks separated by blank lines.
    while (true) {
      const sep = buffer.indexOf("\n\n");
      if (sep === -1) break;

      const rawEvent = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      const lines = rawEvent.split("\n");
      const dataLines = lines
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice("data:".length).trim());

      const dataStr = dataLines.join("\n");
      if (!dataStr || dataStr === "[DONE]") continue;

      let payload: any;
      try {
        payload = JSON.parse(dataStr);
      } catch {
        continue;
      }

      // We care about text deltas.
      if (payload?.type === "content_block_delta") {
        const text = payload?.delta?.text;
        if (typeof text === "string" && text.length) {
          yield text;
        }
      }
    }
  }
}

export async function POST(request: Request) {
  // Require an authenticated Supabase user since this endpoint uses private env-backed data.
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const history = Array.isArray(body?.history) ? (body.history as ChatMessage[]) : [];

  if (!message) {
    return NextResponse.json({ error: "Missing message" }, { status: 400 });
  }

  const maxHistory = clampInt(body?.maxHistory, { min: 0, max: 20, fallback: 8 });
  const maxTokens = clampInt(body?.maxTokens, { min: 256, max: 4096, fallback: 1024 });

  const { apiKey, model } = getAnthropicEnv();

  const [athleteProfile, recent] = await Promise.all([
    fetchIntervalsAthleteProfile(),
    fetchIntervalsRecent({ days: 14, limit: 20 }),
  ]);

  const system = buildSystemPrompt({ athleteProfile, recent });

  const anthropicMessages = [
    ...history.slice(-maxHistory).map((m) => ({
      role: m.role,
      content: m.content,
    })),
    { role: "user" as const, content: message },
  ];

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: anthropicMessages,
      stream: true,
    }),
  });

  if (!anthropicRes.ok) {
    const text = await anthropicRes.text().catch(() => "");
    return NextResponse.json(
      { error: `Claude API error (${anthropicRes.status}): ${text || anthropicRes.statusText}` },
      { status: 502 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of anthropicTextStream(anthropicRes)) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (e) {
        controller.enqueue(
          encoder.encode(
            `\n\n[stream error: ${e instanceof Error ? e.message : "unknown"}]`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

