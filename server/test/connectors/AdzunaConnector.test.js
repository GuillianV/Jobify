import test from "node:test";
import assert from "node:assert/strict";
import { AdzunaConnector } from "../../src/connectors/AdzunaConnector.js";
import { OfferIdentityKind } from "../../src/constants/OfferIdentityKind.js";
import { OfferContentAcquisition } from "../../src/constants/OfferContentAcquisition.js";
import { OfferContentCompleteness } from "../../src/constants/OfferContentCompleteness.js";

const RETRIEVED_AT = "2026-08-03T10:00:00.000Z";

test("mapOffer gives Adzuna observations a stable provider identity", () => {
  const connector = new AdzunaConnector({ appId: "test-app", appKey: "test-key" });
  const offer = connector.mapOffer({
    id: 123,
    title: "Developer",
    description: "Truncated text...",
    company: { display_name: "Example" },
    location: { display_name: "Annecy", area: ["France", "Annecy"] },
  }, RETRIEVED_AT);

  assert.equal(offer.sourceId, "123");
  assert.equal(offer.identityKind, OfferIdentityKind.STABLE);
  assert.equal(offer.description, "Truncated text...");
  assert.equal(offer.offerContent.automaticText.acquisition, OfferContentAcquisition.SEARCH);
  assert.equal(
    offer.offerContent.automaticText.completeness,
    OfferContentCompleteness.KNOWN_TRUNCATED,
  );
  assert.equal(offer.offerContent.automaticText.retrievedAt, RETRIEVED_AT);
  assert.equal(offer.offerContent.structured, null);
});
