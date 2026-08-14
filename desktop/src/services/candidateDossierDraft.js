import { CandidateDossierConstants } from "../constants/CandidateDossierConstants.js";

/**
 * Convert one nullable domain string into an editable input value.
 * @param {string|null} value - Domain string.
 * @returns {string} Controlled input value.
 */
function toDraftText(value) {
  return value ?? "";
}

/**
 * Convert one string array into a line-oriented textarea value.
 * @param {string[]} values - Domain strings.
 * @returns {string} Editable textarea value.
 */
function toDraftLines(values) {
  return values.join("\n");
}

/**
 * Convert one editable nullable value into the exact domain representation.
 * @param {string|null} value - Draft input.
 * @returns {string|null} Domain nullable string.
 */
function toNullableText(value) {
  return value === "" ? null : value;
}

/**
 * Convert line-oriented text into factual strings without semantic normalization.
 * @param {string|string[]} value - Draft textarea or already projected values.
 * @returns {string[]} Non-empty lines.
 */
function toTextLines(value) {
  if (Array.isArray(value)) {
    return structuredClone(value);
  }
  return value.split(/\r?\n/u).filter((line) => {
    return Boolean(line.trim());
  });
}

/**
 * Tell whether an optional editor string is empty or valid bounded factual text.
 * @param {string} value - Editor value.
 * @param {number} maximum - Maximum accepted length.
 * @returns {boolean} True when the value is empty or valid text.
 */
function isOptionalEditorTextValid(value, maximum) {
  return value === "" || Boolean(value.trim()) && value.length <= maximum;
}

/**
 * Tell whether unloading would discard or interrupt CandidateDossier work.
 * @param {object} state - CandidateDossier persistence state.
 * @param {boolean} state.dirty - Whether the global draft differs from saved state.
 * @param {boolean} state.editorDirty - Whether the local editor buffer changed.
 * @param {boolean} state.isSaving - Whether a complete save is in progress.
 * @returns {boolean} True when unloading must request confirmation.
 */
function hasUnsavedCandidateChanges({ dirty, editorDirty, isSaving }) {
  return Boolean(dirty || editorDirty || isSaving);
}

/**
 * Tell whether a nullable month range is chronological without timezone conversion.
 * @param {string} startDate - Nullable YYYY-MM editor value.
 * @param {string} endDate - Nullable YYYY-MM editor value.
 * @returns {boolean} True when either side is absent or the range is chronological.
 */
function isCandidateDateRangeValid(startDate, endDate) {
  return !startDate || !endDate || endDate >= startDate;
}

/**
 * Validate one multiline editor value against count and individual text limits.
 * @param {string} value - Line-oriented editor value.
 * @param {number} maximumItems - Maximum non-empty lines.
 * @returns {boolean} True when the collection respects the lightweight contract.
 */
function isCandidateLineCollectionValid(value, maximumItems) {
  const lines = toTextLines(value);
  return lines.length <= maximumItems && lines.every((line) => {
    return line.length <= CandidateDossierConstants.LIMIT.TEXT_LENGTH;
  });
}

/**
 * Return one conventional inline error for required bounded text.
 * @param {string} value - Required editor text.
 * @param {number} [maximum] - Maximum accepted length.
 * @returns {string|null} Inline error or null.
 */
function getRequiredTextError(
  value,
  maximum = CandidateDossierConstants.LIMIT.TEXT_LENGTH,
) {
  if (!value.trim()) {
    return "Ce champ est requis.";
  }
  if (value.length > maximum) {
    return "Ce texte est trop long.";
  }
  return null;
}

/**
 * Return one conventional inline error for optional bounded text.
 * @param {string} value - Optional editor text.
 * @param {number} [maximum] - Maximum accepted length.
 * @returns {string|null} Inline error or null.
 */
function getOptionalTextError(
  value,
  maximum = CandidateDossierConstants.LIMIT.TEXT_LENGTH,
) {
  if (isOptionalEditorTextValid(value, maximum)) {
    return null;
  }
  return value.length > maximum
    ? "Ce texte est trop long."
    : "Saisissez un texte ou laissez ce champ vide.";
}

