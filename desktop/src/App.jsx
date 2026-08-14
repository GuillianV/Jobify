import { useCallback, useEffect, useRef, useState } from "react";
import { OfferCard } from "./components/OfferCard.jsx";
import { OfferDetail } from "./components/OfferDetail.jsx";
import { CandidateDossierView } from "./components/CandidateDossierView.jsx";
import { DISTANCE_OPTIONS_KM, DEFAULT_DISTANCE_KM } from "./constants/searchFilters.js";
import {
  acquireProviderContent,
  applyEnrichedOffer,
} from "./services/offerContentAcquisition.js";
import {
  persistProviderContent,
  prepareOffer,
  submitUserContent,
} from "./services/offerPreparation.js";
import {
  createPreparationState,
  OfferPreparationOrchestrator,
} from "./services/OfferPreparationOrchestrator.js";
import { claimInitialSearch, runLatestSearch } from "./services/searchOrchestration.js";

const SERVER_URL = "http://localhost:3001";
const OFFERS_ENDPOINT = "/api/offres";
const PROFILES_ENDPOINT = "/api/profils";
const STATUS_LOADING = "loading";
const STATUS_OK = "ok";
const STATUS_ERROR = "error";
const DEFAULT_KEYWORDS = "node.js";
const DEFAULT_CITY = "Annecy";
const VIEW_OFFERS = "offers";
const VIEW_CANDIDATE = "candidate";

/**
 * Scrape HelloWork client-side through the Electron bridge. Best-effort: any
 * failure (bridge absent in a browser, network, layout change) yields an empty
 * list so it never breaks the API results.
 * @param {string} searchKeywords - The searched keywords.
 * @param {string} searchCity - The searched city.
 * @returns {Promise<object[]>} The scraped offers.
 */
async function scrapeHelloWork(searchKeywords, searchCity) {
  if (!window.jobify || !window.jobify.scrapeHelloWork) {
    return [];
  }
  try {
    return await window.jobify.scrapeHelloWork(searchKeywords, searchCity);
  } catch {
    return [];
  }
}

/**
 * Perform a request and return its parsed JSON body, throwing on a non-ok
 * response so callers can surface the failure.
 * @param {string|URL} url - The request URL.
 * @param {object} [options] - The fetch options.
 * @returns {Promise<object>} The parsed JSON payload.
 */
async function requestJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Perform a request and report only whether it succeeded.
 * @param {string|URL} url - The request URL.
 * @param {object} [options] - The fetch options.
 * @returns {Promise<boolean>} True when the response is ok.
 */
async function requestOk(url, options) {
  const response = await fetch(url, options);
  return response.ok;
}

/**
 * Send the search to the server, including the client-scraped offers so they
 * are deduplicated and sorted with the API sources server-side.
 * @param {string} searchKeywords - The searched keywords.
 * @param {string} searchCity - The searched city.
 * @param {number} searchDistanceKm - The search radius in kilometers.
 * @param {object[]} scrapedOffers - The client-scraped offers to merge.
 * @returns {Promise<object[]>} The deduplicated, sorted offers.
 */
async function fetchOffers(searchKeywords, searchCity, searchDistanceKm, scrapedOffers) {
  const url = new URL(`${SERVER_URL}${OFFERS_ENDPOINT}`);
  url.searchParams.set("motsCles", searchKeywords);
  if (searchCity) {
    url.searchParams.set("lieu", searchCity);
    url.searchParams.set("distance", String(searchDistanceKm));
  }
  const payload = await requestJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scrapedOffers }),
  });
  return payload.offres ?? [];
}

/**
 * Fetch the saved search profiles from the server.
 * @returns {Promise<object[]>} The saved profiles.
 */
async function fetchProfiles() {
  const payload = await requestJson(`${SERVER_URL}${PROFILES_ENDPOINT}`);
  return payload.profils ?? [];
}

/**
 * Save the given search as a profile.
 * @param {object} profile - The profile to create (label, keywords, city, distanceKm).
 * @returns {Promise<boolean>} True when the profile was created.
 */
