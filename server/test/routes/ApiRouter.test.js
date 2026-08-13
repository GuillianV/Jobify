import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationConstants } from "../../src/constants/ApplicationConstants.js";
import { OfferContentLimits } from "../../src/constants/OfferContentLimits.js";
import { ApiRouter } from "../../src/routes/ApiRouter.js";

const EXPECTED_JSON_LIMIT = "512kb";
const JSON_LIMIT_KILOBYTES = 512;
const BYTES_PER_KILOBYTE = 1024;

/**
 * Find one registered Express route by path and HTTP method.
 * @param {import("express").Router} router - Built API router.
 * @param {string} path - Expected route path.
 * @param {string} method - Lowercase HTTP method.
 * @returns {object|null} Matching Express layer.
 */
function findRoute(router, path, method) {
  return router.stack.find((layer) => {
    return layer.route?.path === path && Boolean(layer.route.methods[method]);
  }) ?? null;
}

test("API router exposes prepare and user-content intention routes", () => {
  const calls = [];
  const offerController = {
    prepareOffer() {
      calls.push("prepare");
    },
    replaceUserContent() {
      calls.push("user-content");
    },
    enrichOfferContent() {},
    searchOffers() {},
  };
  const profileController = {
    listProfiles() {},
    createProfile() {},
    deleteProfile() {},
  };
  const router = new ApiRouter(offerController, profileController).build();
  const prepareRoute = findRoute(router, "/offres/:id/prepare", "post");
  const userContentRoute = findRoute(router, "/offres/:id/contenu-utilisateur", "put");

  assert.notEqual(prepareRoute, null);
  assert.notEqual(userContentRoute, null);
  prepareRoute.route.stack[0].handle({}, {});
  userContentRoute.route.stack[0].handle({}, {});
  assert.deepEqual(calls, ["prepare", "user-content"]);
});

test("API router delegates only POST analysis requests to the offer controller", () => {
  const calls = [];
  const offerController = {
    analyseOffer(request, response) {
      calls.push({ request, response });
    },
    prepareOffer() {},
    replaceUserContent() {},
    enrichOfferContent() {},
    searchOffers() {},
  };
  const profileController = {
    listProfiles() {},
    createProfile() {},
    deleteProfile() {},
  };
  const router = new ApiRouter(offerController, profileController).build();
  const postRoute = findRoute(router, "/offres/:id/analyse", "post");
  const getRoute = findRoute(router, "/offres/:id/analyse", "get");
  const request = { params: { id: "42" } };
  const response = {};

  assert.notEqual(postRoute, null);
  assert.equal(getRoute, null);
  postRoute.route.stack[0].handle(request, response);
  assert.deepEqual(calls, [{ request, response }]);
});

test("JSON parser limit remains explicitly bounded above the business text limit", () => {
  assert.equal(ApplicationConstants.JSON_BODY_LIMIT, EXPECTED_JSON_LIMIT);
  assert.equal(
    JSON_LIMIT_KILOBYTES * BYTES_PER_KILOBYTE > OfferContentLimits.MAXIMUM_TEXT_LENGTH,
    true,
  );
});
