"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { setAttendanceByDate } from "@/lib/actions";
import { getISOWeekParts } from "@/lib/format";

type StudentOption = {
  id: number;
  name: string;
  attended: boolean;
};

export function PresentByDateForm({
  classId,
  defaultDate,
  students,
  disabled,
}: {
  classId: number;
  defaultDate: string;
  students: StudentOption[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<number[]>(() =>
    students.filter((s) => s.attended).map((s) => s.id),
  );
  const [error, setError] = useState("");

  function goToDate(nextDate: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate) || nextDate === defaultDate) return;
    const parts = getISOWeekParts(new Date(`${nextDate}T00:00:00`));
    const params = new URLSearchParams(searchParams.toString());
    params.set("year", String(parts.year));
    params.set("week", String(parts.week));
    params.set("date", nextDate);
    router.push(`${pathname}?${params.toString()}`);
  }

  function toggle(id: number) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  }

  if (students.length === 0) return null;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        if (
          selected.length === 0 &&
          !confirm("Mark everyone absent on this class day?")
        ) {
          return;
        }
        startTransition(async () => {
          const fd = new FormData();
          fd.set("class_id", String(classId));
          fd.set("attended_on", defaultDate);
          for (const id of selected) fd.append("student_id", String(id));
          const result = await setAttendanceByDate(fd);
          if (!result.ok) setError(result.error);
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--muted)]">Class date</span>
          <input
            type="date"
            name="attended_on"
            className="field"
            value={defaultDate}
            disabled={disabled || pending}
            onChange={(e) => goToDate(e.target.value)}
            required
          />
        </label>
        <div>
          <p className="mb-1 text-sm text-[var(--muted)]">Present students</p>
          <div className="flex flex-wrap gap-2">
            {students.map((student) => {
              const checked = selected.includes(student.id);
              return (
                <label
                  key={student.id}
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                    checked
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                      : "border-[var(--line)] bg-white text-[var(--ink)]"
                  }`}
                >
                  <input
                    type="checkbox"
                    name="student_id"
                    value={student.id}
                    className="accent-[var(--accent)]"
                    checked={checked}
                    disabled={disabled || pending}
                    onChange={() => toggle(student.id)}
                  />
                  {student.name}
                </label>
              );
            })}
          </div>
        </div>
      </div>
      {error ? <p className="text-sm text-[var(--coral)]">{error}</p> : null}
      <button
        type="submit"
        className="btn-primary"
        disabled={disabled || pending}
      >
        {pending ? "Saving…" : "Save present students"}
      </button>
    </form>
  );
}