/**
 * Materialize a validation result from field-addressable errors.
 * @param {Record<string, string|null>} candidates - Candidate field errors.
 * @returns {{valid: boolean, messages: string[], fieldErrors: Record<string, string>}} Result.
 */
function createEditorValidation(candidates) {
  const fieldErrors = Object.fromEntries(Object.entries(candidates).filter((entry) => {
    return Boolean(entry[1]);
  }));
  const messages = Object.values(fieldErrors);
  return { valid: messages.length === 0, messages, fieldErrors };
}

/**
 * Return one existing collection-limit error for a line-oriented field.
 * @param {string} value - Line-oriented editor value.
 * @param {number} maximum - Maximum facts.
 * @returns {string|null} Inline error or null.
 */
function getLineCollectionError(value, maximum) {
  return isCandidateLineCollectionValid(value, maximum)
    ? null
    : "Cette liste dépasse le nombre ou la longueur autorisée.";
}

/**
 * Validate the lightweight Experience editor contract without duplicating the server validator.
 * @param {object} draft - Local Experience editor draft.
 * @returns {{valid: boolean, messages: string[], fieldErrors: object}} Validation result.
 */
function validateExperienceEditorDraft(draft) {
  return createEditorValidation({
    role: getRequiredTextError(draft.role),
    organization: getRequiredTextError(draft.organization),
    client: getOptionalTextError(draft.client),
    domain: getOptionalTextError(draft.domain),
    endDate: isCandidateDateRangeValid(draft.startDate, draft.current ? "" : draft.endDate)
      ? null
      : "La date de fin doit être postérieure ou égale à la date de début.",
    activities: getLineCollectionError(
      draft.activities,
      CandidateDossierConstants.LIMIT.ACTIVITIES,
    ),
    achievements: getLineCollectionError(
      draft.achievements,
      CandidateDossierConstants.LIMIT.ACHIEVEMENTS,
    ),
    technologies: getLineCollectionError(
      draft.technologies,
      CandidateDossierConstants.LIMIT.TECHNOLOGIES,
    ),
  });
}

/**
 * Validate the lightweight Project editor contract without inventing domain rules.
 * @param {object} draft - Local Project editor draft.
 * @returns {{valid: boolean, messages: string[], fieldErrors: object}} Validation result.
 */
function validateProjectEditorDraft(draft) {
  return createEditorValidation({
    name: getRequiredTextError(draft.name),
    role: getOptionalTextError(draft.role),
    domain: getOptionalTextError(draft.domain),
    summary: getOptionalTextError(
      draft.summary,
      CandidateDossierConstants.LIMIT.SUMMARY_LENGTH,
    ),
    endDate: isCandidateDateRangeValid(draft.startDate, draft.endDate)
      ? null
      : "La date de fin doit être postérieure ou égale à la date de début.",
    activities: getLineCollectionError(
      draft.activities,
      CandidateDossierConstants.LIMIT.ACTIVITIES,
    ),
    achievements: getLineCollectionError(
      draft.achievements,
      CandidateDossierConstants.LIMIT.ACHIEVEMENTS,
    ),
    technologies: getLineCollectionError(
      draft.technologies,
      CandidateDossierConstants.LIMIT.TECHNOLOGIES,
    ),
  });
}

/**
 * Clone one existing Experience into a local editor buffer.
 * @param {object} experience - Draft-global Experience.
 * @returns {object} Detached local editor draft.
 */
function experienceToEditorDraft(experience) {
  return structuredClone(experience);
}

/**
 * Whitelist one local Experience buffer for insertion into the global draft.
 * @param {object} editorDraft - Validated local editor state.
 * @returns {object} Draft-global Experience with its stable ID.
 */
function editorDraftToExperience(editorDraft) {
  return {
    id: editorDraft.id,
    role: editorDraft.role,
    organization: editorDraft.organization,
    client: editorDraft.client,
    startDate: editorDraft.startDate,
    endDate: editorDraft.current ? "" : editorDraft.endDate,
    current: editorDraft.current,
    domain: editorDraft.domain,
    activities: editorDraft.activities,
    achievements: editorDraft.achievements,
    technologies: editorDraft.technologies,
  };
}

