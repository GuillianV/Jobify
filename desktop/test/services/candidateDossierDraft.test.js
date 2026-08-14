import test from "node:test";
import assert from "node:assert/strict";
import { CandidateDossierConstants } from "../../src/constants/CandidateDossierConstants.js";
import {
  monthYearValueToPickerDate,
  pickerDateToMonthYearValue,
} from "../../src/services/monthYearPicker.js";
import {
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
} from "../../src/services/candidateDossierDraft.js";

/**
 * Build one complete generic CandidateDossier payload covering every collection.
 * @returns {object} Canonical dossier fixture.
 */
function createDossier() {
  return {
    schemaVersion: CandidateDossierConstants.SCHEMA_VERSION,
    experiences: [{
      id: "exp-1", role: "Generic role", organization: "Generic organization",
      client: null, startDate: "2024-01", endDate: "2025-01", current: false,
      domain: null, activities: ["Activity A"], achievements: ["Achievement A"],
      technologies: ["Technology A"],
    }],
    projects: [{
      id: "project-1", name: "Generic project", role: null, startDate: null,
      endDate: null, domain: null, summary: null, activities: [], achievements: [],
      technologies: [],
    }],
    skills: [{
      id: "skill-1",
      category: CandidateDossierConstants.SKILL_CATEGORY.TECHNICAL_SKILL,
      value: "Generic skill",
      detail: null,
    }],
    education: [{
      id: "education-1", diploma: "Generic diploma", level: null, field: null,
      institution: null, startDate: null, endDate: null,
    }],
    languages: [{
      id: "language-1", language: "Generic language", overall: null, reading: null,
      writing: null, speaking: null, listening: null,
    }],
    softSkills: [{ id: "soft-1", value: "Generic soft skill", detail: null }],
  };
}

test("draft is editable and deeply detached while preserving every existing ID", () => {
  const saved = createDossier();
  const snapshot = globalThis.structuredClone(saved);
  const draft = createCandidateDossierDraft(saved);

  draft.experiences[0].role = "Changed role";
  draft.skills[0].detail = "Changed detail";

  assert.deepEqual(saved, snapshot);
  for (const key of [
    "experiences", "projects", "skills", "education", "languages", "softSkills",
  ]) {
    assert.equal(draft[key][0].id, saved[key][0].id);
  }
});

test("complete payload maps nullable inputs and line text without semantic rewriting", () => {
  const saved = createDossier();
  const draft = createCandidateDossierDraft(saved);
  draft.experiences[0].client = "";
  draft.experiences[0].domain = "";
  draft.experiences[0].activities = "First activity\n\n Second activity ";
  draft.experiences[0].achievements = "\nAchievement";
  draft.experiences[0].technologies = "Tool A\r\nTool B";
  draft.projects[0].summary = "";

  const payload = toCandidateDossierPayload(draft);

  assert.equal(payload.schemaVersion, CandidateDossierConstants.SCHEMA_VERSION);
  assert.equal(payload.experiences[0].client, null);
  assert.equal(payload.experiences[0].domain, null);
  assert.deepEqual(payload.experiences[0].activities, ["First activity", " Second activity "]);
  assert.deepEqual(payload.experiences[0].achievements, ["Achievement"]);
  assert.deepEqual(payload.experiences[0].technologies, ["Tool A", "Tool B"]);
  assert.equal(payload.projects[0].summary, null);
  assert.deepEqual(Object.keys(payload), [
    "schemaVersion", "experiences", "projects", "skills", "education", "languages",
    "softSkills",
  ]);
});

test("current experience always projects a null end date", () => {
  const draft = createCandidateDossierDraft(createDossier());
  draft.experiences[0].current = true;
  draft.experiences[0].endDate = "2029-12";

  assert.equal(toCandidateDossierPayload(draft).experiences[0].endDate, null);
});

test("line conversion removes empty lines and accepts already projected arrays", () => {
  assert.deepEqual(toTextLines("alpha\n   \nbeta"), ["alpha", "beta"]);
  const values = ["alpha", "beta"];
  const result = toTextLines(values);
  result.push("external");
  assert.deepEqual(values, ["alpha", "beta"]);
});

