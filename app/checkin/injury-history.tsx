"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import {
  addInjuryHistory,
  deleteInjuryHistory,
  updateInjuryHistory,
} from "@/app/settings/actions";

type InjuryRow = {
  id: number;
  description: string;
  period: string;
  created_at: string;
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-secondary min-h-[38px] px-3.5 text-[13px]">
      {pending ? "Saving…" : label}
    </button>
  );
}

function InjuryFields({ initial }: { initial?: InjuryRow }) {
  return (
    <>
      <input
        name="description"
        defaultValue={initial?.description ?? ""}
        placeholder="e.g. Calf strain — recurring"
        required
        className="input min-h-[40px]"
      />
      <input
        name="period"
        defaultValue={initial?.period ?? ""}
        placeholder="When / how long (optional), e.g. winter 2024, ~6 weeks off"
        className="input min-h-[40px]"
      />
    </>
  );
}

/**
 * Past injuries (round 2, U5): visually secondary — background caution for
 * the planner, rarely edited. Add is one small form; edit swaps a row inline;
 * delete confirms in place.
 */
export function InjuryHistory({ items }: { items: InjuryRow[] }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 className="overline" style={{ color: "var(--ink-3)" }}>
          Past injuries
        </h2>
        {!adding && (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setEditingId(null);
            }}
            className="min-h-[36px] text-[13px] font-semibold"
            style={{ color: "var(--accent)" }}
          >
            Add
          </button>
        )}
      </div>
      <p className="-mt-1 text-[12px]" style={{ color: "var(--ink-3)" }}>
        Kept separate from current injuries above.
      </p>

      {adding && (
        <form
          action={addInjuryHistory}
          onSubmit={() => setAdding(false)}
          className="card flex flex-col gap-2 p-3"
        >
          <InjuryFields />
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="min-h-[38px] px-2 text-[13px] font-semibold"
              style={{ color: "var(--ink-2)" }}
            >
              Cancel
            </button>
            <SubmitButton label="Add injury" />
          </div>
        </form>
      )}

      {items.length === 0 && !adding ? (
        <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>
          Nothing recorded — long may it last.
        </p>
      ) : (
        items.length > 0 && (
          <ul className="card divide-y" style={{ borderColor: "var(--line)" }}>
            {items.map((item) =>
              editingId === item.id ? (
                <li key={item.id} style={{ borderColor: "var(--line)" }}>
                  <form
                    action={updateInjuryHistory}
                    onSubmit={() => setEditingId(null)}
                    className="flex flex-col gap-2 p-3"
                  >
                    <input type="hidden" name="id" value={item.id} />
                    <InjuryFields initial={item} />
                    <div className="flex items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="min-h-[38px] px-2 text-[13px] font-semibold"
                        style={{ color: "var(--ink-2)" }}
                      >
                        Cancel
                      </button>
                      <SubmitButton label="Save" />
                    </div>
                  </form>
                </li>
              ) : (
                <li
                  key={item.id}
                  className="flex items-center gap-3 px-3.5 py-2.5"
                  style={{ borderColor: "var(--line)" }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium">{item.description}</span>
                    {item.period && (
                      <span className="block text-[12px]" style={{ color: "var(--ink-3)" }}>
                        {item.period}
                      </span>
                    )}
                  </span>
                  {deletingId === item.id ? (
                    <span className="flex shrink-0 items-center gap-2">
                      <form action={deleteInjuryHistory} onSubmit={() => setDeletingId(null)}>
                        <input type="hidden" name="id" value={item.id} />
                        <button
                          type="submit"
                          className="min-h-[36px] px-1.5 text-[13px] font-semibold"
                          style={{ color: "var(--danger)" }}
                        >
                          Delete
                        </button>
                      </form>
                      <button
                        type="button"
                        onClick={() => setDeletingId(null)}
                        className="min-h-[36px] px-1.5 text-[13px] font-semibold"
                        style={{ color: "var(--ink-2)" }}
                      >
                        Keep
                      </button>
                    </span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(item.id);
                          setAdding(false);
                          setDeletingId(null);
                        }}
                        className="min-h-[36px] px-1.5 text-[13px] font-semibold"
                        style={{ color: "var(--accent)" }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingId(item.id)}
                        className="min-h-[36px] px-1.5 text-[13px] font-semibold"
                        style={{ color: "var(--ink-3)" }}
                      >
                        Delete
                      </button>
                    </span>
                  )}
                </li>
              )
            )}
          </ul>
        )
      )}
    </section>
  );
}
