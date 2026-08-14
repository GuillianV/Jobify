import { useEffect, useId, useRef, useState } from "react";
import { FieldError, RequiredIndicator } from "./CandidateDossierFormField.jsx";
import { validateBulkSkillInput } from "../services/candidateDossierDraft.js";

const INPUT_CLASS = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand-500";

/**
 * Edit several new skills for one fixed category in an isolated local buffer.
 * @param {object} props - Component properties.
 * @param {string} props.categoryLabel - Visible fixed group label.
 * @param {number} props.remainingCapacity - Remaining global skill capacity.
 * @param {Function} props.onConfirm - Receive valid line-oriented input.
 * @param {Function} props.onCancel - Discard the local buffer.
 * @param {Function} props.onDirtyChange - Report local changes.
 * @returns {JSX.Element} Sector-agnostic bulk skill editor.
 */
function BulkSkillEditor({
  categoryLabel,
  remainingCapacity,
  onConfirm,
  onCancel,
  onDirtyChange,
}) {
  const [text, setText] = useState("");
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const idPrefix = useId();
  const textareaRef = useRef(null);
  const validation = validateBulkSkillInput(text, remainingCapacity);
  const error = hasAttemptedSubmit ? validation.error : null;

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    onDirtyChange(text !== "");
  }, [onDirtyChange, text]);

  const handleSubmit = (event) => {
    event.preventDefault();
    setHasAttemptedSubmit(true);
    if (!validation.valid) {
      textareaRef.current?.focus();
      return;
    }
    onConfirm(text);
  };

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="mt-3 rounded-xl border border-brand-300 bg-surface p-4"
    >
      <h5 className="font-display text-sm font-semibold">Ajouter : {categoryLabel}</h5>
      <p className="mt-1 text-xs text-muted">
        Vous pourrez ajouter une précision ensuite en modifiant une compétence.
      </p>
      <label htmlFor={`${idPrefix}-skills`} className="mt-4 block text-sm font-medium">
        Une compétence par ligne<RequiredIndicator />
        <textarea
          ref={textareaRef}
          id={`${idPrefix}-skills`}
          rows="6"
          required
          value={text}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${idPrefix}-skills-error` : undefined}
          onChange={(event) => {
            setText(event.target.value);
          }}
          className={`mt-1 ${INPUT_CLASS} ${error ? "border-danger focus:border-danger" : ""}`}
        />
        <FieldError id={`${idPrefix}-skills-error`} message={error} />
      </label>
      <div className="mt-4 flex flex-wrap justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted hover:border-brand-400 hover:text-body"
        >
          Annuler
        </button>
        <button
          type="submit"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500"
        >
          Ajouter les compétences
        </button>
      </div>
    </form>
  );
}

export { BulkSkillEditor };
