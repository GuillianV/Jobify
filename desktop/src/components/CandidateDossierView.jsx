import { useCallback, useEffect, useRef, useState } from "react";
import { CandidateDossierConstants } from "../constants/CandidateDossierConstants.js";
import { ExperienceEditor } from "./ExperienceEditor.jsx";
import { ProjectEditor } from "./ProjectEditor.jsx";
import { CandidateDossierRemainingSections } from "./CandidateDossierRemainingSections.jsx";
import {
  getCandidateDossier,
  saveCandidateDossier,
} from "../services/candidateDossier.js";
import {
  createCandidateDossierDraft,
  createEmptyExperience,
  createEmptyEducation,
  createEmptyLanguage,
  createEmptyProject,
  createEmptySoftSkill,
  createSkillsFromBulkInput,
  hasUnsavedCandidateChanges,
  isCandidateDossierDirty,
  toCandidateDossierPayload,
  toTextLines,
} from "../services/candidateDossierDraft.js";

const LOAD_ERROR_MESSAGE = "Impossible de charger le dossier candidat.";
const INVALID_SAVE_MESSAGE = "Certains champs du dossier sont invalides. Vérifiez les informations saisies.";
const SAVE_ERROR_MESSAGE = "Impossible d'enregistrer le dossier pour le moment.";
const SAVE_SUCCESS_MESSAGE = "Dossier enregistré.";
const EDITOR_KIND = Object.freeze({
  EXPERIENCE: "EXPERIENCE",
  PROJECT: "PROJECT",
  SKILL: "SKILL",
  SKILL_BULK: "SKILL_BULK",
  EDUCATION: "EDUCATION",
  LANGUAGE: "LANGUAGE",
  SOFT_SKILL: "SOFT_SKILL",
});
const ABANDON_EDITOR_MESSAGE = "Abandonner les modifications en cours ?";
const DELETE_EXPERIENCE_MESSAGE = "Supprimer cette expérience ?";
const DELETE_PROJECT_MESSAGE = "Supprimer ce projet ?";

/**
 * Format one YYYY-MM value without inventing absent date information.
 * @param {string} value - Nullable editor month.
 * @returns {string|null} Readable French month or null.
 */
