import { useEffect, useId, useRef, useState } from "react";
import { CandidateDossierConstants } from "../constants/CandidateDossierConstants.js";
import { FieldError, RequiredIndicator } from "./CandidateDossierFormField.jsx";
import {
  editorDraftToLanguage,
  languageToEditorDraft,
  validateLanguageEditorDraft,
} from "../services/candidateDossierDraft.js";

const INPUT_CLASS = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand-500";

/**
 * Edit one Language with optional independently preserved detailed dimensions.
 * @param {object} props - Component properties.
 * @param {object} props.language - Existing or new Language draft.
 * @param {boolean} props.isNew - Whether the item is not yet global.
 * @param {Function} props.onConfirm - Receive the validated Language.
 * @param {Function} props.onCancel - Discard the local buffer.
 * @param {Function} props.onDirtyChange - Report local changes.
 * @returns {JSX.Element} Inline Language editor.
 */
function LanguageEditor({ language, isNew, onConfirm, onCancel, onDirtyChange }) {
  const [buffer, setBuffer] = useState(() => {
    return languageToEditorDraft(language);
  });
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [showDetails, setShowDetails] = useState(() => {
    return [language.reading, language.writing, language.speaking, language.listening]
      .some(Boolean);
  });
  const idPrefix = useId();
  const firstInputRef = useRef(null);
  const formRef = useRef(null);
  const validation = validateLanguageEditorDraft(buffer);
  const errors = hasAttemptedSubmit ? validation.fieldErrors : {};

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);
  useEffect(() => {
    onDirtyChange(JSON.stringify(buffer) !== JSON.stringify(language));
  }, [buffer, language, onDirtyChange]);

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
    onConfirm(editorDraftToLanguage(buffer));
  };
  const details = [
    ["reading", "Lecture"],
    ["writing", "Écriture"],
    ["speaking", "Expression orale"],
    ["listening", "Compréhension orale"],
  ];

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="mt-4 rounded-xl border border-brand-300 bg-surface p-4">
      <h4 className="font-display text-base font-semibold">
        {isNew ? "Nouvelle langue" : "Modifier la langue"}
      </h4>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label htmlFor={`${idPrefix}-language`} className="text-sm font-medium">
          Langue<RequiredIndicator />
          <input ref={firstInputRef} id={`${idPrefix}-language`} type="text" required maxLength={CandidateDossierConstants.LIMIT.TEXT_LENGTH} value={buffer.language} aria-invalid={Boolean(errors.language)} aria-describedby={errors.language ? `${idPrefix}-language-error` : undefined} onChange={(event) => {
            updateField("language", event.target.value);
          }} className={`mt-1 ${INPUT_CLASS} ${errors.language ? "border-danger focus:border-danger" : ""}`} />
          <FieldError id={`${idPrefix}-language-error`} message={errors.language} />
        </label>
        <label htmlFor={`${idPrefix}-overall`} className="text-sm font-medium">
          Niveau général <span className="font-normal text-muted">(facultatif)</span>
          <input id={`${idPrefix}-overall`} type="text" maxLength={CandidateDossierConstants.LIMIT.TEXT_LENGTH} value={buffer.overall} aria-invalid={Boolean(errors.overall)} aria-describedby={errors.overall ? `${idPrefix}-overall-error` : undefined} onChange={(event) => {
            updateField("overall", event.target.value);
          }} className={`mt-1 ${INPUT_CLASS} ${errors.overall ? "border-danger focus:border-danger" : ""}`} />
          <FieldError id={`${idPrefix}-overall-error`} message={errors.overall} />
        </label>
      </div>
      <button type="button" aria-expanded={showDetails} onClick={() => {
        setShowDetails((current) => {
          return !current;
        });
      }} className="mt-4 text-sm font-semibold text-brand-700 hover:text-brand-500 dark:text-brand-300">
        Détailler les compétences linguistiques
      </button>
      <div hidden={!showDetails} className="mt-4 grid gap-4 sm:grid-cols-2">
        {details.map(([field, label]) => {
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
      </div>
      <div className="mt-4 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted hover:border-brand-400 hover:text-body">Annuler</button>
        <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500">Valider</button>
      </div>
    </form>
  );
}

export { LanguageEditor };