/**
 * Clone one existing Project into a local editor buffer.
 * @param {object} project - Draft-global Project.
 * @returns {object} Detached local editor draft.
 */
function projectToEditorDraft(project) {
  return structuredClone(project);
}

/**
 * Whitelist one local Project buffer for insertion into the global draft.
 * @param {object} editorDraft - Validated local editor state.
 * @returns {object} Draft-global Project with its stable ID.
 */
function editorDraftToProject(editorDraft) {
  return {
    id: editorDraft.id,
    name: editorDraft.name,
    role: editorDraft.role,
    startDate: editorDraft.startDate,
    endDate: editorDraft.endDate,
    domain: editorDraft.domain,
    summary: editorDraft.summary,
    activities: editorDraft.activities,
    achievements: editorDraft.achievements,
    technologies: editorDraft.technologies,
  };
}

/**
 * Clone one Skill into a local editor buffer.
 * @param {object} skill - Draft-global Skill.
 * @returns {object} Detached local editor draft.
 */
function skillToEditorDraft(skill) {
  return { ...structuredClone(skill), detail: toDraftText(skill.detail) };
}

/**
 * Whitelist one local Skill buffer for the global draft.
 * @param {object} editorDraft - Validated local editor state.
 * @returns {object} Draft-global Skill with its stable ID.
 */
function editorDraftToSkill(editorDraft) {
  return {
    id: editorDraft.id,
    category: editorDraft.category,
    value: editorDraft.value,
    detail: editorDraft.detail,
  };
}

/**
 * Validate one lightweight Skill editor buffer.
 * @param {object} draft - Local Skill draft.
 * @returns {{valid: boolean, messages: string[], fieldErrors: object}} Validation result.
 */
function validateSkillEditorDraft(draft) {
  return createEditorValidation({
    category: Object.values(CandidateDossierConstants.SKILL_CATEGORY).includes(draft.category)
      ? null
      : "Choisissez une catégorie valide.",
    value: getRequiredTextError(draft.value),
    detail: getOptionalTextError(draft.detail),
  });
}

/**
 * Clone one Education item into a local editor buffer.
 * @param {object} education - Draft-global Education item.
 * @returns {object} Detached local editor draft.
 */
function educationToEditorDraft(education) {
  return structuredClone(education);
}

/**
 * Whitelist one local Education buffer for the global draft.
 * @param {object} editorDraft - Validated local editor state.
 * @returns {object} Draft-global Education item with its stable ID.
 */
function editorDraftToEducation(editorDraft) {
  return {
    id: editorDraft.id,
    diploma: editorDraft.diploma,
    level: editorDraft.level,
    field: editorDraft.field,
    institution: editorDraft.institution,
    startDate: editorDraft.startDate,
    endDate: editorDraft.endDate,
  };
}

/**
 * Validate one lightweight Education editor buffer.
 * @param {object} draft - Local Education draft.
 * @returns {{valid: boolean, messages: string[], fieldErrors: object}} Validation result.
 */
function validateEducationEditorDraft(draft) {
  return createEditorValidation({
    diploma: getRequiredTextError(draft.diploma),
    level: getOptionalTextError(draft.level),
    field: getOptionalTextError(draft.field),
    institution: getOptionalTextError(draft.institution),
    endDate: isCandidateDateRangeValid(draft.startDate, draft.endDate)
      ? null
      : "La date de fin doit être postérieure ou égale à la date de début.",
  });
}

/**
 * Clone one Language into a local editor buffer.
 * @param {object} language - Draft-global Language.
 * @returns {object} Detached local editor draft.
 */
function languageToEditorDraft(language) {
  return structuredClone(language);
}

/**
 * Whitelist one local Language buffer for the global draft.
 * @param {object} editorDraft - Validated local editor state.
 * @returns {object} Draft-global Language with its stable ID.
 */
