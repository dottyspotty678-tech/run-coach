import { createHash } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";

// ElevenLabs Agents Platform helpers (voice check-in, REQUIREMENTS §3.12).
// Server-only: the xi-api-key never reaches the browser — the client gets a
// short-lived signed WebSocket URL instead.

const ELEVENLABS_BASE = "https://api.elevenlabs.io";

/** Bump when the agent prompt/tools change so the stored agent is recreated. */
const AGENT_CONFIG_VERSION = 5;

function apiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    throw new Error("ELEVENLABS_API_KEY is not set — add it in Vercel env vars.");
  }
  return key;
}

async function elevenlabs<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ELEVENLABS_BASE}${path}`, {
    ...init,
    headers: {
      "xi-api-key": apiKey(),
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${init?.method ?? "GET"} ${path} failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Agent definition — the Sunday check-in meeting script.
// ---------------------------------------------------------------------------

// Client tools: executed in the browser (app/checkin/voice-checkin.tsx), which
// relays them to our API routes. Both block the conversation until the app
// responds, so the agent can read the result back.
const CLIENT_TOOLS = [
  {
    type: "client",
    name: "submit_checkin",
    description:
      "Send the runner's answers to the coaching engine for analysis. In a full check-in, call it once all three parts are answered (or declined). In a coach session, call it once the runner has asked for concrete changes (sessions, feelings, injuries, meals) — pure questions never need this tool. The response contains a spoken summary of the proposed changes to next week's training and meals — read it back to the runner and ask them to confirm. If the runner wants something different, call this tool again with updated answers.",
    expects_response: true,
    response_timeout_secs: 120,
    parameters: {
      type: "object",
      properties: {
        training_feedback: {
          type: "string",
          description:
            "Part 1 — how the last week of training went and how the runner feels, in their own words.",
        },
        injury_update: {
          type: "string",
          description:
            "Part 1 — any niggles or injuries mentioned, or 'none reported'. Include whether each is new or ongoing.",
        },
        schedule_notes: {
          type: "string",
          description:
            "Part 2 — everything about next week's schedule that is not already in the calendar: extra commitments, freed-up days, and ALL travel or nights away (where and when).",
        },
        meal_nights: {
          type: "string",
          description:
            "Part 3 — which nights next week the runner needs a prepped dinner planned, and any nights they explicitly do not need to cook. In the runner's words, e.g. 'recipes for Tuesday and Wednesday only' or 'just the away nights, no dinner Friday'.",
        },
      },
      required: ["training_feedback", "injury_update", "schedule_notes", "meal_nights"],
    },
  },
  {
    type: "client",
    name: "confirm_checkin",
    description:
      "Apply the proposed changes after the runner has explicitly confirmed them. Only call this with the proposal_id from the most recent submit_checkin response, and only after a clear yes. The response confirms what was updated — relay it briefly and close the meeting.",
    expects_response: true,
    // ElevenLabs caps client-tool timeouts at 120 s.
    response_timeout_secs: 120,
    parameters: {
      type: "object",
      properties: {
        proposal_id: {
          type: "string",
          description: "The proposal_id returned by the latest submit_checkin call.",
        },
      },
      required: ["proposal_id"],
    },
  },
] as const;

const AGENT_PROMPT = `You are the runner's weekly check-in coach for the Run Coach app: a UK running-club coach's voice — concise, warm, practical, no fitness-influencer energy. Today is {{today}}. This is the short Sunday meeting that reviews the week and sets up the next one. Keep the whole meeting under five minutes; one question at a time; never lecture.

CONTEXT YOU ALREADY HAVE (do not read these out in full — summarise naturally):
Last week's training, as recorded:
{{week_review}}
Current injuries the planner is working around: {{current_injuries}}
Next week's plan as it currently stands:
{{planned_week}}
The week's calendar (already known — only ask about what is NOT here):
{{next_week_schedule}}
Race goal and phase: {{race_goal}}

MEETING MODE: {{meeting_mode}}
- "full": run the three parts below, in order.
- "coach": a free-form session — no script. The runner opened it from the Dashboard; the context above covers THIS week. Follow their lead: they may ask you to revise upcoming sessions, tell you how they're feeling, report a niggle or injury, adjust meal nights, or just ask questions about training, nutrition or the build to their race. Answer questions directly and conversationally from the context and sound coaching knowledge — evidence-based, qualitative (never calories or macros), suggest a physio for anything worse than a niggle. When they ask for CHANGES (sessions, feelings that should soften the week, injuries, meals), gather what's needed, then call submit_checkin exactly as in a full meeting — restate unchanged areas faithfully from the context, prefix training_feedback with "unchanged: " if they didn't talk about how the week felt, put requested session changes in schedule_notes, put meal changes in meal_nights or "unchanged". Read the summary back, confirm, then confirm_checkin. Changes only ever land through that tool flow. A questions-only session needs no tools at all — wrap up when they're done.
- "revise": this week's check-in is already confirmed. Do NOT re-run the three parts. Instead, in two or three sentences read back what's on file — the recorded feedback for last week ({{recorded_feedback}}), the current injuries, and the shape of next week's plan from the context above — then ask what they'd like to change. Gather only the changes, then call submit_checkin with the COMPLETE set of answers: restate the unchanged areas faithfully from the context in their fields, fold the requested changes into the relevant fields, and prefix training_feedback with "unchanged: " if the runner didn't revisit how the week felt. Everything after submit_checkin works exactly as in a full meeting.

