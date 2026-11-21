import { sqlAll, sqlGet, sqlRun, type BillingPeriod } from "./db";
import {
  dailyPaymentSlot,
  dailySlotToDate,
  defaultAttendedOn,
  getISOWeekMonday,
  getISOWeekParts,
} from "./format";

export type ActionResult =
  | { ok: true; id?: number }
  | { ok: false; error: string };

function parseStudentNames(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((name) => String(name).trim()).filter(Boolean);
  }
  return String(raw || "")
    .split(/[\n,]+/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function parseBillingPeriod(raw: unknown): BillingPeriod {
  if (raw === "weekly" || raw === "daily") return raw;
  return "monthly";
}

function dailyPeriod(classDate: string) {
  const [year, month] = classDate.split("-").map(Number);
  return {
    year,
    month,
    week: 0,
    slot: dailyPaymentSlot(classDate),
  };
}

function dailyPeriodsFrom(
  periods: PaymentPeriod[],
  classDate: string | null,
): PaymentPeriod[] {
  const dates = new Set<string>();
  for (const period of periods) {
    const date = dailySlotToDate(period.slot);
    if (date) dates.add(date);
  }
  if (dates.size === 0 && classDate) dates.add(classDate);
  return [...dates].map((date) => dailyPeriod(date));
}

export async function createClass(input: {
  name?: unknown;
  monthly_fee?: unknown;
  billing_period?: unknown;
  students?: unknown;
}): Promise<ActionResult> {
  const name = String(input.name || "").trim();
  const monthlyFee = Number(input.monthly_fee || 0);
  const billingPeriod = parseBillingPeriod(input.billing_period);
  const studentNames = parseStudentNames(input.students);

  if (!name) return { ok: false, error: "Class name is required." };
  if (!Number.isFinite(monthlyFee) || monthlyFee < 0) {
    return { ok: false, error: "Fee must be a valid amount." };
  }

  try {
    const result = await sqlRun(
      `INSERT INTO classes (name, monthly_fee, billing_period) VALUES (?, ?, ?)`,
      [name, Math.round(monthlyFee), billingPeriod],
    );
    const classId = result.lastInsertRowid;

    for (const studentName of studentNames) {
      await sqlRun(
        `INSERT INTO students (class_id, name, phone, active) VALUES (?, ?, NULL, 1)`,
        [classId, studentName],
      );
    }

    return { ok: true, id: classId };
  } catch {
    return { ok: false, error: "A class with this name already exists." };
  }
}

export async function updateClass(input: {
  id?: unknown;
  name?: unknown;
  monthly_fee?: unknown;
  billing_period?: unknown;
}): Promise<ActionResult> {
  const id = Number(input.id);
  const name = String(input.name || "").trim();
  const monthlyFee = Number(input.monthly_fee || 0);
  const billingPeriod = parseBillingPeriod(input.billing_period);

  if (!id || !name) return { ok: false, error: "Invalid class details." };
  if (!Number.isFinite(monthlyFee) || monthlyFee < 0) {
    return { ok: false, error: "Fee must be a valid amount." };
  }

  try {
    await sqlRun(
      `UPDATE classes SET name = ?, monthly_fee = ?, billing_period = ? WHERE id = ?`,
      [name, Math.round(monthlyFee), billingPeriod, id],
    );
    return { ok: true, id };
  } catch {
    return { ok: false, error: "Could not update class (name may be taken)." };
  }
}

export async function deleteClass(idRaw: unknown): Promise<ActionResult> {
  const id = Number(idRaw);
  if (!id) return { ok: false, error: "Invalid class." };

  await sqlRun(`DELETE FROM classes WHERE id = ?`, [id]);
  return { ok: true };
}

export async function createStudent(input: {
  class_id?: unknown;
  name?: unknown;
  phone?: unknown;
}): Promise<ActionResult> {
  const classId = Number(input.class_id);
  const names = parseStudentNames(input.name);
  const phone = String(input.phone || "").trim() || null;

  if (!classId || names.length === 0) {
    return { ok: false, error: "Student name and class are required." };
  }

  for (const name of names) {
    await sqlRun(
      `INSERT INTO students (class_id, name, phone, active) VALUES (?, ?, ?, 1)`,
      [classId, name, phone],
    );
  }

  return { ok: true };
}

export async function updateStudent(input: {
  id?: unknown;
  name?: unknown;
  phone?: unknown;
  active?: unknown;
}): Promise<ActionResult> {
  const id = Number(input.id);
  const name = String(input.name || "").trim();
  const phone = String(input.phone || "").trim() || null;
  const active = input.active === "1" || input.active === 1 || input.active === true ? 1 : 0;

  if (!id || !name) return { ok: false, error: "Invalid student details." };

  await sqlRun(
    `UPDATE students SET name = ?, phone = ?, active = ? WHERE id = ?`,
    [name, phone, active, id],
  );

  return { ok: true };
}

export async function deleteStudent(idRaw: unknown): Promise<ActionResult> {
  const id = Number(idRaw);
  if (!id) return { ok: false, error: "Invalid student." };

  await sqlRun(`DELETE FROM students WHERE id = ?`, [id]);
  return { ok: true };
}

function parseISODate(raw: unknown): string | null {
  const value = String(raw || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

async function isHolidayDate(classId: number, attendedOn: string) {
  const { year, week } = getISOWeekParts(new Date(`${attendedOn}T00:00:00`));
  const row = await sqlGet<{ id: number }>(
    `SELECT id
     FROM class_holidays
     WHERE class_id = ?
       AND (
         holiday_on = ?
         OR (holiday_on IS NULL AND year = ? AND week = ?)
       )`,
    [classId, attendedOn, year, week],
  );
  return Boolean(row);
}

export async function setAttendance(input: {
  student_id?: unknown;
  year?: unknown;
  week?: unknown;
  attended?: unknown;
  attended_on?: unknown;
}): Promise<ActionResult> {
  const studentId = Number(input.student_id);
  const attended =
    input.attended === false ||
    input.attended === 0 ||
    input.attended === "0"
      ? 0
      : 1;
  const attendedOn = parseISODate(input.attended_on);
  const fromDate = attendedOn
    ? getISOWeekParts(new Date(`${attendedOn}T00:00:00`))
    : null;
  const year = fromDate?.year ?? Number(input.year);
  const week = fromDate?.week ?? Number(input.week);

  if (!studentId || !year || !Number.isFinite(week) || week < 1 || week > 53) {
    return { ok: false, error: "Student, year, and week are required." };
  }

  const student = await sqlGet<{ id: number; class_id: number }>(
    `SELECT id, class_id FROM students WHERE id = ?`,
    [studentId],
  );
  if (!student) return { ok: false, error: "Student not found." };

  if (!attended) {
    if (attendedOn) {
      await sqlRun(
        `DELETE FROM attendance WHERE student_id = ? AND attended_on = ?`,
        [studentId, attendedOn],
      );
    } else {
      await sqlRun(
        `DELETE FROM attendance WHERE student_id = ? AND year = ? AND week = ?`,
        [studentId, year, week],
      );
    }
    return { ok: true };
  }

  const onDate = attendedOn || defaultAttendedOn(year, week);
  if (!parseISODate(onDate)) {
    return { ok: false, error: "Attendance date must be YYYY-MM-DD." };
  }

  if (await isHolidayDate(student.class_id, onDate)) {
    return { ok: false, error: "This day is a holiday and does not count toward fees." };
  }

  const onParts = getISOWeekParts(new Date(`${onDate}T00:00:00`));
  await sqlRun(
    `INSERT INTO attendance (student_id, year, week, attended, attended_on)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(student_id, attended_on) DO UPDATE SET
       attended = 1,
       year = excluded.year,
       week = excluded.week`,
    [studentId, onParts.year, onParts.week, onDate],
  );
  return { ok: true };
}

export async function setAttendanceByDate(input: {
  class_id?: unknown;
  attended_on?: unknown;
  student_ids?: unknown;
}): Promise<ActionResult> {
  const classId = Number(input.class_id);
  const attendedOn = parseISODate(input.attended_on);
  const ids = Array.isArray(input.student_ids)
    ? input.student_ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
    : String(input.student_ids || "")
        .split(/[\s,]+/)
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0);

  if (!classId) return { ok: false, error: "Class is required." };
  if (!attendedOn) return { ok: false, error: "Pick the class date." };

  const cls = await sqlGet<{ id: number }>(
    `SELECT id FROM classes WHERE id = ?`,
    [classId],
  );
  if (!cls) return { ok: false, error: "Class not found." };

  if (await isHolidayDate(classId, attendedOn)) {
    return { ok: false, error: "This day is a holiday and does not count toward fees." };
  }

  const members = await sqlAll<{ id: number }>(
    `SELECT id FROM students WHERE class_id = ? AND active = 1`,
    [classId],
  );
  const allowed = new Set(members.map((row) => row.id));
  const present = new Set(ids);

  for (const studentId of present) {
    if (!allowed.has(studentId)) {
      return { ok: false, error: "One of the selected students is not in this class." };
    }
  }

  for (const member of members) {
    const result = await setAttendance({
      student_id: member.id,
      attended: present.has(member.id) ? 1 : 0,
      attended_on: attendedOn,
    });
    if (!result.ok) return result;
  }

  return { ok: true };
}

export async function setClassHoliday(input: {
  class_id?: unknown;
  year?: unknown;
  week?: unknown;
  holiday_on?: unknown;
  holiday?: unknown;
  clear_week?: unknown;
  note?: unknown;
}): Promise<ActionResult> {
  const classId = Number(input.class_id);
  const holidayOn = parseISODate(input.holiday_on);
  const fromDate = holidayOn
    ? getISOWeekParts(new Date(`${holidayOn}T00:00:00`))
    : null;
  const year = fromDate?.year ?? Number(input.year);
  const week = fromDate?.week ?? Number(input.week);
  const holiday =
    input.holiday === true ||
    input.holiday === 1 ||
    input.holiday === "1";
  const clearWeek =
    input.clear_week === true ||
    input.clear_week === 1 ||
    input.clear_week === "1";
  const note = String(input.note || "").trim() || null;

  if (!classId || !year || !Number.isFinite(week) || week < 1 || week > 53) {
    return { ok: false, error: "Class, year, and week are required." };
  }

  const cls = await sqlGet<{ id: number }>(
    `SELECT id FROM classes WHERE id = ?`,
    [classId],
  );
  if (!cls) return { ok: false, error: "Class not found." };

  if (!holiday) {
    if (holidayOn) {
      await sqlRun(
        `DELETE FROM class_holidays WHERE class_id = ? AND holiday_on = ?`,
        [classId, holidayOn],
      );
    }
    if (!holidayOn || clearWeek) {
      await sqlRun(
        `DELETE FROM class_holidays
         WHERE class_id = ? AND holiday_on IS NULL AND year = ? AND week = ?`,
        [classId, year, week],
      );
    }
    return { ok: true };
  }

  if (holidayOn) {
    await sqlRun(
      `INSERT INTO class_holidays (class_id, year, week, holiday_on, note)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(class_id, holiday_on) DO UPDATE SET
         year = excluded.year,
         week = excluded.week,
         note = excluded.note`,
      [classId, year, week, holidayOn, note],
    );
    return { ok: true };
  }

  const existing = await sqlGet<{ id: number }>(
    `SELECT id
     FROM class_holidays
     WHERE class_id = ? AND holiday_on IS NULL AND year = ? AND week = ?`,
    [classId, year, week],
  );
  if (existing) {
    await sqlRun(`UPDATE class_holidays SET note = ? WHERE id = ?`, [
      note,
      existing.id,
    ]);
    return { ok: true };
  }

  await sqlRun(
    `INSERT INTO class_holidays (class_id, year, week, holiday_on, note)
     VALUES (?, ?, ?, NULL, ?)`,
    [classId, year, week, note],
  );
  return { ok: true };
}

type PaymentPeriod = { year: number; month: number; slot: number; week: number };

function parsePeriods(input: {
  year?: unknown;
  month?: unknown;
  week?: unknown;
  slot?: unknown;
  periods?: unknown;
}): PaymentPeriod[] {
  if (Array.isArray(input.periods)) {
    return input.periods
      .map((raw) => {
        const row = raw as Record<string, unknown>;
        return {
          year: Number(row.year),
          month: Number(row.month),
          slot: Number(row.slot || 0),
          week: Number(row.week || 0),
        };
      })
      .filter(
        (row) =>
          Number.isFinite(row.year) &&
          row.year >= 2000 &&
          Number.isFinite(row.month) &&
          row.month >= 1 &&
          row.month <= 12,
      );
  }

  const year = Number(input.year);
  const month = Number(input.month);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return [];
  return [
    {
      year,
      month,
      slot: Number(input.slot || 0),
      week: Number(input.week || 0),
    },
  ];
}

export async function markPaid(input: {
  student_id?: unknown;
  year?: unknown;
  month?: unknown;
  week?: unknown;
  slot?: unknown;
  periods?: unknown;
  amount?: unknown;
  note?: unknown;
  paid_on?: unknown;
  class_date?: unknown;
}): Promise<ActionResult> {
  const studentId = Number(input.student_id);
  const year = Number(input.year);
  const monthRaw = Number(input.month);
  const weekRaw = Number(input.week || 0);
  const amountRaw = input.amount;
  const note = String(input.note || "").trim() || null;
  const paidOn =
    String(input.paid_on || "").trim() ||
    new Date().toLocaleDateString("en-CA");

  if (!studentId || !year) {
    return { ok: false, error: "Missing payment details." };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) {
    return { ok: false, error: "Payment date must be YYYY-MM-DD." };
  }

  const student = await sqlGet<{
    id: number;
    name: string;
    class_id: number;
    monthly_fee: number;
    billing_period: BillingPeriod;
  }>(
    `SELECT s.id, s.name, s.class_id, c.monthly_fee, c.billing_period
     FROM students s
     JOIN classes c ON c.id = s.class_id
     WHERE s.id = ?`,
    [studentId],
  );

  if (!student) return { ok: false, error: "Student not found." };

  let periods = parsePeriods({
    year,
    month: monthRaw,
    week: weekRaw,
    slot: input.slot,
    periods: input.periods,
  });

  const classDate = parseISODate(input.class_date) || dailySlotToDate(Number(input.slot));
  if (student.billing_period === "daily") {
    periods = dailyPeriodsFrom(periods, classDate);
    if (periods.length === 0) {
      return { ok: false, error: "Select at least one present day to pay." };
    }
  } else if (student.billing_period === "weekly") {
    const week = weekRaw;
    if (!Number.isFinite(week) || week < 1 || week > 53) {
      return { ok: false, error: "Valid week is required for weekly classes." };
    }
    const monday = getISOWeekMonday(year, week);
    periods = [
      {
        year,
        month: monday.getUTCMonth() + 1,
        week,
        slot: 0,
      },
    ];
  } else {
    periods = periods.map((period) => ({ ...period, week: 0 }));
    if (periods.length === 0) {
      return { ok: false, error: "Select at least one month to pay." };
    }
  }

  const amount =
    amountRaw !== null &&
    amountRaw !== undefined &&
    String(amountRaw).trim() !== ""
      ? Number(amountRaw)
      : student.monthly_fee * periods.length;

  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, error: "Invalid payment amount." };
  }

  const perPeriod =
    student.billing_period === "weekly"
      ? Math.round(amount)
      : Math.round(amount / periods.length);

  try {
    for (const period of periods) {
      await sqlRun(
        `INSERT INTO payments (student_id, student_name, year, month, week, slot, amount, paid_on, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(student_id, year, month, week, slot) DO UPDATE SET
           student_name = excluded.student_name,
           amount = excluded.amount,
           paid_on = excluded.paid_on,
           note = excluded.note`,
        [
          studentId,
          student.name,
          period.year,
          period.month,
          period.week,
          period.slot,
          perPeriod,
          paidOn,
          note,
        ],
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return {
      ok: false,
      error: message || "Could not save the payment.",
    };
  }

  return { ok: true };
}

export async function markUnpaid(input: {
  student_id?: unknown;
  year?: unknown;
  month?: unknown;
  week?: unknown;
  slot?: unknown;
  periods?: unknown;
  class_date?: unknown;
}): Promise<ActionResult> {
  const studentId = Number(input.student_id);
  const year = Number(input.year);
  const monthRaw = Number(input.month);
  const weekRaw = Number(input.week || 0);

  if (!studentId || !year) {
    return { ok: false, error: "Missing payment details." };
  }

  const student = await sqlGet<{ billing_period: BillingPeriod }>(
    `SELECT c.billing_period
     FROM students s
     JOIN classes c ON c.id = s.class_id
     WHERE s.id = ?`,
    [studentId],
  );

  if (!student) return { ok: false, error: "Student not found." };

  let periods = parsePeriods({
    year,
    month: monthRaw,
    week: weekRaw,
    slot: input.slot,
    periods: input.periods,
  });

  const classDate = parseISODate(input.class_date) || dailySlotToDate(Number(input.slot));
  if (student.billing_period === "daily") {
    periods = dailyPeriodsFrom(periods, classDate);
    if (periods.length === 0) {
      return { ok: false, error: "Select at least one class day to remove." };
    }
  } else if (student.billing_period === "weekly") {
    const week = weekRaw;
    if (!Number.isFinite(week) || week < 1 || week > 53) {
      return { ok: false, error: "Valid week is required." };
    }
    const monday = getISOWeekMonday(year, week);
    periods = [
      {
        year,
        month: monday.getUTCMonth() + 1,
        week,
        slot: 0,
      },
    ];
  } else {
    periods = periods.map((period) => ({ ...period, week: 0 }));
    if (periods.length === 0) {
      return { ok: false, error: "Select at least one month to remove." };
    }
  }

  for (const period of periods) {
    await sqlRun(
      `DELETE FROM payments
       WHERE student_id = ? AND year = ? AND month = ? AND week = ? AND slot = ?`,
      [studentId, period.year, period.month, period.week, period.slot],
    );
  }

  return { ok: true };
}