async function createProfile(profile) {
  return requestOk(`${SERVER_URL}${PROFILES_ENDPOINT}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });
}

/**
 * Delete a saved profile by its identifier.
 * @param {number} id - The profile identifier.
 * @returns {Promise<boolean>} True when the profile was deleted.
 */
async function deleteProfile(id) {
  return requestOk(`${SERVER_URL}${PROFILES_ENDPOINT}/${id}`, {
    method: "DELETE",
  });
}

/**
 * Root application component: a search bar and the list of normalized offers
 * returned by the aggregating server.
 * @returns {JSX.Element} The rendered application.
 */
function App() {
  const [activeView, setActiveView] = useState(VIEW_OFFERS);
  const [candidateViewOpened, setCandidateViewOpened] = useState(false);
  const [keywords, setKeywords] = useState(DEFAULT_KEYWORDS);
  const [city, setCity] = useState(DEFAULT_CITY);
  const [distanceKm, setDistanceKm] = useState(DEFAULT_DISTANCE_KM);
  const [offers, setOffers] = useState([]);
  const [status, setStatus] = useState(STATUS_LOADING);
  const [error, setError] = useState(null);
  const [selectedOffer, setSelectedOffer] = useState(null);
  const [preparationState, setPreparationState] = useState(() => {
    return createPreparationState();
  });
  const [profiles, setProfiles] = useState([]);
  const didRunInitialSearch = useRef(false);
  const searchRequestId = useRef(0);
  const preparationRequestIdRef = useRef(0);
  const preparationInFlightRef = useRef(false);
  const selectedOfferIdRef = useRef(null);
  const preparationStateRef = useRef(preparationState);
  const preparationOrchestratorRef = useRef(null);

  const updatePreparationState = useCallback((update) => {
    const current = preparationStateRef.current;
    const next = typeof update === "function" ? update(current) : update;
    preparationStateRef.current = next;
    setPreparationState(next);
  }, []);

  const applyPreparedOffer = useCallback((offer) => {
    applyEnrichedOffer(offer, setOffers, setSelectedOffer);
  }, []);

  if (!preparationOrchestratorRef.current) {
    preparationOrchestratorRef.current = new OfferPreparationOrchestrator({
      prepareOffer,
      submitUserContent,
      persistProviderContent,
      acquireProviderContent,
      fetchDetail(instruction) {
        return window.jobify?.fetchOfferDetail?.(instruction);
      },
      applyOffer: applyPreparedOffer,
      updateState: updatePreparationState,
      getState() {
        return preparationStateRef.current;
      },
      getSelectedOfferId() {
        return selectedOfferIdRef.current;
      },
      requestIdRef: preparationRequestIdRef,
      inFlightRef: preparationInFlightRef,
    });
  }

  const runSearch = useCallback(async (searchKeywords, searchCity, searchDistanceKm) => {
    await runLatestSearch({
      requestIdRef: searchRequestId,
      search: async () => {
        const scrapedOffers = await scrapeHelloWork(searchKeywords, searchCity);
        return fetchOffers(searchKeywords, searchCity, searchDistanceKm, scrapedOffers);
      },
      setOffers,
      setStatus,
      setError,
      loadingStatus: STATUS_LOADING,
      successStatus: STATUS_OK,
      errorStatus: STATUS_ERROR,
    });
  }, []);

  const loadProfiles = useCallback(async () => {
    try {
      setProfiles(await fetchProfiles());
    } catch (caught) {
      console.warn(caught.message);
    }
  }, []);

  useEffect(() => {
    if (claimInitialSearch(didRunInitialSearch)) {
      runSearch(DEFAULT_KEYWORDS, DEFAULT_CITY, DEFAULT_DISTANCE_KM);
    }
    loadProfiles();
  }, [runSearch, loadProfiles]);

  const handleSubmit = (event) => {
    event.preventDefault();
    runSearch(keywords, city, distanceKm);
  };

  const handleSaveProfile = async () => {
    const label = city ? `${keywords} · ${city}` : keywords;
    const created = await createProfile({ label, keywords, city, distanceKm });
    if (created) {
      loadProfiles();
    }
  };

  const handleRunProfile = (profile) => {
    const profileCity = profile.city ?? "";
    const profileDistance = profile.distanceKm ?? DEFAULT_DISTANCE_KM;
    setKeywords(profile.keywords);
    setCity(profileCity);
    setDistanceKm(profileDistance);
    runSearch(profile.keywords, profileCity, profileDistance);
  };

  const handleDeleteProfile = async (event, id) => {
    event.stopPropagation();
    const deleted = await deleteProfile(id);
    if (deleted) {
      loadProfiles();
    }
  };

  const handleSelectOffer = useCallback((offer) => {
    selectedOfferIdRef.current = offer.id;
    setSelectedOffer(offer);
    preparationOrchestratorRef.current.openOffer(offer.id);
  }, []);

  const handleCloseOffer = useCallback(() => {
    selectedOfferIdRef.current = null;
    setSelectedOffer(null);
    preparationOrchestratorRef.current.closeOffer();
  }, []);

  const handlePrepareOffer = useCallback(() => {
    return preparationOrchestratorRef.current.prepare();
  }, []);

  const handleUserTextDraftChange = useCallback((text) => {
    preparationOrchestratorRef.current.updateUserTextDraft(text);
  }, []);

  const handleSubmitUserText = useCallback(() => {
    return preparationOrchestratorRef.current.submitUserText();
  }, []);

  const handlePreparationRetry = useCallback(() => {
    return preparationOrchestratorRef.current.retry();
  }, []);

  const offerPlural = offers.length > 1 ? "s" : "";

  const handleViewChange = (view) => {
    setActiveView(view);
    if (view === VIEW_CANDIDATE) {
      setCandidateViewOpened(true);
    }
  };

  return (
    <div className="min-h-screen bg-surface font-sans text-body">
      <header className="border-b border-border bg-surface-raised">
        <div className="mx-auto max-w-4xl px-6 py-6">
          <h1 className="font-display text-3xl font-bold tracking-tight text-brand-700 dark:text-brand-300">
            Jobify
          </h1>
          <p className="mt-1 text-sm text-muted">
            Toutes les offres, normalisées, prêtes. L'humain décide.
          </p>
          <nav className="mt-4 flex gap-2" aria-label="Navigation principale">
            <button
              type="button"
              onClick={() => {
                handleViewChange(VIEW_OFFERS);
              }}
              aria-current={activeView === VIEW_OFFERS ? "page" : undefined}
              className={activeView === VIEW_OFFERS
                ? "rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
                : "rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted transition hover:border-brand-400 hover:text-body"}
            >
              Offres
            </button>
            <button
              type="button"
              onClick={() => {
                handleViewChange(VIEW_CANDIDATE);
              }}
              aria-current={activeView === VIEW_CANDIDATE ? "page" : undefined}
              className={activeView === VIEW_CANDIDATE
                ? "rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
                : "rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted transition hover:border-brand-400 hover:text-body"}
            >
              Dossier candidat
            </button>
          </nav>

          <div hidden={activeView !== VIEW_OFFERS}>
            <form onSubmit={handleSubmit} className="mt-4 flex flex-wrap gap-3">
            <input
              type="text"
              value={keywords}
              onChange={(event) => {
                setKeywords(event.target.value);
              }}
              placeholder="Métier, techno, mots-clés"
              className="min-w-52 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
            <input
              type="text"
              value={city}
              onChange={(event) => {
                setCity(event.target.value);
              }}
              placeholder="Ville"
              className="w-40 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
            <select
              value={distanceKm}
              onChange={(event) => {
                setDistanceKm(Number(event.target.value));
              }}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand-500"
            >
              {DISTANCE_OPTIONS_KM.map((option) => {
                return (
                  <option key={option} value={option}>
                    {option} km
                  </option>
                );
              })}
            </select>
            <button
              type="submit"
              className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-500"
            >
              Rechercher
            </button>
            </form>

            <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSaveProfile}
              className="rounded-full border border-brand-500 px-3 py-1 text-xs font-medium text-brand-700 transition hover:bg-brand-500 hover:text-white dark:text-brand-300"
            >
              + Enregistrer cette recherche
            </button>
            {profiles.map((profile) => {
              return (
                <span
                  key={profile.id}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1 text-xs"
                >
                  <button
                    type="button"
                    onClick={() => {
                      handleRunProfile(profile);
                    }}
                    className="text-body transition hover:text-brand-600"
                  >
                    {profile.label}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      handleDeleteProfile(event, profile.id);
                    }}
                    className="text-muted transition hover:text-danger"
                    aria-label="Supprimer le profil"
                  >
                    ×
                  </button>
                </span>
              );
            })}
            </div>
          </div>
        </div>
      </header>

      <main
        hidden={activeView !== VIEW_OFFERS}
        className="mx-auto max-w-4xl px-6 py-6"
      >
        {status === STATUS_LOADING ? (
          <p className="text-muted">Recherche des offres…</p>
        ) : null}

        {status === STATUS_ERROR ? (
          <p className="text-danger">
            Impossible de récupérer les offres — {error}. Le serveur est-il
            lancé (npm run dev:server) ?
          </p>
        ) : null}

        {status === STATUS_OK ? (
          <>
            <p className="mb-4 text-sm text-muted">
              {offers.length} offre{offerPlural} trouvée{offerPlural}
            </p>
            {offers.length === 0 ? (
              <p className="text-muted">
                Aucune offre pour cette recherche. Essaie d'autres mots-clés.
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {offers.map((offer) => {
                  return (
                    <OfferCard
                      key={offer.id}
                      offer={offer}
                      onSelect={handleSelectOffer}
                    />
                  );
                })}
              </div>
            )}
          </>
        ) : null}
      </main>

      {candidateViewOpened ? (
        <div hidden={activeView !== VIEW_CANDIDATE}>
          <CandidateDossierView />
        </div>
      ) : null}

      {selectedOffer && activeView === VIEW_OFFERS ? (
        <OfferDetail
          offer={selectedOffer}
          preparationState={preparationState}
          onClose={handleCloseOffer}
          onPrepare={handlePrepareOffer}
          onSubmitUserText={handleSubmitUserText}
          onUserTextDraftChange={handleUserTextDraftChange}
          onRetry={handlePreparationRetry}
        />
      ) : null}
    </div>
  );
}

export default App;
