export type AttendanceDay = {
  date: string;
  day: string;
  shift: string;
  checkIn: string;
  checkOut: string;
  breakMinutes: number;
  workingHours: number;
  overtimeHours: number;
  status: string;
  remarks: string;
};

export type AttendanceSummary = {
  calendarDays: number;
  scheduledDays: number;
  presentDays: number;
  absentDays: number;
  halfDays: number;
  leaveDays: number;
  holidays: number;
  weeklyOffs: number;
  lateArrivals: number;
  earlyDepartures: number;
  overtimeHours: number;
  totalWorkingHours: number;
  attendancePercentage: number;
};

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function isWeeklyOff(date: Date, workingDaysPerWeek: number) {
  const day = date.getDay();
  if (workingDaysPerWeek >= 7) return false;
  if (workingDaysPerWeek <= 5) return day === 0 || day === 6;
  return day === 0;
}

export function eachDate(start: Date, end: Date) {
  const dates: Date[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cursor <= last) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export function monthBounds(year: number, month: number) {
  return {
    start: new Date(year, month - 1, 1),
    end: new Date(year, month, 0),
  };
}

function keyOf(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function clock(value?: Date | null) {
  if (!value) return '—';
  return value.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
}

export function buildAttendanceReport(input: {
  year: number;
  month: number;
  joiningDate?: Date | null;
  exitDate?: Date | null;
  shiftName?: string;
  workingDaysPerWeek: number;
  minWorkingHours: number;
  holidays: Array<{ date: Date; name: string }>;
  attendance: Array<{
    date: Date;
    punchIn?: Date | null;
    punchOut?: Date | null;
    workingHours?: number | null;
    breakDuration?: number | null;
    isLate?: boolean | null;
    status?: string | null;
  }>;
  approvedLeaveDates: string[];
}) {
  const { start, end } = monthBounds(input.year, input.month);
  const holidayKeys = new Map(input.holidays.map((holiday) => [keyOf(holiday.date), holiday.name]));
  const attendanceByDay = new Map(input.attendance.map((row) => [keyOf(row.date), row]));
  const leave = new Set(input.approvedLeaveDates);
  const days: AttendanceDay[] = [];
  const summary: AttendanceSummary = {
    calendarDays: 0,
    scheduledDays: 0,
    presentDays: 0,
    absentDays: 0,
    halfDays: 0,
    leaveDays: 0,
    holidays: 0,
    weeklyOffs: 0,
    lateArrivals: 0,
    earlyDepartures: 0,
    overtimeHours: 0,
    totalWorkingHours: 0,
    attendancePercentage: 0,
  };

  for (const date of eachDate(start, end)) {
    summary.calendarDays += 1;
    const key = keyOf(date);
    const joined = !input.joiningDate || date >= new Date(input.joiningDate.getFullYear(), input.joiningDate.getMonth(), input.joiningDate.getDate());
    const exited = input.exitDate && date > new Date(input.exitDate.getFullYear(), input.exitDate.getMonth(), input.exitDate.getDate());
    const row = attendanceByDay.get(key);
    const holiday = holidayKeys.get(key);
    const off = isWeeklyOff(date, input.workingDaysPerWeek);
    let status = 'ABSENT';
    let remarks = '';
    if (!joined) {
      status = 'NOT_JOINED';
      remarks = 'Before joining date';
    } else if (exited) {
      status = 'EXITED';
      remarks = 'After exit date';
    } else if (leave.has(key) || row?.status === 'LEAVE') {
      status = 'LEAVE';
      remarks = 'Approved leave';
      summary.leaveDays += 1;
    } else if (holiday) {
      status = 'HOLIDAY';
      remarks = holiday;
      summary.holidays += 1;
    } else if (off && row?.status !== 'PRESENT' && row?.status !== 'HALF_DAY' && row?.status !== 'LATE' && row?.status !== 'REMOTE') {
      status = 'WEEKLY_OFF';
      summary.weeklyOffs += 1;
    } else if (row?.status === 'HALF_DAY') {
      status = 'HALF_DAY';
      summary.halfDays += 1;
      summary.scheduledDays += 1;
    } else if (row?.punchIn && !row.punchOut) {
      status = 'MISSING_PUNCH';
      remarks = 'Missing check-out';
      summary.scheduledDays += 1;
      summary.absentDays += 1;
    } else if (row && ['PRESENT', 'LATE', 'REMOTE'].includes(String(row.status || 'PRESENT')) && (row.punchIn || row.workingHours)) {
      status = row.status === 'LATE' || row.isLate ? 'LATE' : String(row.status);
      summary.presentDays += 1;
      summary.scheduledDays += 1;
      if (row.isLate || row.status === 'LATE') summary.lateArrivals += 1;
    } else if (!off && !holiday) {
      status = 'ABSENT';
      summary.scheduledDays += 1;
      summary.absentDays += 1;
    }

    const worked = Number(row?.workingHours || 0);
    const overtime = status === 'WEEKLY_OFF' || status === 'HOLIDAY' ? worked : Math.max(0, worked - input.minWorkingHours);
    if (['PRESENT', 'LATE', 'REMOTE', 'HALF_DAY'].includes(status)) {
      summary.totalWorkingHours += worked;
      summary.overtimeHours += overtime;
      if (row?.punchOut && worked > 0 && worked + 0.25 < input.minWorkingHours && status !== 'HALF_DAY') {
        summary.earlyDepartures += 1;
        remarks = remarks || 'Early departure';
      }
    }
    days.push({
      date: key,
      day: DAY[date.getDay()],
      shift: input.shiftName || 'Assigned shift',
      checkIn: clock(row?.punchIn),
      checkOut: clock(row?.punchOut),
      breakMinutes: Math.round(Number(row?.breakDuration || 0)),
      workingHours: Math.round(worked * 100) / 100,
      overtimeHours: Math.round(overtime * 100) / 100,
      status,
      remarks,
    });
  }

  const attended = summary.presentDays + summary.halfDays * 0.5;
  summary.attendancePercentage = summary.scheduledDays ? Math.round((attended / summary.scheduledDays) * 1000) / 10 : 0;
  summary.totalWorkingHours = Math.round(summary.totalWorkingHours * 100) / 100;
  summary.overtimeHours = Math.round(summary.overtimeHours * 100) / 100;
  return { summary, days };
}
