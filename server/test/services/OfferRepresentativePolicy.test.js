import test from "node:test";
import assert from "node:assert/strict";
import { getEligibleRepresentatives } from "../../src/services/OfferRepresentativePolicy.js";
import { JobSource } from "../../src/constants/JobSource.js";

/**
 * Create the minimal candidate shape used by the policy.
 * @param {string} source - Provider source.
 * @returns {object} Candidate object.
 */
function candidate(source) {
  return { source };
}

test("representative policy keeps Careerjet when it is alone", () => {
  const careerjet = candidate(JobSource.CAREERJET);

  assert.deepEqual(getEligibleRepresentatives([careerjet]), [careerjet]);
});

test("representative policy excludes Careerjet without reordering alternatives", () => {
  const careerjet = candidate(JobSource.CAREERJET);
  const franceTravail = candidate(JobSource.FRANCE_TRAVAIL);
  const adzuna = candidate(JobSource.ADZUNA);
  const helloWork = candidate(JobSource.HELLOWORK);

  assert.deepEqual(getEligibleRepresentatives([careerjet, adzuna]), [adzuna]);
  assert.deepEqual(
    getEligibleRepresentatives([careerjet, franceTravail, helloWork]),
    [franceTravail, helloWork],
  );
  assert.deepEqual(getEligibleRepresentatives([adzuna, helloWork]), [adzuna, helloWork]);
});
