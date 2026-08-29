"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import {
  addManualActivity,
  deleteManualActivity,
  updateManualActivity,
} from "@/app/settings/actions";

// Quick-pick types mirror the plan's session types (rest excluded — nobody
// logs a rest day). "Other" reveals free text for anything else (football…).
const TYPE_CHIPS = [
  { value: "easy", label: "Easy run" },
  { value: "tempo", label: "Tempo" },
  { value: "intervals", label: "Intervals" },
  { value: "long", label: "Long run" },
  { value: "strength", label: "Strength" },
  { value: "cross", label: "Cross-training" },
  { value: "race", label: "Race" },
] as const;

/** Client mirror of the data layer's run detection — controls the km field. */
function isRunish(type: string): boolean {
  const s = type.toLowerCase().trim();
  return (
    ["easy", "tempo", "intervals", "long", "race"].includes(s) || s.includes("run")
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary flex-1">
      {pending ? (
        <>
          <span className="spinner" />
          Saving…
        </>
      ) : (
        label
      )}
    </button>
  );
}

type ManualDefaults = {
  id?: number;
  activity_date: string;
  type: string;
  duration_min?: number;
  distance_km?: number | null;
  note?: string | null;
};

function SessionSheet({
  defaults,
  onClose,
}: {
  defaults: ManualDefaults;
  onClose: () => void;
}) {
  const isEdit = defaults.id !== undefined;
  const presetValues = TYPE_CHIPS.map((c) => c.value as string);
  const initialIsPreset = presetValues.includes(defaults.type);
  const [type, setType] = useState(initialIsPreset ? defaults.type : "");
  const [other, setOther] = useState(initialIsPreset ? "" : defaults.type);
  const [usingOther, setUsingOther] = useState(!initialIsPreset && defaults.type !== "");
  const [typeMissing, setTypeMissing] = useState(false);

  const effectiveType = usingOther ? other : type;
  const showDistance = isRunish(effectiveType);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Cancel"
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,0.45)" }}
        onClick={onClose}
      />
      <form
        action={isEdit ? updateManualActivity : addManualActivity}
        onSubmit={(e) => {
          // The type comes from chips/hidden input, so `required` can't catch it.
          if (!effectiveType.trim()) {
            e.preventDefault();
            setTypeMissing(true);
            return;
          }
          onClose();
        }}
        className="relative mx-3 mb-3 flex w-full max-w-lg flex-col gap-3 rounded-2xl p-5 pb-safe"
        style={{ background: "var(--surface)", border: "1px solid var(--line)" }}
      >
        <h2 className="text-[17px] font-semibold">
          {isEdit ? "Edit logged session" : "Log a session"}
        </h2>
        {isEdit && <input type="hidden" name="id" value={defaults.id} />}

        <label className="flex flex-col gap-1">
          <span className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>
            Date
          </span>
          <input
            name="activity_date"
            type="date"
            defaultValue={defaults.activity_date}
            required
            className="input"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>
            Type
          </span>
          <div className="flex flex-wrap gap-1.5">
            {TYPE_CHIPS.map((chip) => {
              const active = !usingOther && type === chip.value;
              return (
                <button
                  key={chip.value}
                  type="button"
                  onClick={() => {
                    setType(chip.value);
                    setUsingOther(false);
                    setTypeMissing(false);
                  }}
                  className="min-h-[36px] rounded-lg px-3 text-[13px] font-semibold"
                  style={
                    active
                      ? { background: "var(--accent)", color: "var(--on-accent)" }
                      : { background: "var(--raised)", color: "var(--ink-2)" }
                  }
                >
                  {chip.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setUsingOther(true)}
              className="min-h-[36px] rounded-lg px-3 text-[13px] font-semibold"
              style={
                usingOther
                  ? { background: "var(--accent)", color: "var(--on-accent)" }
                  : { background: "var(--raised)", color: "var(--ink-2)" }
              }
            >
              Other
            </button>
          </div>
          {usingOther && (
            <input
              type="text"
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder="e.g. football, swimming"
              required
              className="input"
            />
          )}
          {typeMissing && (
            <p className="text-[12px] font-medium" style={{ color: "var(--danger)" }}>
              Pick a type first
            </p>
          )}
          {/* The action reads one `type` field regardless of how it was picked. */}
          <input type="hidden" name="type" value={effectiveType} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>
              Duration (min)
            </span>
            <input
              name="duration_min"
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              defaultValue={defaults.duration_min ?? ""}
              required
              className="input"
            />
          </label>
          {showDistance && (
            <label className="flex flex-col gap-1">
              <span className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>
                Distance (km, optional)
              </span>
              <input
                name="distance_km"
                type="number"
                inputMode="decimal"
                min="0.1"
                step="0.1"
                defaultValue={defaults.distance_km ?? ""}
                className="input"
              />
            </label>
          )}
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[13px] font-medium" style={{ color: "var(--ink-2)" }}>
            Note (optional)
          </span>
          <input
            name="note"
            type="text"
            defaultValue={defaults.note ?? ""}
            placeholder="e.g. Hotel gym — squats and lunges"
            className="input"
          />
        </label>

        <div className="mt-1 flex gap-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            Cancel
          </button>
          <SubmitButton label={isEdit ? "Save changes" : "Log session"} />
        </div>
      </form>
    </div>
  );
}

/**
 * "Log a session" entry point (round 2, U6) — for sessions that never reach
 * Strava. `defaultType` lets the Dashboard hero pre-select today's planned
 * session; `appearance` matches the app's button/text-action/tile patterns
 * ("tile" = a V2 Dashboard quick-action cell; pass the icon as children).
 */
export function LogSessionButton({
  todayIso,
  defaultType = "",
  appearance = "compact",
  label = "Log a session",
  children,
}: {
  todayIso: string;
  defaultType?: string;
  appearance?: "compact" | "secondary" | "tile";
  label?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {appearance === "secondary" ? (
        <button type="button" onClick={() => setOpen(true)} className="btn-secondary">
          {label}
        </button>
      ) : appearance === "tile" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="card flex min-h-[64px] w-full items-center gap-2.5 px-3.5 py-3 text-left"
        >
          {children && (
            <span className="shrink-0" style={{ color: "var(--accent)" }}>
              {children}
            </span>
          )}
          <span className="text-[14px] font-semibold leading-[18px]">{label}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-h-[44px] items-center gap-1 text-[13px] font-semibold"
          style={{ color: "var(--accent)" }}
        >
          {label}
        </button>
      )}
      {open && (
        <SessionSheet
          defaults={{ activity_date: todayIso, type: defaultType }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Edit/delete affordances on a manually logged Activity row (Strava rows get none). */
export function ManualActivityActions({
  manualId,
  activityDate,
  type,
  durationMin,
  distanceKm,
  note,
}: {
  manualId: number;
  activityDate: string;
  type: string;
  durationMin: number;
  distanceKm: number | null;
  note: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <span className="flex shrink-0 items-center gap-2">
      {confirming ? (
        <>
          <form action={deleteManualActivity} onSubmit={() => setConfirming(false)}>
            <input type="hidden" name="id" value={manualId} />
            <button
              type="submit"
              className="min-h-[36px] px-1 text-[13px] font-semibold"
              style={{ color: "var(--danger)" }}
            >
              Delete
            </button>
          </form>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="min-h-[36px] px-1 text-[13px] font-semibold"
            style={{ color: "var(--ink-2)" }}
          >
            Keep
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="min-h-[36px] px-1 text-[13px] font-semibold"
            style={{ color: "var(--accent)" }}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="min-h-[36px] px-1 text-[13px] font-semibold"
            style={{ color: "var(--ink-3)" }}
          >
            Delete
          </button>
        </>
      )}
      {editing && (
        <SessionSheet
          defaults={{
            id: manualId,
            activity_date: activityDate,
            type,
            duration_min: durationMin,
            distance_km: distanceKm,
            note,
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </span>
  );
}