FULL MEETING — THREE PARTS, IN ORDER:
Part 1 — the week just gone. Open by quickly summarising last week's training from the context (a sentence or two: what they did, anything notable). Then ask how training felt this week and how they are feeling. Follow up once if the answer is thin. Ask specifically about any new niggles or injuries, and check in on any current ones listed above.
Part 2 — next week's schedule and travel. Briefly note what the calendar already shows, then ask what's on their schedule for next week that is NOT in the calendar — extra commitments, evenings that opened up — and specifically ask about travel: any nights away from home this week, where and when.
Part 3 — meals. Ask which nights next week they need dinners planned for (prep-ahead recipes), and whether there are nights they definitely don't need to cook. If they only mention travel, confirm whether the away nights are the meal nights.

Then call submit_checkin with everything gathered, faithfully in the runner's own terms.

CONFIRMATION GATE (applies to every mode): call confirm_checkin ONLY after an explicit, unambiguous yes to the apply question — "yes", "go ahead", "apply it". "Leave it", "not now", "no", "I'll think about it", hesitation, a topic change or a goodbye is a DECLINE: acknowledge, do NOT call confirm_checkin, and the plan stays untouched. If the answer is ambiguous, ask once more plainly. Never treat silence or politeness as consent. Read the returned summary back to the runner as the proposed changes to next week's training and meal plan, and ask if they're happy for you to apply it. If they want adjustments, gather them and call submit_checkin again with the updated answers. Once they clearly confirm, call confirm_checkin with the latest proposal_id, then relay the result and wrap up warmly in one or two sentences.

RULES:
- Never invent training data, calendar events or plan details beyond the context above.
- Never give medical advice; for anything worse than a niggle, suggest seeing a physio.
- Nutrition questions are yours to answer, qualitatively: carb-forward meals before and after hard or long sessions, sensible hydration around training, hearty recovery food. What you never give is numbers — no calories, macros, grams or body-weight targets. Do not dodge a fuelling question; answer it in qualitative terms.
- UK English. Dates as "15 Aug". Keep questions short — this is a phone call, not a form.`;

// Fully dynamic so the server can greet differently in revise mode.
const FIRST_MESSAGE = "{{greeting}}";

/** Dynamic variables the start route must supply for every conversation. */
export const DYNAMIC_VARIABLE_KEYS = [
  "today",
  "race_goal",
  "greeting",
  "meeting_mode",
  "recorded_feedback",
  "week_review",
  "current_injuries",
  "planned_week",
  "next_week_schedule",
] as const;

function agentPayload(toolIds: string[]) {
  return {
    name: "Run Coach — Sunday check-in",
    conversation_config: {
      agent: {
        first_message: FIRST_MESSAGE,
        language: "en",
        prompt: {
          prompt: AGENT_PROMPT,
          tool_ids: toolIds,
        },
        dynamic_variables: {
          dynamic_variable_placeholders: Object.fromEntries(
            DYNAMIC_VARIABLE_KEYS.map((k) => [k, ""])
          ),
        },
      },
    },
  };
}

/** Hash of everything that defines the agent — config drift forces recreation. */
function configHash(): string {
  return createHash("sha256")
    .update(JSON.stringify({ v: AGENT_CONFIG_VERSION, p: AGENT_PROMPT, f: FIRST_MESSAGE, t: CLIENT_TOOLS }))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Returns the check-in agent's id, creating the tools + agent via the
 * ElevenLabs API on first use (or when the config here has changed). The id
 * is cached in the voice_agent singleton row. ELEVENLABS_AGENT_ID overrides
 * everything for a dashboard-managed agent.
 */
export async function ensureVoiceAgent(): Promise<string> {
  const override = process.env.ELEVENLABS_AGENT_ID?.trim();
  if (override) return override;

  const supabase = createServiceClient();
  const hash = configHash();
  const { data: row } = await supabase
    .from("voice_agent")
    .select("agent_id, config_hash")
    .eq("id", true)
    .maybeSingle();
  if (row?.agent_id && row.config_hash === hash) return row.agent_id as string;

  // Create fresh tools, then the agent referencing them. A superseded agent is
  // left behind in the ElevenLabs workspace (single-user app; harmless).
  const toolIds: string[] = [];
  for (const tool of CLIENT_TOOLS) {
    const created = await elevenlabs<{ id: string }>("/v1/convai/tools", {
      method: "POST",
      body: JSON.stringify({ tool_config: tool }),
    });
    toolIds.push(created.id);
  }
  const agent = await elevenlabs<{ agent_id: string }>("/v1/convai/agents/create", {
    method: "POST",
    body: JSON.stringify(agentPayload(toolIds)),
  });

  const { error } = await supabase.from("voice_agent").upsert({
    id: true,
    agent_id: agent.agent_id,
    config_hash: hash,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    // Storage failure just means recreation next time — still usable now.
    console.warn("voice_agent upsert failed (run the voice migration?):", error.message);
  }
  return agent.agent_id;
}

/** Short-lived signed WebSocket URL for a private-agent conversation. */
export async function getSignedUrl(agentId: string): Promise<string> {
  const data = await elevenlabs<{ signed_url: string }>(
    `/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`
  );
  return data.signed_url;
}
