import { useEffect } from "react";
import { ContractBadge } from "./ContractBadge.jsx";
import { formatSalary, formatDateTime, openExternal } from "./format.js";
import { OfferPreparationConstants } from "../constants/OfferPreparationConstants.js";
import { isValidUserTextDraft } from "../services/OfferPreparationOrchestrator.js";
import { ApplicationBriefPanel } from "./ApplicationBriefPanel.jsx";
import { CoverLetterPanel } from "./CoverLetterPanel.jsx";

const UNKNOWN_COMPANY = "Entreprise non précisée";
const NO_DESCRIPTION = "Pas de description fournie par la source.";
const TRUNCATION_MARKERS = ["…", "..."];
const DIALOG_TITLE_ID = "offer-detail-title";

/**
 * Tell whether a description was truncated by its source, based on a trailing
 * ellipsis. Some sources only expose a shortened description.
 * @param {string|null} description - The offer description.
 * @returns {boolean} True when the description looks truncated.
 */
function isTruncated(description) {
  if (!description) {
    return false;
  }
  const trimmed = description.trimEnd();
  return TRUNCATION_MARKERS.some((marker) => {
    return trimmed.endsWith(marker);
  });
}

/**
 * Resolve the explicit retry label for the current failed operation.
 * @param {string|null} retryKind - Stable retry operation kind.
 * @returns {string} User-facing retry label.
 */
function getRetryLabel(retryKind) {
  if (retryKind === OfferPreparationConstants.RETRY_KIND.PROVIDER) {
    return "Réessayer la récupération";
  }
  if (retryKind === OfferPreparationConstants.RETRY_KIND.PERSIST_PROVIDER) {
    return "Réessayer l'enregistrement du contenu récupéré";
  }
  if (retryKind === OfferPreparationConstants.RETRY_KIND.USER_TEXT) {
    return "Réessayer l'enregistrement du texte";
  }
  return "Réessayer la préparation";
}

/**
 * Modal presenting one offer and controlled preparation actions.
 * @param {object} props - Component properties.
 * @param {object} props.offer - The normalized offer to display.
 * @param {object} props.preparationState - Controlled preparation UI state.
 * @param {Function} props.onClose - Called when the modal should close.
 * @param {Function} props.onPrepare - Starts explicit preparation.
 * @param {Function} props.onSubmitUserText - Submits the controlled user text.
 * @param {Function} props.onUserTextDraftChange - Updates the controlled draft.
 * @param {Function} props.onRetry - Retries the current failed operation.
 * @param {object} props.applicationBriefState - Controlled brief lifecycle state.
 * @param {boolean} props.candidateHasUnsavedChanges - Whether saved candidate data is stale.
 * @param {Function} props.onAnalyzeApplication - Starts explicit brief generation.
 * @param {Function} props.onRetryApplication - Retries explicit brief generation.
 * @param {object} props.coverLetter - Controlled CoverLetter presentation properties.
 * @returns {JSX.Element} The rendered modal.
 */
