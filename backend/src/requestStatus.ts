// A request's status is derived from its lines and nothing else. Each line is
// decided on its own (approve in full, approve part, or reject) and deciding
// one line never touches another, so the header only summarises them:
//   any line still pending        -> Pending (the request is still in progress)
//   every line approved in full   -> Approved
//   every line rejected           -> Rejected
//   anything else (a partial qty,
//   or approvals mixed with rejections) -> Partially Approved
export type RequestStatusLine = { status: string; requestedQuantity: number; approvedQuantity: number | null };
export function deriveRequestStatus(lines: RequestStatusLine[]): 'Pending' | 'Partially Approved' | 'Approved' | 'Rejected' {
  if (!lines.length || lines.some((line) => line.status === 'Pending')) return 'Pending';
  if (lines.every((line) => line.status === 'Rejected')) return 'Rejected';
  const approvedInFull = (line: RequestStatusLine) =>
    line.status === 'Approved' && Number(line.approvedQuantity || 0) >= Number(line.requestedQuantity);
  return lines.every(approvedInFull) ? 'Approved' : 'Partially Approved';
}
