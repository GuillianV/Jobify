import test from "node:test";
import assert from "node:assert/strict";
import { FranceTravailConnector } from "../../src/connectors/FranceTravailConnector.js";
import { ContractType } from "../../src/constants/ContractType.js";
import { JobSource } from "../../src/constants/JobSource.js";

const EMPLOYER_DESCRIPTION = "<b>Description entreprise conservée</b>";
const RAW_OFFER = Object.freeze({
  id: "france-travail-offer",
  intitule: "Développeur backend",
  description: "<p>Mission <b>Node.js</b> &amp; API</p><p>Équipe</p>",
  entreprise: {
    nom: "Example France",
    description: EMPLOYER_DESCRIPTION,
    url: "https://example.com/company",
    logo: "https://example.com/logo.png",
  },
  lieuTravail: {
    libelle: "74000 - Annecy",
    codePostal: "74000",
    latitude: "45.899",
    longitude: "6.129",
  },
  origineOffre: {
    urlOrigine: "https://example.com/france-travail/backend",
  },
  salaire: {
    libelle: "Annuel de 45 000 euros",
  },
  typeContrat: "CDD",
  typeContratLibelle: "Contrat à durée déterminée",
  alternance: false,
  dateCreation: "2026-08-02T09:30:00Z",
});

test("mapOffer cleans France Travail descriptions and preserves structured fields", () => {
  const connector = new FranceTravailConnector({
    clientId: "test-client",
    clientSecret: "test-secret",
    scope: "test-scope",
  });
  const offer = connector.mapOffer(RAW_OFFER);
  const json = offer.toJson();

  assert.equal(offer.description, "Mission Node.js & API\n\nÉquipe");
  assert.equal(json.description, "Mission Node.js & API\n\nÉquipe");
  assert.equal(json.source, JobSource.FRANCE_TRAVAIL);
  assert.equal(json.sourceId, RAW_OFFER.id);
  assert.equal(json.title, RAW_OFFER.intitule);
  assert.equal(json.contractType, ContractType.CDD);
  assert.equal(json.contractTypeLabel, RAW_OFFER.typeContratLibelle);
  assert.equal(json.company.name, RAW_OFFER.entreprise.nom);
  assert.equal(json.company.description, EMPLOYER_DESCRIPTION);
  assert.equal(json.location.label, RAW_OFFER.lieuTravail.libelle);
  assert.equal(json.location.city, "Annecy");
  assert.equal(json.applyUrl, RAW_OFFER.origineOffre.urlOrigine);
  assert.equal(json.publishedAt, "2026-08-02T09:30:00.000Z");
});

test("mapOffer preserves a null France Travail description", () => {
  const connector = new FranceTravailConnector({
    clientId: "test-client",
    clientSecret: "test-secret",
    scope: "test-scope",
  });
  const offer = connector.mapOffer({ ...RAW_OFFER, description: null });

  assert.equal(offer.description, null);
  assert.equal(offer.toJson().description, null);
  assert.equal(offer.contractType, ContractType.CDD);
  assert.equal(offer.company.description, EMPLOYER_DESCRIPTION);
});