function editorDraftToLanguage(editorDraft) {
  return {
    id: editorDraft.id,
    language: editorDraft.language,
    overall: editorDraft.overall,
    reading: editorDraft.reading,
    writing: editorDraft.writing,
    speaking: editorDraft.speaking,
    listening: editorDraft.listening,
  };
}

/**
 * Validate one lightweight Language editor buffer without imposing level values.
 * @param {object} draft - Local Language draft.
 * @returns {{valid: boolean, messages: string[], fieldErrors: object}} Validation result.
 */
function validateLanguageEditorDraft(draft) {
  return createEditorValidation({
    language: getRequiredTextError(draft.language),
    overall: getOptionalTextError(draft.overall),
    reading: getOptionalTextError(draft.reading),
    writing: getOptionalTextError(draft.writing),
    speaking: getOptionalTextError(draft.speaking),
    listening: getOptionalTextError(draft.listening),
  });
}

/**
 * Clone one SoftSkill into a local editor buffer.
 * @param {object} softSkill - Draft-global SoftSkill.
 * @returns {object} Detached local editor draft.
 */
function softSkillToEditorDraft(softSkill) {
  return { ...structuredClone(softSkill), detail: toDraftText(softSkill.detail) };
}

/**
 * Whitelist one local SoftSkill buffer for the global draft.
 * @param {object} editorDraft - Validated local editor state.
 * @returns {object} Draft-global SoftSkill with its stable ID.
 */
function editorDraftToSoftSkill(editorDraft) {
  return {
    id: editorDraft.id,
    value: editorDraft.value,
    detail: editorDraft.detail,
  };
}

/**
 * Validate one lightweight SoftSkill editor buffer.
 * @param {object} draft - Local SoftSkill draft.
 * @returns {{valid: boolean, messages: string[], fieldErrors: object}} Validation result.
 */
function validateSoftSkillEditorDraft(draft) {
  return createEditorValidation({
    value: getRequiredTextError(draft.value),
    detail: getOptionalTextError(draft.detail),
  });
}

/**
 * Tell whether one collection may receive another item.
 * @param {unknown[]} items - Current collection.
 * @param {number} maximum - Renderer UX maximum.
 * @returns {boolean} True when adding remains allowed.
 */
function canAddCandidateItem(items, maximum) {
  return items.length < maximum;
}

/**
 * Create an editable CandidateDossier clone detached from the canonical value.
 * @param {object} dossier - Canonical server dossier.
 * @returns {object} Editable complete draft.
 */
function createCandidateDossierDraft(dossier) {
  return {
    schemaVersion: dossier.schemaVersion,
    experiences: dossier.experiences.map((item) => {
      return {
        ...structuredClone(item),
        client: toDraftText(item.client),
        startDate: toDraftText(item.startDate),
        endDate: toDraftText(item.endDate),
        domain: toDraftText(item.domain),
        activities: toDraftLines(item.activities),
        achievements: toDraftLines(item.achievements),
        technologies: toDraftLines(item.technologies),
      };
    }),
    projects: dossier.projects.map((item) => {
      return {
        ...structuredClone(item),
        role: toDraftText(item.role),
        startDate: toDraftText(item.startDate),
        endDate: toDraftText(item.endDate),
        domain: toDraftText(item.domain),
        summary: toDraftText(item.summary),
        activities: toDraftLines(item.activities),
        achievements: toDraftLines(item.achievements),
        technologies: toDraftLines(item.technologies),
      };
    }),
    skills: dossier.skills.map((item) => {
      return { ...structuredClone(item), detail: toDraftText(item.detail) };
    }),
    education: dossier.education.map((item) => {
      return {
        ...structuredClone(item),
        level: toDraftText(item.level),
        field: toDraftText(item.field),
        institution: toDraftText(item.institution),
        startDate: toDraftText(item.startDate),
        endDate: toDraftText(item.endDate),
      };
    }),
    languages: dossier.languages.map((item) => {
      return {
        ...structuredClone(item),
        overall: toDraftText(item.overall),
        reading: toDraftText(item.reading),
        writing: toDraftText(item.writing),
        speaking: toDraftText(item.speaking),
        listening: toDraftText(item.listening),
      };
    }),
    softSkills: dossier.softSkills.map((item) => {
      return { ...structuredClone(item), detail: toDraftText(item.detail) };
    }),
  };
}

