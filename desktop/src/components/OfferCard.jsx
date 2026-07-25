import { ContractBadge } from "./ContractBadge.jsx";
import { formatSalary, formatDateTime, openExternal } from "./format.js";

const UNKNOWN_COMPANY = "Entreprise non précisée";

/**
 * Card presenting a single normalized job offer. Clicking the card opens the
 * detail view; the apply button is a shortcut that does not open the detail.
 * @param {object} props - Component properties.
 * @param {object} props.offer - The normalized offer to render.
 * @param {Function} props.onSelect - Called with the offer when the card is clicked.
 * @returns {JSX.Element} The rendered card.
 */
function OfferCard({ offer, onSelect }) {
  const salary = formatSalary(offer.salary);
  const publishedAt = formatDateTime(offer.publishedAt);
  const company = offer.company?.name ?? UNKNOWN_COMPANY;
  const city = offer.location?.city ?? offer.location?.label ?? "";
  const handleSelect = () => {
    onSelect(offer);
  };
  const handleApply = (event) => {
    event.stopPropagation();
    openExternal(offer.applyUrl);
  };
  return (
    <article
      onClick={handleSelect}
      className="flex cursor-pointer flex-col rounded-xl border border-border bg-surface-raised p-4 shadow-sm transition hover:border-brand-400"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-base font-semibold leading-snug">
          {offer.title}
        </h3>
        <ContractBadge type={offer.contractType} />
      </div>
      <p className="mt-1 text-sm text-muted">
        {company}
        {city ? ` · ${city}` : ""}
      </p>
      {salary ? (
        <p className="mt-2 text-sm font-medium text-brand-700 dark:text-brand-300">
          {salary}
        </p>
      ) : null}
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs text-muted">
          {publishedAt ? `Publiée le ${publishedAt}` : offer.source}
        </span>
        <button
          type="button"
          onClick={handleApply}
          disabled={!offer.applyUrl}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Postuler
        </button>
      </div>
    </article>
  );
}

export { OfferCard };
