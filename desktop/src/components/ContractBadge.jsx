const CONTRACT_STYLES = {
  CDI: "bg-brand-100 text-brand-800 dark:bg-brand-800 dark:text-brand-100",
  CDD: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  INTERIM: "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200",
  ALTERNANCE: "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200",
  STAGE: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  FREELANCE: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
  OTHER: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

const CONTRACT_LABELS = {
  CDI: "CDI",
  CDD: "CDD",
  INTERIM: "Intérim",
  ALTERNANCE: "Alternance",
  STAGE: "Stage",
  FREELANCE: "Freelance",
  OTHER: "Non précisé",
};

/**
 * Small colored badge showing the canonical contract type, using a
 * human-readable French label instead of the raw canonical token.
 * @param {object} props - Component properties.
 * @param {string} props.type - The canonical contract type.
 * @returns {JSX.Element} The rendered badge.
 */
function ContractBadge({ type }) {
  const style = CONTRACT_STYLES[type] ?? CONTRACT_STYLES.OTHER;
  const label = CONTRACT_LABELS[type] ?? CONTRACT_LABELS.OTHER;
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${style}`}>
      {label}
    </span>
  );
}

export { ContractBadge };