test("dirty comparison is deterministic across equivalent draft representations", () => {
  const saved = createDossier();
  const draft = createCandidateDossierDraft(saved);

  assert.equal(isCandidateDossierDirty(saved, draft), false);
  draft.experiences[0].role = "Changed role";
  assert.equal(isCandidateDossierDirty(saved, draft), true);
  draft.experiences[0].role = saved.experiences[0].role;
  draft.experiences[0].client = "";
  assert.equal(isCandidateDossierDirty(saved, draft), false);
});

test("unsaved Candidate changes cover global local and in-flight work only", () => {
  assert.equal(hasUnsavedCandidateChanges({
    dirty: false, editorDirty: false, isSaving: false,
  }), false);
  assert.equal(hasUnsavedCandidateChanges({
    dirty: true, editorDirty: false, isSaving: false,
  }), true);
  assert.equal(hasUnsavedCandidateChanges({
    dirty: false, editorDirty: true, isSaving: false,
  }), true);
  assert.equal(hasUnsavedCandidateChanges({
    dirty: false, editorDirty: false, isSaving: true,
  }), true);
  assert.equal(hasUnsavedCandidateChanges({
    dirty: true, editorDirty: true, isSaving: true,
  }), true);
});

test("item factories call the injected ID factory once and create complete drafts", () => {
  let calls = 0;
  function idFactory() {
    calls += 1;
    return `generated-${calls}`;
  }
  const items = [
    createEmptyExperience(idFactory),
    createEmptyProject(idFactory),
    createEmptyEducation(idFactory),
    createEmptyLanguage(idFactory),
    createEmptySoftSkill(idFactory),
  ];

  assert.equal(calls, items.length);
  assert.deepEqual(items.map((item) => {
    return item.id;
  }), [
    "generated-1", "generated-2", "generated-3", "generated-4", "generated-5",
  ]);
  assert.equal(items[0].activities, "");
  assert.equal(items[1].summary, "");
  assert.equal(items[2].diploma, "");
  assert.equal(items[3].overall, "");
  assert.equal(items[4].detail, "");
});

test("Experience editor mapping preserves its ID fields and isolated local buffer", () => {
  const dossier = createDossier();
  const globalDraft = createCandidateDossierDraft(dossier);
  const editor = experienceToEditorDraft(globalDraft.experiences[0]);
  editor.role = "Changed locally";
  editor.client = "";
  editor.current = true;
  editor.endDate = "2029-12";
  editor.activities = "Activity A\n\nActivity B";
  const confirmed = editorDraftToExperience(editor);

  assert.equal(globalDraft.experiences[0].role, dossier.experiences[0].role);
  assert.equal(confirmed.id, dossier.experiences[0].id);
  assert.equal(confirmed.endDate, "");
  assert.deepEqual(Object.keys(confirmed), [
    "id", "role", "organization", "client", "startDate", "endDate", "current",
    "domain", "activities", "achievements", "technologies",
  ]);
  globalDraft.experiences[0] = confirmed;
  const payload = toCandidateDossierPayload(globalDraft).experiences[0];
  assert.equal(payload.client, null);
  assert.equal(payload.endDate, null);
  assert.deepEqual(payload.activities, ["Activity A", "Activity B"]);
});

test("Project editor mapping preserves its ID nullable fields arrays and exact contract", () => {
  const dossier = createDossier();
  const globalDraft = createCandidateDossierDraft(dossier);
  const editor = projectToEditorDraft(globalDraft.projects[0]);
  editor.name = "Changed project";
  editor.role = "";
  editor.summary = "";
  editor.technologies = "Tool A\n\nTool B";
  const confirmed = editorDraftToProject(editor);

  assert.equal(globalDraft.projects[0].name, dossier.projects[0].name);
  assert.equal(confirmed.id, dossier.projects[0].id);
  assert.equal(Object.hasOwn(confirmed, "type"), false);
  assert.equal(Object.hasOwn(confirmed, "current"), false);
  assert.deepEqual(Object.keys(confirmed), [
    "id", "name", "role", "startDate", "endDate", "domain", "summary",
    "activities", "achievements", "technologies",
  ]);
  globalDraft.projects[0] = confirmed;
  const payload = toCandidateDossierPayload(globalDraft).projects[0];
  assert.equal(payload.role, null);
  assert.equal(payload.summary, null);
  assert.deepEqual(payload.technologies, ["Tool A", "Tool B"]);
});

