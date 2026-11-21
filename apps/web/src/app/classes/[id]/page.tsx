import Link from "next/link";
import { Suspense } from "react";
import { AttendanceToggle } from "@/components/AttendanceToggle";
import { ClassForm } from "@/components/ClassForm";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { DayPicker } from "@/components/DayPicker";
import { HolidayToggle } from "@/components/HolidayToggle";
import { PaymentToggle } from "@/components/PaymentToggle";
import { PresentByDateForm } from "@/components/PresentByDateForm";
import { StudentForm } from "@/components/StudentForm";
import { deleteStudent, updateStudent } from "@/lib/actions";
import {
  dailyPaymentSlot,
  dayCountLabel,
  feeUnit,
  formatAttendanceDay,
  formatClassDay,
  formatLKR,
  parseWeekPeriod,
  slotPresentWeeks,
  slotUpcomingWeeks,
  WEEKS_PER_FEE_MONTH,
} from "@/lib/format";
import type { BillingPeriod, FeeSlot } from "@/lib/types";
import { getClass, getClassDayHoliday, listStudentsByClass } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ClassDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string; month?: string; week?: string; date?: string }>;
}) {
  const { id: idRaw } = await params;
  const id = Number(idRaw);
  const cls = Number.isFinite(id) ? await getClass(id) : undefined;
  if (!cls) {
    return (
      <div className="space-y-4">
        <Link href="/classes" className="text-sm text-[var(--accent)]">
          ← All classes
        </Link>
        <section className="page-hero">
          <p className="eyebrow">Class</p>
          <h1
            className="mt-1 text-3xl font-semibold tracking-tight"
            style={{ fontFamily: "var(--font-display), serif" }}
          >
            Class not found
          </h1>
          <p className="mt-2 text-[var(--muted)]">
            This class is not in the tracker. It may have been deleted.
          </p>
        </section>
      </div>
    );
  }

  const sp = await searchParams;
  const billingPeriod = cls.billing_period;
  const isDaily = billingPeriod === "daily";
  const isWeekly = billingPeriod === "weekly";
  const isMonthly = billingPeriod === "monthly";
  const weekPeriod = parseWeekPeriod(sp);
  const year = weekPeriod.year;
  const month = weekPeriod.month;
  const week = weekPeriod.week;
  const date = weekPeriod.date;
  const classYear = Number(date.slice(0, 4));
  const classMonth = Number(date.slice(5, 7));

  const [students, holiday] = await Promise.all([
    listStudentsByClass(
      id,
      isDaily ? classYear : year,
      isDaily ? classMonth : month,
      isDaily ? 0 : week,
      date,
      isDaily ? dailyPaymentSlot(date) : undefined,
    ),
    getClassDayHoliday(id, date),
  ]);
  const isHoliday = Boolean(holiday);
  const legacyWeekHoliday = Boolean(holiday && !holiday.holiday_on);
  const active = students.filter((s) => s.active === 1);
  const present = active.filter((s) => s.attended === 1).length;
  const paid = isMonthly
    ? active.filter((s) => (s.unpaid_months ?? 0) === 0).length
    : active.filter((s) => s.is_paid === 1).length;
  const unpaid = active.length - paid;
  const owingDays = isDaily
    ? active.filter((s) => (s.unpaid_slots?.length ?? 0) > 0).length
    : unpaid;
  const periodText = formatClassDay(date);
  const payMode = isDaily ? "daily" : isWeekly ? "weekly" : "monthly";

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3">
        <Link href="/classes" className="text-sm text-[var(--accent)]">
          ← All classes
        </Link>
        <div className="page-hero anim-fade-up">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="eyebrow">
                  {isDaily
                    ? "Daily class · mark attendance, then pay those days"
                    : isWeekly
                      ? "Weekly fee · attendance is marked per class day"
                      : "Monthly class · each class day counts · 4 days = 1 fee month"}
                </p>
              </div>
              <h1
                className="mt-1 text-3xl font-semibold tracking-tight"
                style={{ fontFamily: "var(--font-display), serif" }}
              >
                {cls.name}
              </h1>
              <p className="mt-1 text-[var(--muted)]">
                Fee {formatLKR(cls.monthly_fee)} {feeUnit(billingPeriod)} ·{" "}
                {periodText} · {present} present
                {isDaily
                  ? ` · ${owingDays} with days to pay`
                  : ` · ${paid} paid / ${unpaid} unpaid`}
              </p>
            </div>
            <Suspense fallback={null}>
              <DayPicker date={date} />
            </Suspense>
          </div>
        </div>
      </section>

      <section className="panel p-4 sm:p-5">
        <h2 className="mb-3 font-semibold">Edit class</h2>
        <ClassForm
          mode="edit"
          initial={{
            id: cls.id,
            name: cls.name,
            monthly_fee: cls.monthly_fee,
            billing_period: cls.billing_period,
          }}
        />
      </section>

      <section className="panel p-4 sm:p-5">
        <h2 className="mb-1 font-semibold">Add students</h2>
        <p className="mb-3 text-sm text-[var(--muted)]">
          Add one or more student names to this class.
        </p>
        <StudentForm classId={cls.id} />
      </section>

      <section className="panel p-4 sm:p-5">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-semibold">Add present by date</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {isDaily
                ? "Save who attended this date. Days can fall anywhere in the week. After that, pay one present day or several days together."
                : "Save who attended this class day. A class can meet a few days in the same week, and each date is kept separately. Absent days and holidays are not counted toward the 4-day fee month."}
            </p>
          </div>
          <HolidayToggle
            classId={cls.id}
            year={year}
            week={week}
            date={date}
            isHoliday={isHoliday}
            legacyWeek={legacyWeekHoliday}
          />
        </div>
        {isHoliday ? (
          <p className="mb-3 rounded-lg bg-[var(--gold-soft)] px-3 py-2 text-sm text-[#7a5a00]">
            {legacyWeekHoliday
              ? `${formatClassDay(date)} is inside a week that was marked as a holiday. Remove that week holiday if this class still meets on other days.`
              : `${formatClassDay(date)} is a holiday. It will not count toward fees.`}
          </p>
        ) : null}
        <PresentByDateForm
          key={date}
          classId={cls.id}
          defaultDate={date}
          disabled={isHoliday}
          students={active.map((s) => ({
            id: s.id,
            name: s.name,
            attended: Boolean(s.attended),
          }))}
        />
      </section>

      <section className="panel overflow-hidden">
        <div className="border-b border-[var(--line)] px-4 py-3">
          <h2 className="font-semibold">Attendance & payments</h2>
          <p className="text-sm text-[var(--muted)]">
            {isDaily
              ? `Mark who was present on ${formatClassDay(date)}. Pay covers any present days you select, including several days in one payment.`
              : `Mark who was present on ${formatClassDay(date)}. Other days in this week stay as they are. Four present days make one paying month.`}
          </p>
        </div>
        {students.length === 0 ? (
          <p className="px-4 py-8 text-sm text-[var(--muted)]">
            No students in this class yet.
          </p>
        ) : (
          <>
            <div className="mobile-card-list">
              {students.map((s) => (
                <article
                  key={s.id}
                  className={`mobile-card ${s.active ? "" : "opacity-60"}`}
                >
                  <StudentSummary student={s} billingPeriod={billingPeriod} />
                  {s.active ? (
                    <div className="action-bar mt-3">
                      <AttendanceToggle
                        studentId={s.id}
                        studentName={s.name}
                        classId={cls.id}
                        year={year}
                        week={week}
                        attendedOn={date}
                        attended={Boolean(s.attended)}
                        disabled={isHoliday}
                      />
                      <PaymentToggle
                        studentId={s.id}
                        studentName={s.name}
                        classId={cls.id}
                        year={year}
                        month={month}
                        week={week}
                        isPaid={Boolean(s.is_paid)}
                        defaultAmount={cls.monthly_fee}
                        paidOn={s.paid_on}
                        periodLabel={
                          isDaily ? "this class day" : isWeekly ? "this week" : "unpaid months"
                        }
                        mode={payMode}
                        slot={isDaily ? dailyPaymentSlot(date) : 0}
                        classDate={isDaily ? date : undefined}
                        unpaidSlots={s.unpaid_slots ?? []}
                        paidSlots={s.paid_slots ?? []}
                        leftoverDates={s.leftover_dates ?? []}
                      />
                    </div>
                  ) : null}
                  <StudentAdmin student={s} classId={cls.id} />
                </article>
              ))}
            </div>

            <div className="desktop-table table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>This day</th>
                    <th>Payment</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.id} className={s.active ? "" : "opacity-60"}>
                      <td>
                        <p className="font-medium">{s.name}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {s.phone || "No phone"}
                        </p>
                        {isMonthly && s.active ? (
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            {dayCountLabel(s.attendance_days ?? 0)} present
                            {openMonthProgress(s)}
                          </p>
                        ) : null}
                        {isDaily && s.active ? (
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            {dayCountLabel(s.attendance_days ?? 0)} present
                          </p>
                        ) : null}
                      </td>
                      <td>
                        {s.active ? (
                          <AttendanceToggle
                            studentId={s.id}
                            studentName={s.name}
                            classId={cls.id}
                            year={year}
                            week={week}
                            attendedOn={date}
                            attended={Boolean(s.attended)}
                            disabled={isHoliday}
                          />
                        ) : (
                          <span className="badge badge-inactive">Inactive</span>
                        )}
                      </td>
                      <td>
                        {s.active ? (
                          <div className="space-y-2">
                            <PaymentStatus student={s} billingPeriod={billingPeriod} />
                            <PaymentToggle
                              studentId={s.id}
                              studentName={s.name}
                              classId={cls.id}
                              year={year}
                              month={month}
                              week={week}
                              isPaid={Boolean(s.is_paid)}
                              defaultAmount={cls.monthly_fee}
                              paidOn={s.paid_on}
                              periodLabel={
                                isDaily ? "this class day" : isWeekly ? "this week" : "unpaid months"
                              }
                              mode={payMode}
                              slot={isDaily ? dailyPaymentSlot(date) : 0}
                              classDate={isDaily ? date : undefined}
                              unpaidSlots={s.unpaid_slots ?? []}
                              paidSlots={s.paid_slots ?? []}
                              leftoverDates={s.leftover_dates ?? []}
                            />
                          </div>
                        ) : (
                          <span className="text-sm text-[var(--muted)]">—</span>
                        )}
                      </td>
                      <td>
                        <StudentAdmin student={s} classId={cls.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function slotWeeks(_slot: { days?: string[] }) {
  return WEEKS_PER_FEE_MONTH;
}

function openMonthProgress(student: {
  unpaid_slots?: FeeSlot[];
  paid_slots?: FeeSlot[];
}) {
  const open = [...(student.unpaid_slots ?? []), ...(student.paid_slots ?? [])].find(
    (slot) => slotUpcomingWeeks(slot) > 0,
  );
  if (!open) return "";
  return ` · ${slotPresentWeeks(open)} of ${WEEKS_PER_FEE_MONTH} days · ${dayCountLabel(slotUpcomingWeeks(open))} upcoming`;
}

function PaymentStatus({
  student,
  billingPeriod,
}: {
  student: {
    is_paid: number;
    paid_student_name: string | null;
    name: string;
    paid_on: string | null;
    paid_amount: number | null;
    unpaid_months?: number;
    leftover_days?: number;
    leftover_dates?: string[];
    unpaid_slots?: FeeSlot[];
    paid_slots?: FeeSlot[];
    active: number;
  };
  billingPeriod: BillingPeriod;
}) {
  if (!student.active) {
    return <span className="badge badge-inactive">Inactive</span>;
  }
  if (billingPeriod === "daily") {
    const unpaidDays = student.unpaid_slots ?? [];
    const paidDays = student.paid_slots ?? [];
    const dueDays = unpaidDays.flatMap((slot) => slot.days ?? []);
    return (
      <div className="space-y-1.5">
        {unpaidDays.length > 0 ? (
          <span className="badge badge-unpaid">
            {dayCountLabel(unpaidDays.length)} unpaid
          </span>
        ) : paidDays.length > 0 ? (
          <span className="badge badge-paid">
            {dayCountLabel(paidDays.length)} paid
          </span>
        ) : (
          <span className="badge badge-inactive">No days yet</span>
        )}
        <p className="text-xs text-[var(--muted)]">
          {paidDays.length > 0
            ? `${dayCountLabel(paidDays.length)} paid`
            : "Nothing paid yet"}
          {unpaidDays.length > 0
            ? ` · ${dayCountLabel(unpaidDays.length)} still to pay`
            : paidDays.length > 0
              ? " · nothing left to pay"
              : ""}
        </p>
        {dueDays.length > 0 ? (
          <p className="text-xs text-[var(--muted)]">
            Days to pay: {dueDays.map(formatAttendanceDay).join(" · ")}
          </p>
        ) : null}
      </div>
    );
  }

  if (billingPeriod !== "monthly") {
    if (student.is_paid) {
      return (
        <div>
          <span className="badge badge-paid">Paid</span>
          <p className="mt-1.5 text-sm font-medium">
            {student.paid_student_name || student.name}
          </p>
          <p className="text-xs text-[var(--muted)]">
            Paid on {student.paid_on}
            {student.paid_amount != null ? ` · ${formatLKR(student.paid_amount)}` : ""}
          </p>
        </div>
      );
    }
    return <span className="badge badge-unpaid">Unpaid</span>;
  }

  const unpaidSlots = student.unpaid_slots ?? [];
  const paidSlots = student.paid_slots ?? [];
  const unpaidWeeks = unpaidSlots.reduce((sum, slot) => sum + slotWeeks(slot), 0);
  const paidWeeks = paidSlots.reduce((sum, slot) => sum + slotWeeks(slot), 0);
  const openSlot = [...unpaidSlots, ...paidSlots].find(
    (slot) => slotUpcomingWeeks(slot) > 0,
  );
  const present = openSlot ? slotPresentWeeks(openSlot) : 0;
  const upcoming = openSlot ? slotUpcomingWeeks(openSlot) : 0;
  const dueDays = unpaidSlots.flatMap((slot) => slot.days ?? []);
  const paidDays = paidSlots.flatMap((slot) => slot.days ?? []);

  return (
    <div className="space-y-1.5">
      {unpaidWeeks > 0 ? (
        <span className="badge badge-unpaid">
          {upcoming > 0 && unpaidSlots.some((slot) => slotUpcomingWeeks(slot) > 0)
            ? "Pay early"
            : `${dayCountLabel(unpaidWeeks)} unpaid`}
        </span>
      ) : (
        <span className="badge badge-paid">
          {paidWeeks > 0 ? `${dayCountLabel(paidWeeks)} paid` : "Up to date"}
        </span>
      )}
      <p className="text-xs text-[var(--muted)]">
        Paid {dayCountLabel(paidWeeks)}
        {" · "}
        {unpaidWeeks > 0
          ? `${dayCountLabel(unpaidWeeks)} remaining to pay`
          : "nothing remaining to pay"}
        {openSlot
          ? ` · ${present} of ${WEEKS_PER_FEE_MONTH} days · ${dayCountLabel(upcoming)} upcoming`
          : ""}
      </p>
      {dueDays.length > 0 ? (
        <p className="text-xs text-[var(--muted)]">
          Days to pay: {dueDays.map(formatAttendanceDay).join(" · ")}
        </p>
      ) : paidDays.length > 0 ? (
        <p className="text-xs text-[var(--muted)]">
          Paid days: {paidDays.map(formatAttendanceDay).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

function StudentSummary({
  student,
  billingPeriod,
}: {
  student: {
    id: number;
    name: string;
    phone: string | null;
    active: number;
    attended?: number;
    attendance_days?: number;
    leftover_days?: number;
    leftover_dates?: string[];
    unpaid_months?: number;
    unpaid_slots?: FeeSlot[];
    paid_slots?: FeeSlot[];
    is_paid: number;
    paid_on: string | null;
    paid_student_name: string | null;
    paid_amount: number | null;
  };
  billingPeriod: BillingPeriod;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="font-semibold">{student.name}</p>
        <p className="text-xs text-[var(--muted)]">{student.phone || "No phone"}</p>
        {billingPeriod === "monthly" && student.active ? (
          <p className="mt-1 text-xs text-[var(--muted)]">
            {dayCountLabel(student.attendance_days ?? 0)} present
            {openMonthProgress(student)}
          </p>
        ) : null}
        {billingPeriod === "daily" && student.active ? (
          <p className="mt-1 text-xs text-[var(--muted)]">
            {dayCountLabel(student.attendance_days ?? 0)} present
          </p>
        ) : null}
        {student.active ? (
          <div className="mt-2">
            <PaymentStatus student={student} billingPeriod={billingPeriod} />
          </div>
        ) : null}
      </div>
      {student.active ? (
        student.attended ? (
          <span className="badge badge-weekly">Present</span>
        ) : (
          <span className="badge badge-inactive">Absent</span>
        )
      ) : (
        <span className="badge badge-inactive">Inactive</span>
      )}
    </div>
  );
}

function StudentAdmin({
  student,
  classId,
}: {
  student: {
    id: number;
    name: string;
    phone: string | null;
    active: number;
  };
  classId: number;
}) {
  return (
    <div className="action-bar mt-3">
      <form>
        <input type="hidden" name="id" value={student.id} />
        <input type="hidden" name="class_id" value={classId} />
        <input type="hidden" name="name" value={student.name} />
        {student.phone ? (
          <input type="hidden" name="phone" value={student.phone} />
        ) : null}
        <input type="hidden" name="active" value={student.active ? "0" : "1"} />
        <ConfirmSubmit
          action={updateStudent}
          label={student.active ? "Deactivate" : "Activate"}
          message={
            student.active
              ? `Deactivate ${student.name}? They will be excluded from unpaid lists.`
              : `Activate ${student.name}?`
          }
          className="btn-ghost"
        />
      </form>
      <form>
        <input type="hidden" name="id" value={student.id} />
        <input type="hidden" name="class_id" value={classId} />
        <ConfirmSubmit
          action={deleteStudent}
          label="Delete"
          message={`Delete ${student.name} and their payment history?`}
          className="btn-danger"
        />
      </form>
    </div>
  );
}
