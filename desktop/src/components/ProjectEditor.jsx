import { useEffect, useId, useRef, useState } from "react";
import { CandidateDossierConstants } from "../constants/CandidateDossierConstants.js";
import { FieldError, RequiredIndicator } from "./CandidateDossierFormField.jsx";
import { MonthYearPicker } from "./MonthYearPicker.jsx";
import {
  editorDraftToProject,
  projectToEditorDraft,
  validateProjectEditorDraft,
} from "../services/candidateDossierDraft.js";

const INPUT_CLASS = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand-500";

/**
 * Edit one Project in an isolated local buffer before updating the dossier draft.
 * @param {object} props - Component properties.
 * @param {object} props.project - Existing or newly created Project draft.
 * @param {boolean} props.isNew - Whether the item is not yet in the dossier draft.
 * @param {Function} props.onConfirm - Receive one validated draft-global Project.
 * @param {Function} props.onCancel - Discard the local buffer.
 * @param {Function} props.onDirtyChange - Report local unsaved editor changes.
 * @returns {JSX.Element} Inline Project editor.
 */
function ProjectEditor({ project, isNew, onConfirm, onCancel, onDirtyChange }) {
  const [buffer, setBuffer] = useState(() => {
    return projectToEditorDraft(project);
  });
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const idPrefix = useId();
  const firstInputRef = useRef(null);
  const formRef = useRef(null);
  const validation = validateProjectEditorDraft(buffer);
  const errors = hasAttemptedSubmit ? validation.fieldErrors : {};

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  useEffect(() => {
    onDirtyChange(JSON.stringify(buffer) !== JSON.stringify(project));
  }, [buffer, onDirtyChange, project]);

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
    onConfirm(editorDraftToProject(buffer));
  };

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
      className="mt-4 rounded-xl border border-brand-300 bg-surface p-4"
    >
      <h4 className="font-display text-base font-semibold">
        {isNew ? "Nouveau projet" : "Modifier le projet"}
      </h4>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label htmlFor={`${idPrefix}-name`} className="text-sm font-medium sm:col-span-2">
          Nom du projet<RequiredIndicator />
          <input
            ref={firstInputRef}
            id={`${idPrefix}-name`}
            type="text"
            required
            maxLength={CandidateDossierConstants.LIMIT.TEXT_LENGTH}
            value={buffer.name}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? `${idPrefix}-name-error` : undefined}
            onChange={(event) => {
              updateField("name", event.target.value);
            }}
            className={`mt-1 ${INPUT_CLASS} ${errors.name ? "border-danger focus:border-danger" : ""}`}
          />
          <FieldError id={`${idPrefix}-name-error`} message={errors.name} />
        </label>
        <label htmlFor={`${idPrefix}-role`} className="text-sm font-medium">
          Rôle <span className="font-normal text-muted">(facultatif)</span>
          <input
            id={`${idPrefix}-role`}
            type="text"
            maxLength={CandidateDossierConstants.LIMIT.TEXT_LENGTH}
            value={buffer.role}
            aria-invalid={Boolean(errors.role)}
            aria-describedby={errors.role ? `${idPrefix}-role-error` : undefined}
            onChange={(event) => {
              updateField("role", event.target.value);
            }}
            className={`mt-1 ${INPUT_CLASS} ${errors.role ? "border-danger focus:border-danger" : ""}`}
          />
          <FieldError id={`${idPrefix}-role-error`} message={errors.role} />
        </label>
        <label htmlFor={`${idPrefix}-domain`} className="text-sm font-medium">
          Secteur / domaine <span className="font-normal text-muted">(facultatif)</span>
          <input
            id={`${idPrefix}-domain`}
            type="text"
            maxLength={CandidateDossierConstants.LIMIT.TEXT_LENGTH}
            value={buffer.domain}
            aria-invalid={Boolean(errors.domain)}
            aria-describedby={errors.domain ? `${idPrefix}-domain-error` : undefined}
            onChange={(event) => {
              updateField("domain", event.target.value);
            }}
            className={`mt-1 ${INPUT_CLASS} ${errors.domain ? "border-danger focus:border-danger" : ""}`}
          />
          <FieldError id={`${idPrefix}-domain-error`} message={errors.domain} />
        </label>
        <MonthYearPicker
          id={`${idPrefix}-start-date`}
          label="Date de début"
          value={buffer.startDate}
          onChange={(value) => {
            updateField("startDate", value);
          }}
        />
        <MonthYearPicker
          id={`${idPrefix}-end-date`}
          label="Date de fin"
          value={buffer.endDate}
          error={errors.endDate}
          onChange={(value) => {
            updateField("endDate", value);
          }}
        />
      </div>

      <label htmlFor={`${idPrefix}-summary`} className="mt-4 block text-sm font-medium">
        Présentation <span className="font-normal text-muted">(facultatif)</span>
        <textarea
          id={`${idPrefix}-summary`}
          rows="4"
          maxLength={CandidateDossierConstants.LIMIT.SUMMARY_LENGTH}
          value={buffer.summary}
          aria-invalid={Boolean(errors.summary)}
          aria-describedby={errors.summary ? `${idPrefix}-summary-error` : undefined}
          onChange={(event) => {
            updateField("summary", event.target.value);
          }}
          className={`mt-1 ${INPUT_CLASS} ${errors.summary ? "border-danger focus:border-danger" : ""}`}
        />
        <FieldError id={`${idPrefix}-summary-error`} message={errors.summary} />
      </label>

      <div className="mt-4 grid gap-4">
        {[
          ["activities", "Activités / missions", "Une activité par ligne"],
          ["achievements", "Réalisations", "Une réalisation par ligne"],
          ["technologies", "Technologies / outils utilisés", "Un outil par ligne"],
        ].map(([field, label, placeholder]) => {
          return (
            <label key={field} htmlFor={`${idPrefix}-${field}`} className="text-sm font-medium">
              {label} <span className="font-normal text-muted">(facultatif)</span>
              <textarea
                id={`${idPrefix}-${field}`}
                rows="3"
                value={buffer[field]}
                aria-invalid={Boolean(errors[field])}
                aria-describedby={errors[field] ? `${idPrefix}-${field}-error` : undefined}
                placeholder={placeholder}
                onChange={(event) => {
                  updateField(field, event.target.value);
                }}
                className={`mt-1 ${INPUT_CLASS} ${errors[field] ? "border-danger focus:border-danger" : ""}`}
              />
              <FieldError id={`${idPrefix}-${field}-error`} message={errors[field]} />
            </label>
          );
        })}
      </div>

      <div className="mt-4 flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted transition hover:border-brand-400 hover:text-body"
        >
          Annuler
        </button>
        <button
          type="submit"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-500"
        >
          Valider
        </button>
      </div>
    </form>
  );
}

export { ProjectEditor };