test("month range validation is chronological and accepts nullable boundaries", () => {
  assert.equal(isCandidateDateRangeValid("2024-01", "2024-12"), true);
  assert.equal(isCandidateDateRangeValid("2024-01", "2024-01"), true);
  assert.equal(isCandidateDateRangeValid("2024-12", "2024-01"), false);
  assert.equal(isCandidateDateRangeValid("", "2024-01"), true);
  assert.equal(isCandidateDateRangeValid("2024-01", ""), true);
});

test("month-year picker conversions isolate local Date and preserve canonical months", () => {
  const march = monthYearValueToPickerDate("2020-03");
  assert.equal(march.getFullYear(), 2020);
  assert.equal(march.getMonth(), 2);
  assert.equal(march.getDate(), 1);
  assert.equal(pickerDateToMonthYearValue(march), "2020-03");
  assert.equal(pickerDateToMonthYearValue(new Date(2023, 10, 1)), "2023-11");
  assert.equal(pickerDateToMonthYearValue(new Date(2021, 0, 1)), "2021-01");
  assert.equal(monthYearValueToPickerDate(null), null);
  assert.equal(monthYearValueToPickerDate(""), null);
  assert.equal(monthYearValueToPickerDate("2020-13"), null);
  assert.equal(pickerDateToMonthYearValue(null), null);
});

test("Experience validation covers required dates text and collection limits", () => {
  const draft = createCandidateDossierDraft(createDossier()).experiences[0];
  assert.equal(validateExperienceEditorDraft(draft).valid, true);

  draft.role = "   ";
  draft.endDate = "2023-12";
  draft.activities = Array.from(
    { length: CandidateDossierConstants.LIMIT.ACTIVITIES + 1 },
    () => {
      return "Activity";
    },
  ).join("\n");
  const invalid = validateExperienceEditorDraft(draft);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.messages.length > 1, true);
});

test("all editor validators expose conventional field-addressable required errors", () => {
  const idFactory = () => {
    return "validation-id";
  };
  const experience = validateExperienceEditorDraft(createEmptyExperience(idFactory));
  const project = validateProjectEditorDraft(createEmptyProject(idFactory));
  const skillDraft = {
    id: idFactory(),
    category: CandidateDossierConstants.SKILL_CATEGORY.TECHNICAL_SKILL,
    value: "",
    detail: "",
  };
  const skill = validateSkillEditorDraft(skillDraft);
  const education = validateEducationEditorDraft(createEmptyEducation(idFactory));
  const language = validateLanguageEditorDraft(createEmptyLanguage(idFactory));
  const softSkill = validateSoftSkillEditorDraft(createEmptySoftSkill(idFactory));

  assert.deepEqual(experience.fieldErrors, {
    role: "Ce champ est requis.",
    organization: "Ce champ est requis.",
  });
  assert.deepEqual(project.fieldErrors, { name: "Ce champ est requis." });
  assert.deepEqual(skill.fieldErrors, { value: "Ce champ est requis." });
  assert.deepEqual(education.fieldErrors, { diploma: "Ce champ est requis." });
  assert.deepEqual(language.fieldErrors, { language: "Ce champ est requis." });
  assert.deepEqual(softSkill.fieldErrors, { value: "Ce champ est requis." });
});

test("editor field errors separate invalid enum length and date rules", () => {
  const skill = { id: "skill-id", category: "INVALID", value: "", detail: "" };
  skill.value = "Valid value";
  const skillValidation = validateSkillEditorDraft(skill);
  assert.equal(skillValidation.fieldErrors.category, "Choisissez une catégorie valide.");

  const project = createEmptyProject(() => {
    return "project-id";
  });
  project.name = "Valid project";
  project.summary = "x".repeat(CandidateDossierConstants.LIMIT.SUMMARY_LENGTH + 1);
  project.startDate = "2025-01";
  project.endDate = "2024-12";
  const projectValidation = validateProjectEditorDraft(project);
  assert.equal(projectValidation.fieldErrors.summary, "Ce texte est trop long.");
  assert.equal(
    projectValidation.fieldErrors.endDate,
    "La date de fin doit être postérieure ou égale à la date de début.",
  );
});

test("Project validation covers required summary date text and collection limits", () => {
  const draft = createCandidateDossierDraft(createDossier()).projects[0];
  assert.equal(validateProjectEditorDraft(draft).valid, true);

  draft.name = "";
  draft.startDate = "2025-01";
  draft.endDate = "2024-12";
  draft.summary = "x".repeat(CandidateDossierConstants.LIMIT.SUMMARY_LENGTH + 1);
  draft.technologies = Array.from(
    { length: CandidateDossierConstants.LIMIT.TECHNOLOGIES + 1 },
    () => {
      return "Technology";
    },
  ).join("\n");
  const invalid = validateProjectEditorDraft(draft);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.messages.length > 1, true);
});

