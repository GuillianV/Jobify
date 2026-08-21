import path from "node:path";
import { AppConfig } from "./src/config/AppConfig.js";
import { JsonView } from "./src/views/JsonView.js";
import { OfferController } from "./src/controllers/OfferController.js";
import { ProfileController } from "./src/controllers/ProfileController.js";
import { CandidateDossierController } from "./src/controllers/CandidateDossierController.js";
import { ApplicationBriefController } from "./src/controllers/ApplicationBriefController.js";
import { FranceTravailConnector } from "./src/connectors/FranceTravailConnector.js";
import { AdzunaConnector } from "./src/connectors/AdzunaConnector.js";
import { CareerjetConnector } from "./src/connectors/CareerjetConnector.js";
import { OfferSearchService } from "./src/services/OfferSearchService.js";
import { OfferContentAcquisitionService } from "./src/services/OfferContentAcquisitionService.js";
import { OfferContentEvaluator } from "./src/services/OfferContentEvaluator.js";
import { OfferPreparationService } from "./src/services/OfferPreparationService.js";
import { OfferAnalysisInputProjector } from "./src/services/OfferAnalysisInputProjector.js";
import { OfferAnalysisNormalizer } from "./src/services/OfferAnalysisNormalizer.js";
import { OfferAnalysisValidator } from "./src/services/OfferAnalysisValidator.js";
import { OfferAnalyzerPrompt } from "./src/services/OfferAnalyzerPrompt.js";
import { GroqJsonClient } from "./src/services/GroqJsonClient.js";
import { OfferAnalyzerService } from "./src/services/OfferAnalyzerService.js";
import { OfferAnalysisCacheIdentity } from "./src/services/OfferAnalysisCacheIdentity.js";
import { OfferAnalysisService } from "./src/services/OfferAnalysisService.js";
import { HelloWorkUrlPolicy } from "./src/services/HelloWorkUrlPolicy.js";
import { SemanticRefiner, SYSTEM_PROMPT } from "./src/services/SemanticRefiner.js";
import { getEligibleRepresentatives } from "./src/services/OfferRepresentativePolicy.js";
import { OfferRepresentativeSelector } from "./src/services/OfferRepresentativeSelector.js";
import { OfferTitleNormalizer } from "./src/normalization/OfferTitleNormalizer.js";
import { StrongDescriptionContainment } from "./src/services/StrongDescriptionContainment.js";
import { DeterministicOfferDeduplicator } from "./src/services/DeterministicOfferDeduplicator.js";
import { SemanticInputProjector } from "./src/services/SemanticInputProjector.js";
import { CommuneResolver } from "./src/services/CommuneResolver.js";
import { Database } from "./src/persistence/Database.js";
import { OfferRepository } from "./src/persistence/OfferRepository.js";
import { OfferAnalysisRepository } from "./src/persistence/OfferAnalysisRepository.js";
import { SemanticDedupCacheRepository } from "./src/persistence/SemanticDedupCacheRepository.js";
import { ProfileRepository } from "./src/persistence/ProfileRepository.js";
import { CandidateDossierRepository } from "./src/persistence/CandidateDossierRepository.js";
import { CandidateDossierService } from "./src/services/CandidateDossierService.js";
import { CandidateDossierValidator } from "./src/services/CandidateDossierValidator.js";
import { CandidateDossierFingerprint } from "./src/services/CandidateDossierFingerprint.js";
import { ApplicationBriefPrompt } from "./src/services/ApplicationBriefPrompt.js";
import { ApplicationBriefInputProjector } from "./src/services/ApplicationBriefInputProjector.js";
import { ApplicationBriefSemanticOutputValidator } from "./src/services/ApplicationBriefSemanticOutputValidator.js";
import { ApplicationBriefSemanticMatcher } from "./src/services/ApplicationBriefSemanticMatcher.js";
import { ApplicationBriefEvidenceResolver } from "./src/services/ApplicationBriefEvidenceResolver.js";
import { ApplicationBriefOfferRefResolver } from "./src/services/ApplicationBriefOfferRefResolver.js";
import { ApplicationBriefAssembler } from "./src/services/ApplicationBriefAssembler.js";
import { ApplicationBriefValidator } from "./src/services/ApplicationBriefValidator.js";
import { ApplicationBriefContextValidator } from "./src/services/ApplicationBriefContextValidator.js";
import { ApplicationBriefBuilder } from "./src/services/ApplicationBriefBuilder.js";
import { ApplicationBriefIntegritySigner } from "./src/services/ApplicationBriefIntegritySigner.js";
import { ApplicationBriefService } from "./src/services/ApplicationBriefService.js";
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
const offerAnalysisRepository = new OfferAnalysisRepository(database);
const semanticDedupCacheRepository = new SemanticDedupCacheRepository(database);
const profileRepository = new ProfileRepository(database);
const candidateDossierRepository = new CandidateDossierRepository(database);

