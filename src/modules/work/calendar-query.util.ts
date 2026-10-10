/** Accepts month=10&year=2026 and month=YYYY-MM. */
export function parseCalendarMonthYear(
  month?: string,
  year?: string,
): { month?: number; year?: number } {
  const rawMonth = month?.trim();
  if (rawMonth && /^\d{4}-\d{1,2}$/.test(rawMonth)) {
    const [yearPart, monthPart] = rawMonth.split('-').map((part) => parseInt(part, 10));
    if (yearPart >= 1970 && monthPart >= 1 && monthPart <= 12) {
      return { year: yearPart, month: monthPart };
    }
  }
  const parsedMonth = rawMonth ? parseInt(rawMonth, 10) : NaN;
  const parsedYear = year?.trim() ? parseInt(year.trim(), 10) : NaN;
  return {
    month: parsedMonth >= 1 && parsedMonth <= 12 ? parsedMonth : undefined,
    year: parsedYear >= 1970 ? parsedYear : undefined,
  };
}
