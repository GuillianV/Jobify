import { useEffect, useId, useRef, useState } from "react";
import { CandidateDossierConstants } from "../constants/CandidateDossierConstants.js";
import { FieldError, RequiredIndicator } from "./CandidateDossierFormField.jsx";
import { MonthYearPicker } from "./MonthYearPicker.jsx";
import {
  educationToEditorDraft,
  editorDraftToEducation,
  validateEducationEditorDraft,
} from "../services/candidateDossierDraft.js";

const INPUT_CLASS = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand-500";

/**
 * Edit one Education item in an isolated local buffer.
 * @param {object} props - Component properties.
 * @param {object} props.education - Existing or new Education draft.
 * @param {boolean} props.isNew - Whether the item is not yet global.
 * @param {Function} props.onConfirm - Receive the validated Education item.
 * @param {Function} props.onCancel - Discard the local buffer.
 * @param {Function} props.onDirtyChange - Report local changes.
 * @returns {JSX.Element} Inline Education editor.
 */
function EducationEditor({ education, isNew, onConfirm, onCancel, onDirtyChange }) {
  const [buffer, setBuffer] = useState(() => {
    return educationToEditorDraft(education);
  });
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const idPrefix = useId();
  const firstInputRef = useRef(null);
  const formRef = useRef(null);
  const validation = validateEducationEditorDraft(buffer);
  const errors = hasAttemptedSubmit ? validation.fieldErrors : {};

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);
  useEffect(() => {
    onDirtyChange(JSON.stringify(buffer) !== JSON.stringify(education));
  }, [buffer, education, onDirtyChange]);

  const updateField = (field, value) => {
    setBuffer((current) => {
      return { ...current, [field]: value };
    });
  };
  const handleSubmit = (event) => {
    event.preventDefault();
    setHasAttemptedSubmit(true);
    if (!validation.valid) {
      globalThis.requestAnimationFrame(() => {
        formRef.current?.querySelector('[aria-invalid="true"]')?.focus();
      });
      return;
    }
    onConfirm(editorDraftToEducation(buffer));
  };
  const fields = [
    ["level", "Niveau"],
    ["field", "Domaine d'études"],
    ["institution", "Établissement"],
  ];

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="mt-4 rounded-xl border border-brand-300 bg-surface p-4">
      <h4 className="font-display text-base font-semibold">
        {isNew ? "Nouvelle formation" : "Modifier la formation"}
      </h4>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label htmlFor={`${idPrefix}-diploma`} className="text-sm font-medium sm:col-span-2">
          Diplôme<RequiredIndicator />
          <input ref={firstInputRef} id={`${idPrefix}-diploma`} type="text" required maxLength={CandidateDossierConstants.LIMIT.TEXT_LENGTH} value={buffer.diploma} aria-invalid={Boolean(errors.diploma)} aria-describedby={errors.diploma ? `${idPrefix}-diploma-error` : undefined} onChange={(event) => {
            updateField("diploma", event.target.value);
          }} className={`mt-1 ${INPUT_CLASS} ${errors.diploma ? "border-danger focus:border-danger" : ""}`} />
          <FieldError id={`${idPrefix}-diploma-error`} message={errors.diploma} />
        </label>
        {fields.map(([field, label]) => {
          return (
            <label key={field} htmlFor={`${idPrefix}-${field}`} className="text-sm font-medium">
              {label} <span className="font-normal text-muted">(facultatif)</span>
              <input id={`${idPrefix}-${field}`} type="text" maxLength={CandidateDossierConstants.LIMIT.TEXT_LENGTH} value={buffer[field]} aria-invalid={Boolean(errors[field])} aria-describedby={errors[field] ? `${idPrefix}-${field}-error` : undefined} onChange={(event) => {
                updateField(field, event.target.value);
              }} className={`mt-1 ${INPUT_CLASS} ${errors[field] ? "border-danger focus:border-danger" : ""}`} />
              <FieldError id={`${idPrefix}-${field}-error`} message={errors[field]} />
            </label>
          );
        })}
        <MonthYearPicker id={`${idPrefix}-start-date`} label="Date de début" value={buffer.startDate} onChange={(value) => {
          updateField("startDate", value);
        }} />
        <MonthYearPicker id={`${idPrefix}-end-date`} label="Date de fin" value={buffer.endDate} error={errors.endDate} onChange={(value) => {
          updateField("endDate", value);
        }} />
      </div>
      <div className="mt-4 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted hover:border-brand-400 hover:text-body">Annuler</button>
        <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500">Valider</button>
      </div>
    </form>
  );
}

export { EducationEditor };
