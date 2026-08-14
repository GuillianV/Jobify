/**
 * Render one accessible required marker without duplicating visible wording.
 * @returns {JSX.Element} Required field indicator.
 */
function RequiredIndicator() {
  return (
    <>
      <span className="text-danger" aria-hidden="true"> *</span>
      <span className="sr-only"> (obligatoire)</span>
    </>
  );
}

/**
 * Render one field-addressable inline validation error.
 * @param {object} props - Component properties.
 * @param {string} props.id - Error element identifier.
 * @param {string|null} props.message - Current field error.
 * @returns {JSX.Element|null} Inline error when present.
 */
function FieldError({ id, message }) {
  if (!message) {
    return null;
  }
  return <p id={id} className="mt-1 text-xs text-danger" aria-live="polite">{message}</p>;
}

export { FieldError, RequiredIndicator };