function OfferDetail({
  offer,
  preparationState,
  onClose,
  onPrepare,
  onSubmitUserText,
  onUserTextDraftChange,
  onRetry,
  applicationBriefState,
  candidateHasUnsavedChanges,
  onAnalyzeApplication,
  onRetryApplication,
  coverLetter,
}) {
  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const salary = formatSalary(offer.salary);
  const publishedAt = formatDateTime(offer.publishedAt);
  const company = offer.company?.name ?? UNKNOWN_COMPANY;
  const city = offer.location?.city ?? offer.location?.label ?? "";
  const handleOpen = () => {
    openExternal(offer.applyUrl);
  };
  const stopPropagation = (event) => {
    event.stopPropagation();
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8"
    >
      <div
        onClick={stopPropagation}
        role="dialog"
        aria-modal="true"
        aria-labelledby={DIALOG_TITLE_ID}
        className="w-full max-w-2xl rounded-2xl border border-border bg-surface-raised p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={DIALOG_TITLE_ID} className="font-display text-xl font-bold leading-snug">
              {offer.title}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {company}
              {city ? ` · ${city}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg border border-border px-3 py-1 text-sm text-muted transition hover:text-body"
          >
            Fermer
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <ContractBadge type={offer.contractType} />
          {salary ? (
            <span className="text-sm font-medium text-brand-700 dark:text-brand-300">
              {salary}
            </span>
          ) : null}
          <span className="text-xs uppercase tracking-wide text-muted">
            {offer.source}
          </span>
        </div>

        {publishedAt ? (
          <p className="mt-3 text-sm text-muted">
            Offre mise en ligne le{" "}
            <span className="font-medium text-body">{publishedAt}</span>
          </p>
        ) : null}

        <section className="mt-4 max-h-96 overflow-y-auto whitespace-pre-line text-sm leading-relaxed text-body">
          {offer.description || NO_DESCRIPTION}
        </section>

        {isTruncated(offer.description) ? (
          <p className="mt-2 text-xs italic text-muted">
            Description raccourcie par la source. Le texte complet est
            disponible sur l'annonce d'origine.
          </p>
        ) : null}

        <section className="mt-6 rounded-xl border border-border bg-surface p-4">
          {preparationState.uiStatus === OfferPreparationConstants.UI_STATUS.IDLE ? (
            <button
              type="button"
              onClick={onPrepare}
              className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-500"
            >
              Préparer ma candidature
            </button>
          ) : null}

          {preparationState.uiStatus === OfferPreparationConstants.UI_STATUS.PREPARING ? (
            <p className="text-sm text-muted">Préparation du contenu en cours…</p>
          ) : null}

          {preparationState.uiStatus
            === OfferPreparationConstants.UI_STATUS.ACQUIRING_PROVIDER_CONTENT ? (
              <p className="text-sm text-muted">Récupération du contenu complet en cours…</p>
            ) : null}

          {preparationState.uiStatus === OfferPreparationConstants.UI_STATUS.READY ? (
            <p className="text-sm font-medium text-brand-700 dark:text-brand-300">
              Le contenu de cette offre est suffisamment complet pour préparer la candidature.
            </p>
          ) : null}

          {preparationState.uiStatus === OfferPreparationConstants.UI_STATUS.ERROR ? (
            <div className="space-y-3">
              <p className="text-sm text-danger">{preparationState.error?.message}</p>
              <button
                type="button"
                onClick={onRetry}
                className="rounded-lg border border-brand-500 px-4 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-500 hover:text-white dark:text-brand-300"
              >
                {getRetryLabel(preparationState.retryKind)}
              </button>
            </div>
          ) : null}

          {preparationState.uiStatus === OfferPreparationConstants.UI_STATUS.NEEDS_USER_TEXT ? (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                Le contenu disponible n'est pas assez complet. Collez le texte complet de
                l'annonce pour le faire réévaluer.
              </p>
              {preparationState.retryKind === OfferPreparationConstants.RETRY_KIND.PROVIDER
                && !preparationState.error ? (
                  <p className="text-sm text-muted">
                    Le contenu complet n'a pas pu être récupéré automatiquement.
                  </p>
                ) : null}
              {preparationState.error ? (
                <p className="text-sm text-danger">{preparationState.error.message}</p>
              ) : null}
              {preparationState.retryKind ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="rounded-lg border border-brand-500 px-4 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-500 hover:text-white dark:text-brand-300"
                >
                  {getRetryLabel(preparationState.retryKind)}
                </button>
              ) : null}
              <textarea
                value={preparationState.userTextDraft}
                onChange={(event) => {
                  onUserTextDraftChange(event.target.value);
                }}
                rows="8"
                className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm outline-none focus:border-brand-500"
                placeholder="Collez ici le texte complet de l'annonce"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-muted">
                  {preparationState.userTextDraft.length} /{
                    OfferPreparationConstants.MAXIMUM_USER_TEXT_LENGTH
                  }
                </span>
                <button
                  type="button"
                  onClick={onSubmitUserText}
                  disabled={!isValidUserTextDraft(preparationState.userTextDraft)}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Enregistrer et réévaluer
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <ApplicationBriefPanel
          state={applicationBriefState}
          offerReady={preparationState.uiStatus === OfferPreparationConstants.UI_STATUS.READY}
          candidateHasUnsavedChanges={candidateHasUnsavedChanges}
          onAnalyze={onAnalyzeApplication}
          onRetry={onRetryApplication}
        />

        <CoverLetterPanel {...coverLetter} />

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={handleOpen}
            disabled={!offer.applyUrl}
            className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Voir l'annonce sur le site
          </button>
        </div>
      </div>
    </div>
  );
}

export { OfferDetail };
