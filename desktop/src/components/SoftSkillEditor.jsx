import { useEffect, useId, useRef, useState } from "react";
import { CandidateDossierConstants } from "../constants/CandidateDossierConstants.js";
import { FieldError, RequiredIndicator } from "./CandidateDossierFormField.jsx";
import {
  editorDraftToSoftSkill,
  softSkillToEditorDraft,
  validateSoftSkillEditorDraft,
} from "../services/candidateDossierDraft.js";

const INPUT_CLASS = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand-500";

/**
 * Edit one separate SoftSkill in an isolated local buffer.
 * @param {object} props - Component properties.
 * @param {object} props.softSkill - Existing or new SoftSkill draft.
 * @param {boolean} props.isNew - Whether the item is not yet global.
 * @param {Function} props.onConfirm - Receive the validated SoftSkill.
 * @param {Function} props.onCancel - Discard the local buffer.
 * @param {Function} props.onDirtyChange - Report local changes.
 * @returns {JSX.Element} Inline SoftSkill editor.
 */
function SoftSkillEditor({ softSkill, isNew, onConfirm, onCancel, onDirtyChange }) {
  const [buffer, setBuffer] = useState(() => {
    return softSkillToEditorDraft(softSkill);
  });
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const idPrefix = useId();
  const firstInputRef = useRef(null);
  const formRef = useRef(null);
  const validation = validateSoftSkillEditorDraft(buffer);
  const errors = hasAttemptedSubmit ? validation.fieldErrors : {};

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);
  useEffect(() => {
    onDirtyChange(JSON.stringify(buffer) !== JSON.stringify(softSkill));
  }, [buffer, onDirtyChange, softSkill]);

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
    onConfirm(editorDraftToSoftSkill(buffer));
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="mt-4 rounded-xl border border-brand-300 bg-surface p-4">
      <h4 className="font-display text-base font-semibold">
        {isNew ? "Nouvelle qualité professionnelle" : "Modifier la qualité professionnelle"}
      </h4>
      <label htmlFor={`${idPrefix}-value`} className="mt-4 block text-sm font-medium">
        Qualité professionnelle<RequiredIndicator />
        <input ref={firstInputRef} id={`${idPrefix}-value`} type="text" required maxLength={CandidateDossierConstants.LIMIT.TEXT_LENGTH} value={buffer.value} aria-invalid={Boolean(errors.value)} aria-describedby={errors.value ? `${idPrefix}-value-error` : undefined} onChange={(event) => {
          updateField("value", event.target.value);
        }} className={`mt-1 ${INPUT_CLASS} ${errors.value ? "border-danger focus:border-danger" : ""}`} />
        <FieldError id={`${idPrefix}-value-error`} message={errors.value} />
      </label>
      <label htmlFor={`${idPrefix}-detail`} className="mt-4 block text-sm font-medium">
        Précision <span className="font-normal text-muted">(facultatif)</span>
        <input id={`${idPrefix}-detail`} type="text" maxLength={CandidateDossierConstants.LIMIT.TEXT_LENGTH} value={buffer.detail} aria-invalid={Boolean(errors.detail)} aria-describedby={errors.detail ? `${idPrefix}-detail-error` : undefined} onChange={(event) => {
          updateField("detail", event.target.value);
        }} className={`mt-1 ${INPUT_CLASS} ${errors.detail ? "border-danger focus:border-danger" : ""}`} />
        <FieldError id={`${idPrefix}-detail-error`} message={errors.detail} />
      </label>
      <div className="mt-4 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted hover:border-brand-400 hover:text-body">Annuler</button>
        <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500">Valider</button>
      </div>
    </form>
  );
}

export { SoftSkillEditor };
