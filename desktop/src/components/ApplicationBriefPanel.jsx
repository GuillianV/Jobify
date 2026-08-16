import { ApplicationBriefConstants } from "../constants/ApplicationBriefConstants.js";
import {
  buildApplicationBriefPresentation,
  getApplicationBriefErrorMessage,
} from "../services/applicationBriefPresentation.js";

const SAVED_DOSSIER_NOTE = "L’analyse utilise uniquement les informations enregistrées dans votre dossier candidat.";
const DIRTY_DOSSIER_MESSAGE = "Enregistrez les modifications de votre dossier candidat avant de lancer l’analyse.";
const EMPTY_EVIDENCE_MESSAGE = "Votre dossier ne contient actuellement pas d’éléments permettant d’étayer ces points.";
const EMPTY_REQUIREMENTS_MESSAGE = "Aucun élément précis à comparer n’a été identifié dans cette offre.";

/**
 * Render evidence values associated with one user-facing item.
 * @param {object} props - Component properties.
 * @param {string[]} props.values - Resolved factual values.
 * @returns {JSX.Element|null} Evidence list or null.
 */
function EvidenceValues({ values }) {
  if (values.length === 0) {
    return null;
  }
  return (
    <div className="mt-2">
      <p className="text-xs font-semibold text-muted">Éléments de votre dossier</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
        {values.map((value) => {
          return <li key={value} className="whitespace-pre-wrap break-words">{value}</li>;
        })}
      </ul>
    </div>
  );
}

/**
 * Render one controlled on-demand ApplicationBrief panel.
 * @param {object} props - Component properties.
 * @param {object} props.state - Current ApplicationBrief lifecycle state.
 * @param {boolean} props.offerReady - Whether offer preparation is READY.
 * @param {boolean} props.candidateHasUnsavedChanges - Whether saved Candidate data is stale.
 * @param {Function} props.onAnalyze - Explicit analysis callback.
 * @param {Function} props.onRetry - Explicit retry callback.
 * @returns {JSX.Element} ApplicationBrief panel.
 */
function ApplicationBriefPanel({
  state,
  offerReady,
  candidateHasUnsavedChanges,
  onAnalyze,
  onRetry,
}) {
  const status = state.uiStatus;
  const canAnalyze = offerReady && !candidateHasUnsavedChanges;
  const presentation = status === ApplicationBriefConstants.UI_STATUS.SUCCESS
    ? buildApplicationBriefPresentation(state.brief)
    : null;
  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-4">
      <h3 className="font-display text-lg font-semibold">Analyse de votre candidature</h3>
      <p className="mt-1 text-sm text-muted">{SAVED_DOSSIER_NOTE}</p>

      {!offerReady ? (
        <p className="mt-3 text-sm text-muted">Préparez d’abord le contenu complet de l’offre.</p>
      ) : null}
      {candidateHasUnsavedChanges ? (
        <p role="alert" className="mt-3 text-sm text-danger">{DIRTY_DOSSIER_MESSAGE}</p>
      ) : null}

      {status === ApplicationBriefConstants.UI_STATUS.IDLE && canAnalyze ? (
        <button
          type="button"
          onClick={onAnalyze}
          className="mt-4 rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-500"
        >
          Analyser ma candidature
        </button>
      ) : null}

      {status === ApplicationBriefConstants.UI_STATUS.LOADING ? (
        <div className="mt-4">
          <button
            type="button"
            disabled
            className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white opacity-40"
          >
            Analyse en cours…
          </button>
          <p role="status" aria-live="polite" className="mt-2 text-sm text-muted">
            Analyse en cours…
          </p>
        </div>
      ) : null}

      {status === ApplicationBriefConstants.UI_STATUS.ERROR ? (
        <div className="mt-4 space-y-3">
          <p role="alert" className="text-sm text-danger">
            {getApplicationBriefErrorMessage(state.error)}
          </p>
          {canAnalyze ? (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg border border-brand-500 px-4 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-500 hover:text-white dark:text-brand-300"
            >
              Réessayer l’analyse
            </button>
          ) : null}
        </div>
      ) : null}

      {presentation ? (
        <div className="mt-6 space-y-6">
          <section>
            <h4 className="font-display font-semibold">Éléments de l’offre analysés</h4>
            {presentation.requirementMatches.length === 0 ? (
              <p className="mt-2 text-sm text-muted">{EMPTY_REQUIREMENTS_MESSAGE}</p>
            ) : (
              <div className="mt-3 space-y-3">
                {presentation.requirementMatches.map((match) => {
                  return (
                    <article key={match.key} className="rounded-lg border border-border bg-surface-raised p-3">
                      <p className="text-sm font-semibold text-brand-700 dark:text-brand-300">
                        {match.stateLabel}
                      </p>
                      {match.supportedFacets.map((facet) => {
                        return (
                          <div key={facet.key} className="mt-3">
                            <p className="whitespace-pre-wrap break-words text-sm">{facet.text}</p>
                            <EvidenceValues values={facet.evidenceValues} />
                          </div>
                        );
                      })}
                      {match.notEvidencedFacets.map((facet) => {
                        return (
                          <div key={facet.key} className="mt-3">
                            <p className="text-xs font-semibold text-muted">Non documenté dans votre dossier</p>
                            <p className="whitespace-pre-wrap break-words text-sm">{facet.text}</p>
                          </div>
                        );
                      })}
                    </article>
                  );
                })}
              </div>
            )}
            {!presentation.hasEvidence && presentation.requirementMatches.length > 0 ? (
              <p className="mt-3 text-sm text-muted">{EMPTY_EVIDENCE_MESSAGE}</p>
            ) : null}
          </section>

          {presentation.emphasis.length > 0 ? (
            <section>
              <h4 className="font-display font-semibold">Points à mettre en avant</h4>
              <div className="mt-3 space-y-3">
                {presentation.emphasis.map((item) => {
                  return (
                    <article key={item.key} className="rounded-lg border border-border bg-surface-raised p-3">
                      <p className="text-sm font-semibold text-brand-700 dark:text-brand-300">
                        {item.priorityLabel}
                      </p>
                      <p className="mt-2 text-xs font-semibold text-muted">Pourquoi ce point est pertinent</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.relevanceReason}</p>
                      <EvidenceValues values={item.evidenceValues} />
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          {presentation.cautions.length > 0 ? (
            <section>
              <h4 className="font-display font-semibold">Points de vigilance</h4>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
                {presentation.cautions.map((caution) => {
                  return <li key={caution.key} className="whitespace-pre-wrap break-words">{caution.message}</li>;
                })}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export { ApplicationBriefPanel };
