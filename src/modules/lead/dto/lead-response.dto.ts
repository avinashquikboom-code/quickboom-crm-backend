/** Lead API response shape; internal records retain assignment fields. */
export type LeadResponseDto<T> = Omit<T, 'assignedToId' | 'assignedEmployee' | 'assignedToName'>;

/** Omit only top-level Lead fields, preserving nested customer/visit responses. */
export function toLeadResponse<T>(lead: T): LeadResponseDto<T> {
  if (lead == null) return lead;
  const response = { ...lead };
  delete (response as any).assignedToId;
  delete (response as any).assignedEmployee;
  delete (response as any).assignedToName;
  return response;
}