test("line collection validation rejects too many or individually oversized facts", () => {
  assert.equal(isCandidateLineCollectionValid(
    "Fact A\nFact B",
    CandidateDossierConstants.LIMIT.ACTIVITIES,
  ), true);
  assert.equal(isCandidateLineCollectionValid(
    Array.from(
      { length: CandidateDossierConstants.LIMIT.ACTIVITIES + 1 },
      () => {
        return "Fact";
      },
    ).join("\n"),
    CandidateDossierConstants.LIMIT.ACTIVITIES,
  ), false);
  assert.equal(isCandidateLineCollectionValid(
    "x".repeat(CandidateDossierConstants.LIMIT.TEXT_LENGTH + 1),
    CandidateDossierConstants.LIMIT.ACTIVITIES,
  ), false);
});

test("Skill editor preserves stable ID exact category whitelist and nullable detail", () => {
  const globalDraft = createCandidateDossierDraft(createDossier());
  const editor = skillToEditorDraft(globalDraft.skills[0]);
  editor.value = "Changed skill";
  editor.detail = "";
  const confirmed = editorDraftToSkill(editor);

  assert.equal(confirmed.id, "skill-1");
  assert.equal(confirmed.category,
    CandidateDossierConstants.SKILL_CATEGORY.TECHNICAL_SKILL);
  assert.deepEqual(Object.keys(confirmed), ["id", "category", "value", "detail"]);
  globalDraft.skills[0] = confirmed;
  assert.equal(toCandidateDossierPayload(globalDraft).skills[0].detail, null);
  editor.category = "OTHER";
  assert.equal(validateSkillEditorDraft(editor).valid, false);
  editor.category = "SOFT_SKILL";
  assert.equal(validateSkillEditorDraft(editor).valid, false);
});

test("Education editor preserves ID exact fields nullables and chronological dates", () => {
  const globalDraft = createCandidateDossierDraft(createDossier());
  const editor = educationToEditorDraft(globalDraft.education[0]);
  editor.diploma = "Changed diploma";
  editor.level = "";
  editor.field = "";
  editor.institution = "";
  editor.startDate = "2025-01";
  editor.endDate = "2024-12";
  const confirmed = editorDraftToEducation(editor);

  assert.equal(confirmed.id, "education-1");
  assert.deepEqual(Object.keys(confirmed), [
    "id", "diploma", "level", "field", "institution", "startDate", "endDate",
  ]);
  assert.equal(validateEducationEditorDraft(editor).valid, false);
  editor.endDate = "2025-01";
  assert.equal(validateEducationEditorDraft(editor).valid, true);
  globalDraft.education[0] = editorDraftToEducation(editor);
  const payload = toCandidateDossierPayload(globalDraft).education[0];
  assert.equal(payload.level, null);
  assert.equal(payload.field, null);
  assert.equal(payload.institution, null);
});

test("Language editor preserves independent free text details and exact nullable whitelist", () => {
  const globalDraft = createCandidateDossierDraft(createDossier());
  const editor = languageToEditorDraft(globalDraft.languages[0]);
  editor.language = "Changed language";
  editor.overall = "";
  editor.reading = "custom reading";
  editor.writing = "custom writing";
  editor.speaking = "custom speaking";
  editor.listening = "custom listening";
  const confirmed = editorDraftToLanguage(editor);

  assert.equal(confirmed.id, "language-1");
  assert.deepEqual(Object.keys(confirmed), [
    "id", "language", "overall", "reading", "writing", "speaking", "listening",
  ]);
  assert.equal(validateLanguageEditorDraft(editor).valid, true);
  globalDraft.languages[0] = confirmed;
  const payload = toCandidateDossierPayload(globalDraft).languages[0];
  assert.equal(payload.overall, null);
  assert.equal(payload.reading, "custom reading");
  assert.equal(payload.writing, "custom writing");
  assert.equal(payload.speaking, "custom speaking");
  assert.equal(payload.listening, "custom listening");
});