/**
 * Project one experience draft into the exact domain contract.
 * @param {object} item - Experience draft.
 * @returns {object} CandidateDossier experience payload.
 */
function toExperiencePayload(item) {
  return {
    id: item.id,
    role: item.role,
    organization: item.organization,
    client: toNullableText(item.client),
    startDate: toNullableText(item.startDate),
    endDate: item.current ? null : toNullableText(item.endDate),
    current: item.current,
    domain: toNullableText(item.domain),
    activities: toTextLines(item.activities),
    achievements: toTextLines(item.achievements),
    technologies: toTextLines(item.technologies),
  };
}

/**
 * Project one project draft into the exact domain contract.
 * @param {object} item - Project draft.
 * @returns {object} CandidateDossier project payload.
 */
function toProjectPayload(item) {
  return {
    id: item.id,
    name: item.name,
    role: toNullableText(item.role),
    startDate: toNullableText(item.startDate),
    endDate: toNullableText(item.endDate),
    domain: toNullableText(item.domain),
    summary: toNullableText(item.summary),
    activities: toTextLines(item.activities),
    achievements: toTextLines(item.achievements),
    technologies: toTextLines(item.technologies),
  };
}

/**
 * Project one complete draft into the strict CandidateDossier payload whitelist.
 * @param {object} draft - Editable complete dossier.
 * @returns {object} Complete domain payload.
 */
function toCandidateDossierPayload(draft) {
  return {
    schemaVersion: draft.schemaVersion,
    experiences: draft.experiences.map(toExperiencePayload),
    projects: draft.projects.map(toProjectPayload),
    skills: draft.skills.map((item) => {
      return {
        id: item.id,
        category: item.category,
        value: item.value,
        detail: toNullableText(item.detail),
      };
    }),
    education: draft.education.map((item) => {
      return {
        id: item.id,
        diploma: item.diploma,
        level: toNullableText(item.level),
        field: toNullableText(item.field),
        institution: toNullableText(item.institution),
        startDate: toNullableText(item.startDate),
        endDate: toNullableText(item.endDate),
      };
    }),
    languages: draft.languages.map((item) => {
      return {
        id: item.id,
        language: item.language,
        overall: toNullableText(item.overall),
        reading: toNullableText(item.reading),
        writing: toNullableText(item.writing),
        speaking: toNullableText(item.speaking),
        listening: toNullableText(item.listening),
      };
    }),
    softSkills: draft.softSkills.map((item) => {
      return {
        id: item.id,
        value: item.value,
        detail: toNullableText(item.detail),
      };
    }),
  };
}

/**
 * Compare a draft to its canonical saved payload deterministically.
 * @param {object} savedDossier - Last server-authoritative dossier.
 * @param {object} draftDossier - Current editable draft.
 * @returns {boolean} True when the projected payload differs.
 */
function isCandidateDossierDirty(savedDossier, draftDossier) {
  return JSON.stringify(savedDossier) !== JSON.stringify(
    toCandidateDossierPayload(draftDossier),
  );
}

/**
 * Create one structurally complete new experience draft with a stable ID.
 * @param {Function} idFactory - Injected stable ID generator.
 * @returns {object} Empty experience draft.
 */
function createEmptyExperience(idFactory) {
  return {
    id: idFactory(), role: "", organization: "", client: "", startDate: "",
    endDate: "", current: false, domain: "", activities: "", achievements: "",
    technologies: "",
  };
}

/**
 * Create one structurally complete new project draft with a stable ID.
 * @param {Function} idFactory - Injected stable ID generator.
 * @returns {object} Empty project draft.
 */
function createEmptyProject(idFactory) {
  return {
    id: idFactory(), name: "", role: "", startDate: "", endDate: "", domain: "",
    summary: "", activities: "", achievements: "", technologies: "",
  };
}