function formatMonth(value) {
  if (!value) {
    return null;
  }
  return new Date(`${value}-01T00:00:00.000Z`).toLocaleDateString("fr-FR", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Build one compact readable period from nullable editor dates.
 * @param {string} startDate - Nullable start month.
 * @param {string} endDate - Nullable end month.
 * @param {boolean} [current] - Whether the period is ongoing.
 * @returns {string|null} Readable period or null when both dates are absent.
 */
function formatPeriod(startDate, endDate, current = false) {
  const start = formatMonth(startDate);
  const end = current ? "Aujourd’hui" : formatMonth(endDate);
  if (!start && !end) {
    return null;
  }
  return [start, end].filter(Boolean).join(" — ");
}

/**
 * Render one accessible collapsible CandidateDossier section shell.
 * @param {object} props - Component properties.
 * @param {string} props.label - Public section label.
 * @param {number} props.count - Current item count.
 * @param {boolean} [props.optional] - Whether the section is explicitly optional.
 * @param {boolean} props.collapsed - Whether content is visually hidden.
 * @param {Function} props.onToggle - Toggle callback.
 * @param {JSX.Element|null} props.action - Optional implemented section action.
 * @param {JSX.Element} props.children - Section content retained while collapsed.
 * @returns {JSX.Element} Collapsible section.
 */
function CandidateSection({
  label,
  count,
  optional = false,
  collapsed,
  onToggle,
  action,
  children,
}) {
  return (
    <section className="rounded-xl border border-border bg-surface-raised p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex items-center gap-2 text-left"
        >
          <h3 className="font-display text-base font-semibold">{label}</h3>
          {optional ? (
            <span className="text-xs font-medium text-muted">Facultatif</span>
          ) : null}
          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-800 dark:bg-brand-800 dark:text-brand-100">
            {count}
          </span>
        </button>
        {action}
      </div>
      <div hidden={collapsed}>{children}</div>
    </section>
  );
}

/**
 * Format one persistence timestamp for discreet French display.
 * @param {string|null} updatedAt - Server timestamp.
 * @returns {string|null} Localized timestamp or null.
 */
function formatUpdatedAt(updatedAt) {
  if (!updatedAt) {
    return null;
  }
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleString("fr-FR");
}

/**
 * Render the lazy singleton CandidateDossier lifecycle and section shell.
 * @param {object} props - Component properties.
 * @param {Function} props.onUnsavedChangesChange - Reports only whether saved data is stale.
 * @returns {JSX.Element} Candidate dossier view.
 */
function CandidateDossierView({ onUnsavedChangesChange }) {
  const [savedDossier, setSavedDossier] = useState(null);
  const [draftDossier, setDraftDossier] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loadStatus, setLoadStatus] = useState(CandidateDossierConstants.LOAD_STATUS.LOADING);
  const [saveStatus, setSaveStatus] = useState(CandidateDossierConstants.SAVE_STATUS.IDLE);
  const [message, setMessage] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState({});
  const didStartLoad = useRef(false);
  const hasUnsavedChangesRef = useRef(false);

  const loadDossier = useCallback(async () => {
    setLoadStatus(CandidateDossierConstants.LOAD_STATUS.LOADING);
    setMessage(null);
    try {
      const result = await getCandidateDossier();
      const canonical = structuredClone(result.dossier);
      setSavedDossier(canonical);
      setDraftDossier(createCandidateDossierDraft(canonical));
      setUpdatedAt(result.updatedAt);
      setLoadStatus(CandidateDossierConstants.LOAD_STATUS.READY);
    } catch {
      setLoadStatus(CandidateDossierConstants.LOAD_STATUS.ERROR);
      setMessage(LOAD_ERROR_MESSAGE);
    }
  }, []);

  useEffect(() => {
    if (!didStartLoad.current) {
      didStartLoad.current = true;
      loadDossier();
    }
  }, [loadDossier]);

  const dirty = savedDossier !== null && draftDossier !== null
    && isCandidateDossierDirty(savedDossier, draftDossier);
  const isSaving = saveStatus === CandidateDossierConstants.SAVE_STATUS.SAVING;
  const hasUnsavedChanges = hasUnsavedCandidateChanges({
    dirty,
    editorDirty,
    isSaving,
  });
  const unresolvedEditor = editorDirty || Boolean(editingItem?.isNew);

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  useEffect(() => {
    onUnsavedChangesChange(hasUnsavedChanges);
  }, [hasUnsavedChanges, onUnsavedChangesChange]);

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!hasUnsavedChangesRef.current) {
        return;
      }
      event.preventDefault();
      event.returnValue = false;
    };
    globalThis.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      globalThis.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  const toggleSection = (key) => {
    setCollapsedSections((current) => {
      return { ...current, [key]: !current[key] };
    });
  };

  const openEditor = (nextEditor) => {
    if (editorDirty && !globalThis.confirm(ABANDON_EDITOR_MESSAGE)) {
      return;
    }
    setEditingItem(nextEditor);
    setEditorDirty(false);
    setCollapsedSections((current) => {
      const keys = {
        [EDITOR_KIND.EXPERIENCE]: "experiences",
        [EDITOR_KIND.PROJECT]: "projects",
        [EDITOR_KIND.SKILL]: "skills",
        [EDITOR_KIND.SKILL_BULK]: "skills",
        [EDITOR_KIND.EDUCATION]: "education",
        [EDITOR_KIND.LANGUAGE]: "languages",
        [EDITOR_KIND.SOFT_SKILL]: "softSkills",
      };
      const key = keys[nextEditor.kind];
      return { ...current, [key]: false };
    });
  };

  const closeEditor = () => {
    setEditingItem(null);
    setEditorDirty(false);
  };

  const confirmExperience = (experience) => {
    setDraftDossier((current) => {
      const experiences = editingItem.isNew
        ? [...current.experiences, experience]
        : current.experiences.map((item) => {
          return item.id === experience.id ? experience : item;
        });
      return { ...current, experiences };
    });
    closeEditor();
  };

  const confirmProject = (project) => {
    setDraftDossier((current) => {
      const projects = editingItem.isNew
        ? [...current.projects, project]
        : current.projects.map((item) => {
          return item.id === project.id ? project : item;
        });
      return { ...current, projects };
    });
    closeEditor();
  };

  const confirmRemainingItem = (key, item) => {
    setDraftDossier((current) => {
      const items = editingItem.isNew
        ? [...current[key], item]
        : current[key].map((existing) => {
          return existing.id === item.id ? item : existing;
        });
      return { ...current, [key]: items };
    });
    closeEditor();
  };

  const confirmBulkSkills = (text) => {
    const skills = createSkillsFromBulkInput({
      category: editingItem.category,
      text,
      idFactory: () => {
        return globalThis.crypto.randomUUID();
      },
    });
    setDraftDossier((current) => {
      return { ...current, skills: [...current.skills, ...skills] };
    });
    closeEditor();
  };

  const createNewItem = (kind) => {
    const idFactory = () => {
      return globalThis.crypto.randomUUID();
    };
    const factories = {
      [EDITOR_KIND.EDUCATION]: () => {
        return createEmptyEducation(idFactory);
      },
      [EDITOR_KIND.LANGUAGE]: () => {
        return createEmptyLanguage(idFactory);
      },
      [EDITOR_KIND.SOFT_SKILL]: () => {
        return createEmptySoftSkill(idFactory);
      },
    };
    return factories[kind]();
  };

  const deleteItem = (kind, id) => {
    const confirmations = {
      [EDITOR_KIND.EXPERIENCE]: DELETE_EXPERIENCE_MESSAGE,
      [EDITOR_KIND.PROJECT]: DELETE_PROJECT_MESSAGE,
      [EDITOR_KIND.EDUCATION]: "Supprimer cette formation ?",
    };
    const message = confirmations[kind];
    if (message && !globalThis.confirm(message)) {
      return;
    }
    const keys = {
      [EDITOR_KIND.EXPERIENCE]: "experiences",
      [EDITOR_KIND.PROJECT]: "projects",
      [EDITOR_KIND.SKILL]: "skills",
      [EDITOR_KIND.EDUCATION]: "education",
      [EDITOR_KIND.LANGUAGE]: "languages",
      [EDITOR_KIND.SOFT_SKILL]: "softSkills",
    };
    const key = keys[kind];
    setDraftDossier((current) => {
      return {
        ...current,
        [key]: current[key].filter((item) => {
          return item.id !== id;
        }),
      };
    });
    if (editingItem?.kind === kind && editingItem.item.id === id) {
      closeEditor();
    }
  };

  const handleSave = async () => {
    if (!dirty || unresolvedEditor || isSaving) {
      return;
    }
    setSaveStatus(CandidateDossierConstants.SAVE_STATUS.SAVING);
    setMessage(null);
    try {
      const result = await saveCandidateDossier(
        toCandidateDossierPayload(draftDossier),
      );
      const canonical = structuredClone(result.dossier);
      setSavedDossier(canonical);
      setDraftDossier(createCandidateDossierDraft(canonical));
      setUpdatedAt(result.updatedAt);
      setSaveStatus(CandidateDossierConstants.SAVE_STATUS.IDLE);
      setMessage(SAVE_SUCCESS_MESSAGE);
    } catch (error) {
      const invalid = error.code === CandidateDossierConstants.ERROR_CODE.INVALID_DOSSIER;
      setSaveStatus(CandidateDossierConstants.SAVE_STATUS.ERROR);
      setMessage(invalid ? INVALID_SAVE_MESSAGE : SAVE_ERROR_MESSAGE);
    }
  };

  if (loadStatus === CandidateDossierConstants.LOAD_STATUS.LOADING) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-6">
        <p role="status" className="text-muted">Chargement du dossier candidat…</p>
      </main>
    );
  }

  if (loadStatus === CandidateDossierConstants.LOAD_STATUS.ERROR) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-6">
        <p role="alert" className="text-danger">{message}</p>
        <button
          type="button"
          onClick={loadDossier}
          className="mt-4 rounded-lg border border-brand-500 px-4 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-500 hover:text-white dark:text-brand-300"
        >
          Réessayer
        </button>
      </main>
    );
  }

  const formattedUpdatedAt = formatUpdatedAt(updatedAt);
  return (
    <main className="mx-auto max-w-4xl px-6 py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold">Dossier candidat</h2>
          <p className="mt-1 text-sm text-muted">
            Vos faits professionnels utiles à vos futures candidatures.
          </p>
        </div>
        {formattedUpdatedAt ? (
          <p className="text-xs text-muted">Dernière sauvegarde : {formattedUpdatedAt}</p>
        ) : null}
      </div>

      <div className="mt-6 space-y-4">
        <CandidateSection
          label="Expériences"
          count={draftDossier.experiences.length}
          collapsed={Boolean(collapsedSections.experiences)}
          onToggle={() => {
            toggleSection("experiences");
          }}
          action={draftDossier.experiences.length < CandidateDossierConstants.LIMIT.EXPERIENCES ? (
            <button
              type="button"
              onClick={() => {
                openEditor({
                  kind: EDITOR_KIND.EXPERIENCE,
                  item: createEmptyExperience(() => {
                    return globalThis.crypto.randomUUID();
                  }),
                  isNew: true,
                });
              }}
              className="rounded-lg border border-brand-500 px-3 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-500 hover:text-white dark:text-brand-300"
            >
              + Ajouter une expérience
            </button>
          ) : (
            <span className="text-xs text-muted">Maximum atteint</span>
          )}
        >
          {draftDossier.experiences.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Aucune expérience renseignée.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {draftDossier.experiences.map((experience) => {
                const period = formatPeriod(
                  experience.startDate,
                  experience.endDate,
                  experience.current,
                );
                const technologies = toTextLines(experience.technologies)
                  .slice(0, CandidateDossierConstants.LIMIT.SUMMARY_TECHNOLOGIES);
                return (
                  <article key={experience.id} className="rounded-lg border border-border bg-surface p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h4 className="font-display font-semibold">{experience.role}</h4>
                        <p className="text-sm text-muted">{experience.organization}</p>
                        {period ? <p className="mt-1 text-xs text-muted">{period}</p> : null}
                        {technologies.length > 0 ? (
                          <p className="mt-1 text-xs text-muted">{technologies.join(" · ")}</p>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            openEditor({
                              kind: EDITOR_KIND.EXPERIENCE,
                              item: experience,
                              isNew: false,
                            });
                          }}
                          className="text-sm font-semibold text-brand-700 hover:text-brand-500 dark:text-brand-300"
                        >
                          Modifier
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            deleteItem(EDITOR_KIND.EXPERIENCE, experience.id);
                          }}
                          className="text-sm font-semibold text-danger"
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {editingItem?.kind === EDITOR_KIND.EXPERIENCE ? (
            <ExperienceEditor
              key={`experience-${editingItem.item.id}`}
              experience={editingItem.item}
              isNew={editingItem.isNew}
              onConfirm={confirmExperience}
              onCancel={closeEditor}
              onDirtyChange={setEditorDirty}
            />
          ) : null}
        </CandidateSection>

        <CandidateSection
          label="Projets complémentaires"
          count={draftDossier.projects.length}
          optional
          collapsed={Boolean(collapsedSections.projects)}
          onToggle={() => {
            toggleSection("projects");
          }}
          action={draftDossier.projects.length < CandidateDossierConstants.LIMIT.PROJECTS ? (
            <button
              type="button"
              onClick={() => {
                openEditor({
                  kind: EDITOR_KIND.PROJECT,
                  item: createEmptyProject(() => {
                    return globalThis.crypto.randomUUID();
                  }),
                  isNew: true,
                });
              }}
              className="rounded-lg border border-brand-500 px-3 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-500 hover:text-white dark:text-brand-300"
            >
              + Ajouter un projet complémentaire
            </button>
          ) : (
            <span className="text-xs text-muted">Maximum atteint</span>
          )}
        >
          {draftDossier.projects.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Aucun projet complémentaire renseigné.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {draftDossier.projects.map((project) => {
                const period = formatPeriod(project.startDate, project.endDate);
                const technologies = toTextLines(project.technologies)
                  .slice(0, CandidateDossierConstants.LIMIT.SUMMARY_TECHNOLOGIES);
                return (
                  <article key={project.id} className="rounded-lg border border-border bg-surface p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h4 className="font-display font-semibold">{project.name}</h4>
                        {project.role ? <p className="text-sm text-muted">{project.role}</p> : null}
                        {period ? <p className="mt-1 text-xs text-muted">{period}</p> : null}
                        {technologies.length > 0 ? (
                          <p className="mt-1 text-xs text-muted">{technologies.join(" · ")}</p>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            openEditor({ kind: EDITOR_KIND.PROJECT, item: project, isNew: false });
                          }}
                          className="text-sm font-semibold text-brand-700 hover:text-brand-500 dark:text-brand-300"
                        >
                          Modifier
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            deleteItem(EDITOR_KIND.PROJECT, project.id);
                          }}
                          className="text-sm font-semibold text-danger"
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {editingItem?.kind === EDITOR_KIND.PROJECT && editingItem.isNew ? (
            <p className="mt-4 text-sm text-muted">
              Ajoutez ici un projet significatif qui n’est pas déjà décrit dans une
              expérience professionnelle : projet personnel, d’études, associatif,
              entrepreneurial ou autre projet pertinent.
            </p>
          ) : null}
          {editingItem?.kind === EDITOR_KIND.PROJECT ? (
            <ProjectEditor
              key={`project-${editingItem.item.id}`}
              project={editingItem.item}
              isNew={editingItem.isNew}
              onConfirm={confirmProject}
              onCancel={closeEditor}
              onDirtyChange={setEditorDirty}
            />
          ) : null}
        </CandidateSection>

        <CandidateDossierRemainingSections
          draftDossier={draftDossier}
          editingItem={editingItem}
          editorKind={EDITOR_KIND}
          collapsedSections={collapsedSections}
          renderSection={CandidateSection}
          toggleSection={toggleSection}
          openEditor={openEditor}
          deleteItem={deleteItem}
          confirmItem={confirmRemainingItem}
          confirmBulkSkills={confirmBulkSkills}
          closeEditor={closeEditor}
          onDirtyChange={setEditorDirty}
          createNewItem={createNewItem}
          formatPeriod={formatPeriod}
        />
      </div>

      {message ? (
        <p
          role={saveStatus === CandidateDossierConstants.SAVE_STATUS.ERROR
            ? "alert"
            : "status"}
          className={saveStatus === CandidateDossierConstants.SAVE_STATUS.ERROR
            ? "mt-4 text-sm text-danger"
            : "mt-4 text-sm text-success"}
        >
          {message}
        </p>
      ) : null}

      <p role="status" className="sr-only">
        {isSaving ? "Enregistrement…" : ""}
      </p>

      <div className="mt-6 flex justify-end">
        {unresolvedEditor ? (
          <p className="mr-4 self-center text-xs text-muted">
            Validez ou annulez l'édition en cours avant d'enregistrer le dossier.
          </p>
        ) : null}
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || unresolvedEditor || isSaving}
          className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isSaving
            ? "Enregistrement…"
            : "Enregistrer les modifications"}
        </button>
      </div>
    </main>
  );
}

export { CandidateDossierView };