const connectors = [
  new FranceTravailConnector(config.franceTravail),
  new AdzunaConnector(config.adzuna),
  new CareerjetConnector(config.careerjet),
];
const representativeSelector = new OfferRepresentativeSelector(getEligibleRepresentatives);
const titleNormalizer = new OfferTitleNormalizer();
const descriptionContainment = new StrongDescriptionContainment();
const deterministicDeduplicator = new DeterministicOfferDeduplicator(
  titleNormalizer,
  descriptionContainment,
  representativeSelector,
);
const semanticRefiner = new SemanticRefiner(
  config.groq,
  representativeSelector,
  titleNormalizer,
  descriptionContainment,
  new SemanticInputProjector(SYSTEM_PROMPT),
  semanticDedupCacheRepository,
);
const offerSearchService = new OfferSearchService(
  connectors,
  semanticRefiner,
  offerRepository,
  deterministicDeduplicator,
  representativeSelector,
);
const communeResolver = new CommuneResolver();
const helloWorkUrlPolicy = new HelloWorkUrlPolicy();
const offerContentEvaluator = new OfferContentEvaluator();
const offerContentAcquisitionService = new OfferContentAcquisitionService(
  offerRepository,
  helloWorkUrlPolicy,
);
const offerPreparationService = new OfferPreparationService(
  offerRepository,
  offerContentEvaluator,
  helloWorkUrlPolicy,
  () => {
    return new Date().toISOString();
  },
);
const offerAnalysisInputProjector = new OfferAnalysisInputProjector();
const offerAnalysisNormalizer = new OfferAnalysisNormalizer();
const offerAnalysisValidator = new OfferAnalysisValidator(offerAnalysisNormalizer);
const offerAnalyzerPrompt = new OfferAnalyzerPrompt();
const analyzerGroqClient = new GroqJsonClient({
  apiKey: config.groq.apiKey,
  fetchImpl: globalThis.fetch,
});
const offerAnalyzerConfig = OfferAnalyzerService.buildConfig(config.groq.model);
const offerAnalyzerService = new OfferAnalyzerService({
  offerRepository,
  offerContentEvaluator,
  inputProjector: offerAnalysisInputProjector,
  promptBuilder: offerAnalyzerPrompt,
  groqClient: analyzerGroqClient,
  analysisValidator: offerAnalysisValidator,
  config: offerAnalyzerConfig,
});
const offerAnalysisService = new OfferAnalysisService({
  offerPreparationService,
  inputProjector: offerAnalysisInputProjector,
  cacheIdentityBuilder: OfferAnalysisCacheIdentity,
  offerAnalysisRepository,
  offerAnalyzerService,
  analysisValidator: offerAnalysisValidator,
  now: () => {
    return new Date().toISOString();
  },
});
const offerController = new OfferController(
  offerSearchService,
  communeResolver,
  view,
  offerContentAcquisitionService,
  offerPreparationService,
  offerAnalysisService,
);
const profileController = new ProfileController(profileRepository, view);
const candidateDossierValidator = new CandidateDossierValidator();
const candidateDossierService = new CandidateDossierService({
  candidateDossierRepository,
  candidateDossierValidator,
  now: () => {
    return new Date().toISOString();
  },
});
const candidateDossierController = new CandidateDossierController(
  candidateDossierService,
  view,
);
const applicationBriefPrompt = new ApplicationBriefPrompt();
const applicationBriefSemanticValidator = new ApplicationBriefSemanticOutputValidator();
const applicationBriefSemanticMatcher = new ApplicationBriefSemanticMatcher({
  promptBuilder: applicationBriefPrompt,
  groqClient: analyzerGroqClient,
  semanticValidator: applicationBriefSemanticValidator,
  config: ApplicationBriefSemanticMatcher.buildConfig(config.groq.model),
});
const applicationBriefEvidenceResolver = new ApplicationBriefEvidenceResolver();
const applicationBriefOfferRefResolver = new ApplicationBriefOfferRefResolver();
const applicationBriefAssembler = new ApplicationBriefAssembler({
  evidenceResolver: applicationBriefEvidenceResolver,
  candidateFingerprint: CandidateDossierFingerprint,
});
const applicationBriefValidator = new ApplicationBriefValidator();
const applicationBriefContextValidator = new ApplicationBriefContextValidator({
  applicationBriefValidator,
  offerRefResolver: applicationBriefOfferRefResolver,
  evidenceResolver: applicationBriefEvidenceResolver,
  candidateFingerprint: CandidateDossierFingerprint,
});
const applicationBriefBuilder = new ApplicationBriefBuilder({
  inputProjector: new ApplicationBriefInputProjector(),
  semanticMatcher: applicationBriefSemanticMatcher,
  assembler: applicationBriefAssembler,
  contextValidator: applicationBriefContextValidator,
});
const applicationBriefIntegritySigner = ApplicationBriefIntegritySigner.createEphemeral();
const applicationBriefService = new ApplicationBriefService({
  offerAnalysisService,
  candidateDossierService,
  applicationBriefBuilder,
  applicationBriefIntegritySigner,
});
const applicationBriefController = new ApplicationBriefController(
  applicationBriefService,
  view,
);

const apiRouter = new ApiRouter(
  offerController,
  profileController,
  candidateDossierController,
  applicationBriefController,
);
const application = new Application(config, apiRouter);

application.start();
