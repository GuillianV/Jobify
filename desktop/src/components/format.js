const CURRENCY_EUR = "EUR";
const EURO_SIGN = "€";

const PERIOD_LABELS = {
  YEARLY: "/ an",
  MONTHLY: "/ mois",
  HOURLY: "/ h",
};

const DATE_TIME_OPTIONS = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

/**
 * Format a number using French thousands grouping.
 * @param {number} value - The value to format.
 * @returns {string} The formatted number.
 */
function formatNumber(value) {
  return Number(value).toLocaleString("fr-FR");
}

/**
 * Build a human readable salary line from a normalized salary object.
 * @param {object|null} salary - The normalized salary.
 * @returns {string|null} The salary line, or null when unknown.
 */
function formatSalary(salary) {
  if (!salary) {
    return null;
  }
  const symbol = salary.currency === CURRENCY_EUR ? EURO_SIGN : (salary.currency ?? "");
  const period = PERIOD_LABELS[salary.period] ?? "";
  if (salary.min && salary.max) {
    return `${formatNumber(salary.min)} – ${formatNumber(salary.max)} ${symbol} ${period}`.trim();
  }
  if (salary.min) {
    return `À partir de ${formatNumber(salary.min)} ${symbol} ${period}`.trim();
  }
  return salary.raw ?? null;
}

/**
 * Format an ISO date string into a French date and time ("30/06/2026 11:21").
 * @param {string|null} isoString - The ISO 8601 date string.
 * @returns {string|null} The formatted date and time, or null when unknown.
 */
function formatDateTime(isoString) {
  if (!isoString) {
    return null;
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleString("fr-FR", DATE_TIME_OPTIONS);
}

/**
 * Open a URL in the user's default browser (via Electron) with a web fallback.
 * @param {string|null} url - The URL to open.
 * @returns {void}
 */
function openExternal(url) {
  if (!url) {
    return;
  }
  if (window.jobify && window.jobify.openExternal) {
    window.jobify.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener");
}

export { formatSalary, formatDateTime, openExternal };
