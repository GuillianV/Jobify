import { useEffect, useId, useRef, useState } from "react";
import { CandidateDossierConstants } from "../constants/CandidateDossierConstants.js";
import { FieldError, RequiredIndicator } from "./CandidateDossierFormField.jsx";
import { MonthYearPicker } from "./MonthYearPicker.jsx";
import {
  editorDraftToExperience,
  experienceToEditorDraft,
  validateExperienceEditorDraft,
} from "../services/candidateDossierDraft.js";

const INPUT_CLASS = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand-500";

/**
 * Edit one Experience in an isolated local buffer before updating the dossier draft.
 * @param {object} props - Component properties.
 * @param {object} props.experience - Existing or newly created Experience draft.
 * @param {boolean} props.isNew - Whether the item is not yet in the dossier draft.
 * @param {Function} props.onConfirm - Receive one validated draft-global Experience.
 * @param {Function} props.onCancel - Discard the local buffer.
 * @param {Function} props.onDirtyChange - Report local unsaved editor changes.
 * @returns {JSX.Element} Inline Experience editor.
 */
function ExperienceEditor({ experience, isNew, onConfirm, onCancel, onDirtyChange }) {
  const [buffer, setBuffer] = useState(() => {
    return experienceToEditorDraft(experience);
  });
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const idPrefix = useId();
  const firstInputRef = useRef(null);
  const formRef = useRef(null);
  const validation = validateExperienceEditorDraft(buffer);
  const errors = hasAttemptedSubmit ? validation.fieldErrors : {};

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  useEffect(() => {
    onDirtyChange(JSON.stringify(buffer) !== JSON.stringify(experience));
  }, [buffer, experience, onDirtyChange]);

  const updateField = (field, value) => {
    setBuffer((current) => {
      return { ...current, [field]: value };
    });
  };

  const handleCurrentChange = (checked) => {
    setBuffer((current) => {
      return { ...current, current: checked, endDate: checked ? "" : current.endDate };
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
    onConfirm(editorDraftToExperience(buffer));
  };

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
      className="mt-4 rounded-xl border border-brand-300 bg-surface p-4"
    >
      <h4 className="font-display text-base font-semibold">
        {isNew ? "Nouvelle expérience" : "Modifier l'expérience"}
      </h4>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label htmlFor={`${idPrefix}-role`} className="text-sm font-medium">
          Poste / rôle<RequiredIndicator />
          <input
            ref={firstInputRef}
            id={`${idPrefix}-role`}
            type="text"
            required
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
        <label htmlFor={`${idPrefix}-organization`} className="text-sm font-medium">
          Entreprise / organisation<RequiredIndicator />
          <input
            id={`${idPrefix}-organization`}
            type="text"
            required
            maxLength={CandidateDossierConstants.LIMIT.TEXT_LENGTH}
            value={buffer.organization}
            aria-invalid={Boolean(errors.organization)}
            aria-describedby={errors.organization
              ? `${idPrefix}-organization-error`
              : undefined}
            onChange={(event) => {
              updateField("organization", event.target.value);
            }}
            className={`mt-1 ${INPUT_CLASS} ${errors.organization ? "border-danger focus:border-danger" : ""}`}
          />
          <FieldError
            id={`${idPrefix}-organization-error`}
            message={errors.organization}
          />
        </label>
        <label htmlFor={`${idPrefix}-client`} className="text-sm font-medium">
          Client <span className="font-normal text-muted">(facultatif)</span>
          <input
            id={`${idPrefix}-client`}
            type="text"
            maxLength={CandidateDossierConstants.LIMIT.TEXT_LENGTH}
            value={buffer.client}
            aria-invalid={Boolean(errors.client)}
            aria-describedby={errors.client ? `${idPrefix}-client-error` : undefined}
            onChange={(event) => {
              updateField("client", event.target.value);
            }}
            className={`mt-1 ${INPUT_CLASS} ${errors.client ? "border-danger focus:border-danger" : ""}`}
          />
          <FieldError id={`${idPrefix}-client-error`} message={errors.client} />
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
          disabled={buffer.current}
          error={errors.endDate}
          onChange={(value) => {
            updateField("endDate", value);
          }}
        />
      </div>

      <label htmlFor={`${idPrefix}-current`} className="mt-4 flex items-center gap-2 text-sm font-medium">
        <input
          id={`${idPrefix}-current`}
          type="checkbox"
          checked={buffer.current}
          onChange={(event) => {
            handleCurrentChange(event.target.checked);
          }}
        />
        Poste actuel
      </label>

      <div className="mt-4 grid gap-4">
        {[
          ["activities", "Missions principales", "Une mission par ligne"],
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

export { ExperienceEditor };
