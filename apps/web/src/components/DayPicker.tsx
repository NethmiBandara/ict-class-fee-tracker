"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { formatClassDay, getISOWeekParts, shiftISODate } from "@/lib/format";

export function DayPicker({ date }: { date: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function go(nextDate: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) return;
    const parts = getISOWeekParts(new Date(`${nextDate}T00:00:00`));
    const params = new URLSearchParams(searchParams.toString());
    params.set("year", String(parts.year));
    params.set("week", String(parts.week));
    params.set("date", nextDate);
    params.delete("month");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn-ghost"
        onClick={() => go(shiftISODate(date, -1))}
      >
        ← Prev day
      </button>
      <div className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm font-medium">
        {formatClassDay(date)}
      </div>
      <button
        type="button"
        className="btn-ghost"
        onClick={() => go(shiftISODate(date, 1))}
      >
        Next day →
      </button>
      <label className="sr-only" htmlFor="class-day">
        Class date
      </label>
      <input
        id="class-day"
        type="date"
        className="field w-auto min-w-40"
        value={date}
        onChange={(e) => go(e.target.value)}
      />
    </div>
  );
}