/**
 * Create one structurally complete new education draft with a stable ID.
 * @param {Function} idFactory - Injected stable ID generator.
 * @returns {object} Empty education draft.
 */
function createEmptyEducation(idFactory) {
  return {
    id: idFactory(), diploma: "", level: "", field: "", institution: "",
    startDate: "", endDate: "",
  };
}

/**
 * Create one structurally complete new language draft with a stable ID.
 * @param {Function} idFactory - Injected stable ID generator.
 * @returns {object} Empty language draft.
 */
function createEmptyLanguage(idFactory) {
  return {
    id: idFactory(), language: "", overall: "", reading: "", writing: "",
    speaking: "", listening: "",
  };
}

/**
 * Create one structurally complete new soft-skill draft with a stable ID.
 * @param {Function} idFactory - Injected stable ID generator.
 * @returns {object} Empty soft-skill draft.
 */
function createEmptySoftSkill(idFactory) {
  return { id: idFactory(), value: "", detail: "" };
}

/**
 * Parse explicit line-oriented bulk skill input without semantic normalization.
 * @param {string} text - User-entered bulk skill text.
 * @returns {string[]} Non-empty skill values in input order.
 */
function parseBulkSkillLines(text) {
  return toTextLines(text);
}

/**
 * Validate one bulk skill buffer against value and total-capacity constraints.
 * @param {string} text - User-entered bulk skill text.
 * @param {number} remainingCapacity - Remaining slots in the global skills collection.
 * @returns {{valid: boolean, values: string[], error: string|null}} Validation result.
 */
function validateBulkSkillInput(text, remainingCapacity) {
  const values = parseBulkSkillLines(text);
  if (values.length === 0) {
    return { valid: false, values, error: "Ajoutez au moins une compétence." };
  }
  if (values.some((value) => {
    return value.length > CandidateDossierConstants.LIMIT.TEXT_LENGTH;
  })) {
    return {
      valid: false,
      values,
      error: `Chaque compétence doit contenir au maximum ${CandidateDossierConstants.LIMIT.TEXT_LENGTH} caractères.`,
    };
  }
  if (values.length > remainingCapacity) {
    return {
      valid: false,
      values,
      error: `Vous pouvez encore ajouter ${remainingCapacity} compétence(s).`,
    };
  }
  return { valid: true, values, error: null };
}

/**
 * Create exact domain-shaped Skill items only after a valid bulk confirmation.
 * @param {object} options - Bulk creation options.
 * @param {string} options.category - Fixed group category.
 * @param {string} options.text - Valid line-oriented input.
 * @param {Function} options.idFactory - Stable ID factory called once per item.
 * @returns {object[]} Created Skill items in input order.
 */
function createSkillsFromBulkInput({ category, text, idFactory }) {
  return parseBulkSkillLines(text).map((value) => {
    return { id: idFactory(), category, value, detail: null };
  });
}

export {
  canAddCandidateItem,
  createCandidateDossierDraft,
  createEmptyEducation,
  createEmptyExperience,
  createEmptyLanguage,
  createEmptyProject,
  createEmptySoftSkill,
  createSkillsFromBulkInput,
  educationToEditorDraft,
  editorDraftToEducation,
  editorDraftToExperience,
  editorDraftToLanguage,
  editorDraftToProject,
  editorDraftToSkill,
  editorDraftToSoftSkill,
  experienceToEditorDraft,
  hasUnsavedCandidateChanges,
  isCandidateDateRangeValid,
  isCandidateLineCollectionValid,
  isCandidateDossierDirty,
  languageToEditorDraft,
  projectToEditorDraft,
  parseBulkSkillLines,
  skillToEditorDraft,
  softSkillToEditorDraft,
  toCandidateDossierPayload,
  toTextLines,
  validateExperienceEditorDraft,
  validateEducationEditorDraft,
  validateLanguageEditorDraft,
  validateProjectEditorDraft,
  validateSkillEditorDraft,
  validateSoftSkillEditorDraft,
  validateBulkSkillInput,
};
