import test from "node:test";
import assert from "node:assert/strict";
import { AdzunaConnector } from "../../src/connectors/AdzunaConnector.js";
import { OfferIdentityKind } from "../../src/constants/OfferIdentityKind.js";

test("mapOffer gives Adzuna observations a stable provider identity", () => {
  const connector = new AdzunaConnector({ appId: "test-app", appKey: "test-key" });
  const offer = connector.mapOffer({
    id: 123,
    title: "Developer",
    company: { display_name: "Example" },
    location: { display_name: "Annecy", area: ["France", "Annecy"] },
  });

  assert.equal(offer.sourceId, "123");
  assert.equal(offer.identityKind, OfferIdentityKind.STABLE);
});
