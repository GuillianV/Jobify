import { CoverLetterConstants } from "../constants/CoverLetterConstants.js";

const TEXTAREA_ID = "cover-letter-draft";

/**
 * Render the controlled CoverLetter generation, editing, and copy experience.
 * @param {object} props - Component properties.
 * @param {boolean} props.visible - Whether a useful CoverLetter context exists.
 * @param {string} props.uiStatus - Current orchestration status.
 * @param {string|null} props.errorMessage - Safe localized error message.
 * @param {string} props.draftLetter - Current user-editable letter.
 * @param {boolean} props.canGenerate - Whether generation is currently permitted.
 * @param {string} props.copyStatus - Current clipboard feedback status.
 * @param {Function} props.onGenerate - Start initial generation.
 * @param {Function} props.onRegenerate - Start replacement generation.
 * @param {Function} props.onDraftChange - Update only the editable draft.
 * @param {Function} props.onCopy - Copy the current editable draft.
 * @returns {JSX.Element|null} Controlled panel or null.
 */
function CoverLetterPanel({
  visible,
  uiStatus,
  errorMessage,
  draftLetter,
  canGenerate,
  copyStatus,
  onGenerate,
  onRegenerate,
  onDraftChange,
  onCopy,
}) {
  if (!visible) {
    return null;
  }
  const isLoading = uiStatus === CoverLetterConstants.UI_STATUS.LOADING;
  const hasDraft = draftLetter.length > 0;
  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-4">
      <h3 className="font-display text-lg font-semibold">Lettre de motivation</h3>

      {!hasDraft ? (
        <button
          type="button"
          onClick={onGenerate}
          disabled={!canGenerate || isLoading}
          className="mt-4 rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isLoading ? "Génération de la lettre en cours…" : "Générer une lettre de motivation"}
        </button>
      ) : null}

      {isLoading ? (
        <p role="status" aria-live="polite" className="mt-2 text-sm text-muted">
          Génération de la lettre en cours…
        </p>
      ) : null}

      {errorMessage ? (
        <p role="alert" className="mt-3 text-sm text-danger">{errorMessage}</p>
      ) : null}

      {hasDraft ? (
        <div className="mt-4 space-y-3">
          <label htmlFor={TEXTAREA_ID} className="block text-sm font-semibold">
            Votre lettre
          </label>
          <textarea
            id={TEXTAREA_ID}
            value={draftLetter}
            onChange={(event) => {
              onDraftChange(event.target.value);
            }}
            rows="14"
            className="w-full resize-y rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm leading-relaxed outline-none focus:border-brand-500"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onCopy}
              disabled={draftLetter.length === 0}
              className="rounded-lg border border-brand-500 px-4 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 dark:text-brand-300"
            >
              Copier la lettre
            </button>
            <button
              type="button"
              onClick={onRegenerate}
              disabled={!canGenerate || isLoading}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Générer à nouveau
            </button>
            {copyStatus === "copied" ? (
              <span role="status" aria-live="polite" className="text-sm text-success">
                Copié
              </span>
            ) : null}
            {copyStatus === "error" ? (
              <span role="alert" className="text-sm text-danger">
                Impossible de copier la lettre.
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export { CoverLetterPanel };
