// A request records "<outlet name> (<user name>)" as requester_name when it is
// made. That text, not the user's current placement, identifies its outlet.
const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
export function outletFromRequesterName(requesterName: string, master: { id: number; name: string; code: string }[]) {
  // Longest name first, so "Central Kitchen (CK)" is not mistaken for a shorter prefix.
  const candidates = [...master].sort((a, b) => b.name.length - a.name.length);
  const text = normalize(requesterName);
  return candidates.find(o => text === normalize(o.name) || text === normalize(o.code) || text.startsWith(`${normalize(o.name)} (`)) ?? null;
}
