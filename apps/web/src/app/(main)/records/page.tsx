import Link from "next/link";
import { Suspense } from "react";
import { DayPicker } from "@/components/DayPicker";
import { MonthPicker } from "@/components/MonthPicker";
import { PaymentToggle } from "@/components/PaymentToggle";
import { WeekPicker } from "@/components/WeekPicker";
import {
  dailyPaymentSlot,
  dayCountLabel,
  formatClassDay,
  formatLKR,
  getISOWeekParts,
  monthLabel,
  parsePeriod,
  parseWeekPeriod,
  weekLabel,
} from "@/lib/format";
import { listClasses, listStudentsForPeriod } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<{
    year?: string;
    month?: string;
    week?: string;
    date?: string;
    status?: string;
    classId?: string;
  }>;
}) {
  const params = await searchParams;
  const status =
    params.status === "paid" || params.status === "unpaid"
      ? params.status
      : "all";
  const classId = params.classId ? Number(params.classId) : undefined;
  const classes = await listClasses();
  const selectedClass = Number.isFinite(classId)
    ? classes.find((c) => c.id === classId)
    : undefined;
  const isWeeklyView = selectedClass?.billing_period === "weekly";
  const isDailyView = selectedClass?.billing_period === "daily";

  const monthPeriod = parsePeriod(params);
  const weekPeriod = parseWeekPeriod(params);
  const classDate = weekPeriod.date;
  const classYear = Number(classDate.slice(0, 4));
  const classMonth = Number(classDate.slice(5, 7));

  const year = isDailyView
    ? classYear
    : isWeeklyView
      ? weekPeriod.year
      : monthPeriod.year;
  const month = isDailyView
    ? classMonth
    : isWeeklyView
      ? weekPeriod.month
      : monthPeriod.month;
  const week = isWeeklyView ? weekPeriod.week : 0;

  const students = await listStudentsForPeriod(year, month, week, {
    classId: Number.isFinite(classId) ? classId : undefined,
    status,
    billingPeriod: isDailyView ? "daily" : isWeeklyView ? "weekly" : "monthly",
    paymentSlot: isDailyView ? dailyPaymentSlot(classDate) : undefined,
  });

  const paidCount = students.filter((s) => s.is_paid).length;
  const unpaidCount = students.length - paidCount;
  const income = students.reduce((sum, s) => sum + (s.paid_amount ?? 0), 0);
  const periodText = isDailyView
    ? formatClassDay(classDate)
    : isWeeklyView
      ? weekLabel(year, week)
      : monthLabel(year, month);

  function hrefFor(next: {
    status?: string;
    classId?: string | number | null;
  }) {
    const q = new URLSearchParams();
    const nextClassId =
      next.classId === null
        ? null
        : next.classId !== undefined
          ? Number(next.classId)
          : classId;
    const nextClass =
      nextClassId != null && Number.isFinite(nextClassId)
        ? classes.find((c) => c.id === nextClassId)
        : undefined;

    if (nextClass?.billing_period === "daily") {
      q.set("date", classDate);
      q.set("year", String(classYear));
      q.set("classId", String(nextClass.id));
    } else if (nextClass?.billing_period === "weekly") {
      const w = week > 0 ? { year, week } : getISOWeekParts();
      q.set("year", String(w.year));
      q.set("week", String(w.week));
      q.set("classId", String(nextClass.id));
    } else {
      q.set("year", String(monthPeriod.year));
      q.set("month", String(monthPeriod.month));
      if (nextClassId != null && Number.isFinite(nextClassId)) {
        q.set("classId", String(nextClassId));
      }
    }

    q.set("status", next.status ?? status);
    return `/records?${q.toString()}`;
  }

  return (
    <div className="space-y-6">
      <section className="page-hero anim-fade-up">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow">Records</p>
            <h1
              className="mt-1 text-3xl font-semibold tracking-tight"
              style={{ fontFamily: "var(--font-display), serif" }}
            >
              Payment records
            </h1>
            <p className="mt-1 text-[var(--muted)]">
              {periodText} · {paidCount} paid · {unpaidCount} unpaid ·{" "}
              {formatLKR(income)} collected
              {isDailyView
                ? " · daily class"
                : isWeeklyView
                  ? " · weekly class"
                  : " · monthly classes"}
            </p>
          </div>
          <Suspense fallback={null}>
            {isDailyView ? (
              <DayPicker date={classDate} />
            ) : isWeeklyView ? (
              <WeekPicker
                year={year}
                week={week}
                date={parseWeekPeriod(params).date}
              />
            ) : (
              <MonthPicker year={year} month={month} />
            )}
          </Suspense>
        </div>
      </section>

      <section className="panel p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["all", "All"],
                ["paid", "Paid"],
                ["unpaid", "Unpaid"],
              ] as const
            ).map(([value, label]) => (
              <Link
                key={value}
                href={hrefFor({ status: value })}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  status === value
                    ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                    : "bg-[var(--surface)] text-[var(--muted)]"
                }`}
              >
                {label}
              </Link>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href={hrefFor({ classId: null })}
              className={`rounded-md px-3 py-1.5 text-sm ${
                !classId
                  ? "bg-[var(--ink)] text-white"
                  : "bg-[var(--surface)] text-[var(--muted)]"
              }`}
            >
              Monthly classes
            </Link>
            {classes.map((c) => (
              <Link
                key={c.id}
                href={hrefFor({ classId: c.id })}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  classId === c.id
                    ? "bg-[var(--ink)] text-white"
                    : "bg-[var(--surface)] text-[var(--muted)]"
                }`}
              >
                {c.name}
                {c.billing_period === "weekly"
                  ? " · W"
                  : c.billing_period === "daily"
                    ? " · D"
                    : ""}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="panel overflow-hidden">
        {students.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-[var(--muted)]">
            No matching students for this filter.
            {!isWeeklyView && !isDailyView
              ? " Select a daily or weekly class to view one period at a time."
              : ""}
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Class</th>
                  <th>Fee</th>
                  <th>Payment record</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <p className="font-medium">{s.name}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {s.phone || "No phone"}
                      </p>
                    </td>
                    <td>
                      <Link
                        href={
                          s.billing_period === "daily"
                            ? `/classes/${s.class_id}?date=${classDate}`
                            : s.billing_period === "weekly"
                              ? `/classes/${s.class_id}?year=${year}&week=${week}`
                              : `/classes/${s.class_id}?year=${year}&month=${month}`
                        }
                        className="hover:text-[var(--accent)]"
                      >
                        {s.class_name}
                      </Link>
                    </td>
                    <td>
                      {s.is_paid && s.paid_amount != null
                        ? formatLKR(s.paid_amount)
                        : formatLKR(s.monthly_fee)}
                    </td>
                    <td>
                      {isDailyView ? (
                        <div>
                          {(s.unpaid_slots?.length ?? 0) > 0 ? (
                            <span className="badge badge-unpaid">
                              {dayCountLabel(s.unpaid_slots?.length ?? 0)} unpaid
                            </span>
                          ) : (s.paid_slots?.length ?? 0) > 0 ? (
                            <span className="badge badge-paid">Paid up</span>
                          ) : (
                            <span className="badge badge-inactive">No days yet</span>
                          )}
                          <p className="mt-1.5 text-xs text-[var(--muted)]">
                            {s.is_paid
                              ? `This day paid on ${s.paid_on}`
                              : "This day not paid"}
                          </p>
                        </div>
                      ) : s.is_paid ? (
                        <div>
                          <span className="badge badge-paid">Paid</span>
                          <p className="mt-1.5 text-sm font-medium">
                            {s.paid_student_name || s.name}
                          </p>
                          <p className="text-xs text-[var(--muted)]">
                            Paid on {s.paid_on}
                          </p>
                        </div>
                      ) : (
                        <span className="badge badge-unpaid">Unpaid</span>
                      )}
                    </td>
                    <td className="text-right">
                      <PaymentToggle
                        studentId={s.id}
                        studentName={s.name}
                        classId={s.class_id}
                        year={year}
                        month={month}
                        week={week}
                        isPaid={Boolean(s.is_paid)}
                        defaultAmount={s.monthly_fee}
                        paidOn={s.paid_on}
                        periodLabel={
                          isDailyView
                            ? "this class day"
                            : isWeeklyView
                              ? "this week"
                              : "unpaid months"
                        }
                        mode={isDailyView ? "daily" : isWeeklyView ? "weekly" : "monthly"}
                        slot={isDailyView ? dailyPaymentSlot(classDate) : 0}
                        classDate={isDailyView ? classDate : undefined}
                        unpaidSlots={s.unpaid_slots ?? []}
                        paidSlots={s.paid_slots ?? []}
                        leftoverDates={s.leftover_dates ?? []}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
