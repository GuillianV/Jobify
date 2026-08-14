import { useEffect, useRef } from "react";
import flatpickr from "flatpickr";
import { French } from "flatpickr/dist/l10n/fr.js";
import monthSelectPlugin from "flatpickr/dist/plugins/monthSelect/index.js";
import "flatpickr/dist/flatpickr.css";
import "flatpickr/dist/plugins/monthSelect/style.css";
import {
  monthYearValueToPickerDate,
  pickerDateToMonthYearValue,
} from "../services/monthYearPicker.js";

const INPUT_CLASS = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand-500 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Wrap Flatpickr's official monthSelect plugin for one nullable YYYY-MM field.
 * @param {object} props - Component properties.
 * @param {string} props.id - Stable input identifier.
 * @param {string} props.label - Public date field label.
 * @param {string|null} props.value - Nullable canonical YYYY-MM value.
 * @param {Function} props.onChange - Receive a canonical YYYY-MM value or null.
 * @param {boolean} [props.disabled] - Disable picker interaction.
 * @param {string|null} [props.error] - Inline validation error.
 * @returns {JSX.Element} One compact month-and-year picker field.
 */
function MonthYearPicker({ id, label, value, onChange, disabled = false, error = null }) {
  const inputRef = useRef(null);
  const pickerRef = useRef(null);
  const initialValueRef = useRef(value);
  const initialDisabledRef = useRef(disabled);
  const idRef = useRef(id);
  const labelRef = useRef(label);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return undefined;
    }
    const picker = flatpickr(input, {
      allowInput: false,
      altInput: true,
      altInputClass: INPUT_CLASS,
      altFormat: "F Y",
      clickOpens: !initialDisabledRef.current,
      closeOnSelect: true,
      dateFormat: "Y-m",
      defaultDate: monthYearValueToPickerDate(initialValueRef.current),
      disableMobile: true,
      locale: French,
      plugins: [monthSelectPlugin({
        altFormat: "F Y",
        dateFormat: "Y-m",
        shorthand: false,
        theme: "light",
      })],
      onChange: (selectedDates) => {
        onChangeRef.current(pickerDateToMonthYearValue(selectedDates[0] ?? null));
      },
      onReady: (_selectedDates, _dateString, instance) => {
        if (instance.altInput) {
          instance.altInput.id = `${idRef.current}-display`;
          instance.altInput.setAttribute("aria-label", labelRef.current);
        }
      },
    });
    pickerRef.current = picker;
    return () => {
      picker.destroy();
      pickerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const picker = pickerRef.current;
    if (!picker) {
      return;
    }
    const selectedValue = pickerDateToMonthYearValue(picker.selectedDates[0] ?? null);
    const nextValue = value || null;
    if (selectedValue === nextValue) {
      return;
    }
    const nextDate = monthYearValueToPickerDate(nextValue);
    if (nextDate) {
      picker.setDate(nextDate, false);
      return;
    }
    picker.clear(false);
  }, [value]);

  useEffect(() => {
    const picker = pickerRef.current;
    if (!picker) {
      return;
    }
    picker.set("clickOpens", !disabled);
    picker.input.disabled = disabled;
    if (picker.altInput) {
      picker.altInput.disabled = disabled;
    }
  }, [disabled]);

  useEffect(() => {
    const displayInput = pickerRef.current?.altInput;
    if (!displayInput) {
      return;
    }
    displayInput.setAttribute("aria-invalid", error ? "true" : "false");
    displayInput.classList.toggle("border-danger", Boolean(error));
    displayInput.classList.toggle("focus:border-danger", Boolean(error));
    if (error) {
      displayInput.setAttribute("aria-describedby", `${id}-error`);
      return;
    }
    displayInput.removeAttribute("aria-describedby");
  }, [error, id]);

  const clearSelection = () => {
    pickerRef.current?.clear(true);
  };

  return (
    <div className="min-w-0">
      <label htmlFor={`${id}-display`} className="text-sm font-medium">
        {label} <span className="font-normal text-muted">(facultatif)</span>
      </label>
      <div className="mt-1 flex items-center gap-2">
        <input
          ref={inputRef}
          id={id}
          type="text"
          disabled={disabled}
          className={INPUT_CLASS}
        />
        {value && !disabled ? (
          <button
            type="button"
            onClick={clearSelection}
            className="shrink-0 text-sm font-semibold text-muted hover:text-body"
          >
            Effacer
          </button>
        ) : null}
      </div>
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-danger" aria-live="polite">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export { MonthYearPicker };
