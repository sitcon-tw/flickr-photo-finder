export const progressIntervalMs = 5000;

export function createProgressThrottle({ intervalMs = progressIntervalMs, now = Date.now } = {}) {
  let lastReportedAt = now();
  let lastReportedCompleted = 0;

  return (completed, { force = false } = {}) => {
    const current = now();
    if (completed === lastReportedCompleted) {
      return false;
    }
    if (!force && current - lastReportedAt < intervalMs) {
      return false;
    }

    lastReportedAt = current;
    lastReportedCompleted = completed;
    return true;
  };
}