test("SoftSkill editor remains separate and never invents a category", () => {
  const globalDraft = createCandidateDossierDraft(createDossier());
  const editor = softSkillToEditorDraft(globalDraft.softSkills[0]);
  editor.value = "Changed quality";
  editor.detail = "";
  const confirmed = editorDraftToSoftSkill(editor);

  assert.equal(confirmed.id, "soft-1");
  assert.deepEqual(Object.keys(confirmed), ["id", "value", "detail"]);
  assert.equal(Object.hasOwn(confirmed, "category"), false);
  assert.equal(validateSoftSkillEditorDraft(editor).valid, true);
  globalDraft.softSkills[0] = confirmed;
  assert.equal(toCandidateDossierPayload(globalDraft).softSkills[0].detail, null);
});

test("SoftSkill editor converts nullable detail into a controlled optional buffer", () => {
  const editor = softSkillToEditorDraft({
    id: "soft-null-detail",
    value: "Adaptability",
    detail: null,
  });

  assert.deepEqual(editor, {
    id: "soft-null-detail",
    value: "Adaptability",
    detail: "",
  });
  assert.equal(validateSoftSkillEditorDraft(editor).valid, true);
});

test("all four remaining collection limits allow exactly their backend maximum", () => {
  const cases = [
    CandidateDossierConstants.LIMIT.SKILLS,
    CandidateDossierConstants.LIMIT.EDUCATION,
    CandidateDossierConstants.LIMIT.LANGUAGES,
    CandidateDossierConstants.LIMIT.SOFT_SKILLS,
  ];
  for (const maximum of cases) {
    assert.equal(canAddCandidateItem(Array.from({ length: maximum - 1 }), maximum), true);
    assert.equal(canAddCandidateItem(Array.from({ length: maximum }), maximum), false);
  }
});

test("bulk skill parsing preserves line order empties duplicates and punctuation policy", () => {
  assert.deepEqual(parseBulkSkillLines("React\n\nPython\n   \nDocker"), [
    "React", "Python", "Docker",
  ]);
  assert.deepEqual(parseBulkSkillLines("Sales, negotiation\nSales, negotiation"), [
    "Sales, negotiation", "Sales, negotiation",
  ]);
});

test("bulk skill creation generates one stable ID per line with fixed category and null detail", () => {
  let calls = 0;
  const idFactory = () => {
    calls += 1;
    return `bulk-${calls}`;
  };
  for (const category of Object.values(CandidateDossierConstants.SKILL_CATEGORY)) {
    calls = 0;
    const skills = createSkillsFromBulkInput({
      category,
      text: "First\nSecond\nThird",
      idFactory,
    });
    assert.equal(calls, 3);
    assert.deepEqual(skills, [
      { id: "bulk-1", category, value: "First", detail: null },
      { id: "bulk-2", category, value: "Second", detail: null },
      { id: "bulk-3", category, value: "Third", detail: null },
    ]);
  }
});

test("a bulk-created skill opens in the existing editor with a controlled detail buffer", () => {
  const [created] = createSkillsFromBulkInput({
    category: CandidateDossierConstants.SKILL_CATEGORY.TECHNICAL_SKILL,
    text: "Generic skill",
    idFactory: () => {
      return "bulk-edit-id";
    },
  });
  const editor = skillToEditorDraft(created);

  assert.equal(created.detail, null);
  assert.equal(editor.detail, "");
  assert.equal(editor.id, created.id);
  assert.equal(editor.category, created.category);
  assert.equal(editor.value, created.value);
});

test("bulk skill validation refuses empty oversized and over-capacity input without truncation", () => {
  const empty = validateBulkSkillInput("\n  \n", 3);
  assert.equal(empty.valid, false);
  assert.equal(empty.error, "Ajoutez au moins une compétence.");

  const oversizedValue = "x".repeat(CandidateDossierConstants.LIMIT.TEXT_LENGTH + 1);
  const oversized = validateBulkSkillInput(`Valid\n${oversizedValue}`, 3);
  assert.equal(oversized.valid, false);
  assert.deepEqual(oversized.values, ["Valid", oversizedValue]);

  const overCapacity = validateBulkSkillInput("First\nSecond\nThird", 2);
  assert.equal(overCapacity.valid, false);
  assert.equal(overCapacity.error, "Vous pouvez encore ajouter 2 compétence(s).");
  assert.deepEqual(overCapacity.values, ["First", "Second", "Third"]);

  const valid = validateBulkSkillInput("First\nSecond", 2);
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.values, ["First", "Second"]);
});
