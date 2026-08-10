import { useEffect, useState } from "react";
import { ContractBadge } from "./ContractBadge.jsx";
import { formatSalary, formatDateTime, openExternal } from "./format.js";
import {
  acquireOfferDetail,
  shouldAcquireOfferDetail,
} from "../services/offerContentAcquisition.js";

const UNKNOWN_COMPANY = "Entreprise non précisée";
const NO_DESCRIPTION = "Pas de description fournie par la source.";
const LOADING_DESCRIPTION = "Chargement de la description…";
const TRUNCATION_MARKERS = ["…", "..."];

/**
 * Tell whether a description was truncated by its source, based on a trailing
 * ellipsis. Some sources (Adzuna) only expose a shortened description.
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
 * Modal presenting the full detail of a single offer: complete description,
 * publication date and time, and a button opening the original posting.
 * @param {object} props - Component properties.
 * @param {object} props.offer - The normalized offer to display.
 * @param {Function} props.onClose - Called when the modal should close.
 * @param {Function} props.onEnrich - Persists DETAIL and updates the parent offer.
 * @returns {JSX.Element} The rendered modal.
 */
function OfferDetail({ offer, onClose, onEnrich }) {
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

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

  useEffect(() => {
    setDetail(null);
    const fetchDetail = window.jobify?.fetchOfferDetail;
    const canEnrich = shouldAcquireOfferDetail(offer, fetchDetail);
    if (!canEnrich) {
      return undefined;
    }
    let cancelled = false;
    setDetailLoading(true);
    acquireOfferDetail(offer, fetchDetail, onEnrich)
      .then((enriched) => {
        if (cancelled) {
          return;
        }
        if (enriched) {
          setDetail(enriched);
        }
        setDetailLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setDetailLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [offer, onEnrich]);

  const effectiveDescription = detail?.description ?? offer.description;
  const effectiveSalary = detail?.salary ?? offer.salary;
  const effectivePublishedAt = detail?.publishedAt ?? offer.publishedAt;
  const salary = formatSalary(effectiveSalary);
  const publishedAt = formatDateTime(effectivePublishedAt);
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
        className="w-full max-w-2xl rounded-2xl border border-border bg-surface-raised p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold leading-snug">
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
          {effectiveDescription ? effectiveDescription : null}
          {!effectiveDescription && detailLoading ? LOADING_DESCRIPTION : null}
          {!effectiveDescription && !detailLoading ? NO_DESCRIPTION : null}
        </section>

        {isTruncated(effectiveDescription) ? (
          <p className="mt-2 text-xs italic text-muted">
            Description raccourcie par la source. Le texte complet est
            disponible sur l'annonce d'origine.
          </p>
        ) : null}

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
