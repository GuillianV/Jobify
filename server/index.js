import path from "node:path";
import { AppConfig } from "./src/config/AppConfig.js";
import { JsonView } from "./src/views/JsonView.js";
import { OfferController } from "./src/controllers/OfferController.js";
import { ProfileController } from "./src/controllers/ProfileController.js";
import { FranceTravailConnector } from "./src/connectors/FranceTravailConnector.js";
import { AdzunaConnector } from "./src/connectors/AdzunaConnector.js";
import { CareerjetConnector } from "./src/connectors/CareerjetConnector.js";
import { OfferSearchService } from "./src/services/OfferSearchService.js";
import { SemanticRefiner } from "./src/services/SemanticRefiner.js";
import { getEligibleRepresentatives } from "./src/services/OfferRepresentativePolicy.js";
import { CommuneResolver } from "./src/services/CommuneResolver.js";
import { Database } from "./src/persistence/Database.js";
import { OfferRepository } from "./src/persistence/OfferRepository.js";
import { ProfileRepository } from "./src/persistence/ProfileRepository.js";
import { DatabaseConstants } from "./src/constants/DatabaseConstants.js";
import { ApiRouter } from "./src/routes/ApiRouter.js";
import { Application } from "./src/Application.js";

const config = new AppConfig(process.env);
const view = new JsonView();

const databasePath = path.join(
  import.meta.dirname,
  DatabaseConstants.DIRECTORY,
  DatabaseConstants.FILENAME,
);
const database = new Database(databasePath);
const offerRepository = new OfferRepository(database);
const profileRepository = new ProfileRepository(database);

const connectors = [
  new FranceTravailConnector(config.franceTravail),
  new AdzunaConnector(config.adzuna),
  new CareerjetConnector(config.careerjet),
];
const semanticRefiner = new SemanticRefiner(config.groq, getEligibleRepresentatives);
const offerSearchService = new OfferSearchService(
  connectors,
  semanticRefiner,
  offerRepository,
  getEligibleRepresentatives,
);
const communeResolver = new CommuneResolver();
const offerController = new OfferController(
  offerSearchService,
  communeResolver,
  view,
);
const profileController = new ProfileController(profileRepository, view);

const apiRouter = new ApiRouter(offerController, profileController);
const application = new Application(config, apiRouter);

application.start();
