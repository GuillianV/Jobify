const MONTH_YEAR_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/u;
const YEAR_WIDTH = 4;
const MONTH_WIDTH = 2;

/**
 * Convert one canonical domain month into Flatpickr's local UI Date.
 * @param {string|null} value - Nullable YYYY-MM domain value.
 * @returns {Date|null} Local first day of the selected month or null.
 */
function monthYearValueToPickerDate(value) {
  if (!value) {
    return null;
  }
  const match = MONTH_YEAR_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, 1);
}

/**
 * Convert Flatpickr's local UI Date into the canonical domain month.
 * @param {Date|null} date - Picker-selected local Date.
 * @returns {string|null} Nullable YYYY-MM domain value.
 */
function pickerDateToMonthYearValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }
  const year = String(date.getFullYear()).padStart(YEAR_WIDTH, "0");
  const month = String(date.getMonth() + 1).padStart(MONTH_WIDTH, "0");
  return `${year}-${month}`;
}

export {
  monthYearValueToPickerDate,
  pickerDateToMonthYearValue,
};
