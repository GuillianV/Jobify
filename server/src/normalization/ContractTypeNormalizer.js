import { ContractType } from "../constants/ContractType.js";
import { TextNormalizer } from "./TextNormalizer.js";

const FRANCE_TRAVAIL_CODE_MAP = {
  cdi: ContractType.CDI,
  cdd: ContractType.CDD,
  mis: ContractType.INTERIM,
  sai: ContractType.CDD,
};

const ADZUNA_TYPE_MAP = {
  permanent: ContractType.CDI,
  contract: ContractType.CDD,
};

const KEYWORD_RULES = [
  { keywords: ["alternance", "apprentissage", "professionnalisation"], type: ContractType.ALTERNANCE },
  { keywords: ["stage", "internship", "stagiaire"], type: ContractType.STAGE },
  { keywords: ["interim", "travail temporaire"], type: ContractType.INTERIM },
  { keywords: ["freelance", "independant", "portage"], type: ContractType.FREELANCE },
  { keywords: ["cdd", "duree determinee"], type: ContractType.CDD },
  { keywords: ["cdi", "duree indeterminee"], type: ContractType.CDI },
];

/**
 * Normalizes the many contract labels used by the sources into the canonical
 * ContractType enum.
 */
class ContractTypeNormalizer {
  /**
   * Normalize a France Travail contract code, honouring the alternance flag.
   * @param {string|null|undefined} code - The raw typeContrat code.
   * @param {boolean} isAlternance - Whether the offer is flagged as alternance.
   * @returns {string} The canonical contract type.
   */
  static fromFranceTravail(code, isAlternance) {
    if (isAlternance) {
      return ContractType.ALTERNANCE;
    }
    const mapped = FRANCE_TRAVAIL_CODE_MAP[TextNormalizer.normalize(code)];
    return mapped ?? ContractType.OTHER;
  }

  /**
   * Normalize an Adzuna contract_type value.
   * @param {string|null|undefined} contractType - The Adzuna contract type.
   * @returns {string} The canonical contract type.
   */
  static fromAdzuna(contractType) {
    const mapped = ADZUNA_TYPE_MAP[TextNormalizer.normalize(contractType)];
    return mapped ?? ContractType.OTHER;
  }

  /**
   * Infer the contract type from free text (title and/or description) when the
   * source exposes no structured field.
   * @param {unknown} text - The text to inspect.
   * @returns {string} The canonical contract type, OTHER when nothing matches.
   */
  static fromLabel(text) {
    const normalized = TextNormalizer.normalize(text);
    for (const rule of KEYWORD_RULES) {
      const matches = rule.keywords.some((keyword) => {
        return normalized.includes(keyword);
      });
      if (matches) {
        return rule.type;
      }
    }
    return ContractType.OTHER;
  }
}

export { ContractTypeNormalizer };
