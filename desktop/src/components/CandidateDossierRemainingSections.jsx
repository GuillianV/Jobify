import { CandidateDossierConstants } from "../constants/CandidateDossierConstants.js";
import { BulkSkillEditor } from "./BulkSkillEditor.jsx";
import { EducationEditor } from "./EducationEditor.jsx";
import { LanguageEditor } from "./LanguageEditor.jsx";
import { SkillEditor } from "./SkillEditor.jsx";
import { SoftSkillEditor } from "./SoftSkillEditor.jsx";

const SKILL_GROUPS = Object.freeze([
  {
    category: CandidateDossierConstants.SKILL_CATEGORY.TECHNICAL_SKILL,
    label: "Compétences techniques",
    addLabel: "Ajouter des compétences techniques",
  },
  {
    category: CandidateDossierConstants.SKILL_CATEGORY.FUNCTIONAL_SKILL,
    label: "Compétences fonctionnelles",
    addLabel: "Ajouter des compétences fonctionnelles",
  },
  {
    category: CandidateDossierConstants.SKILL_CATEGORY.TOOL_OR_TECHNOLOGY,
    label: "Outils / technologies",
    addLabel: "Ajouter des outils ou technologies",
  },
]);

/**
 * Render one compact item action row.
 * @param {object} props - Component properties.
 * @param {JSX.Element} props.children - Public item summary.
 * @param {Function} props.onEdit - Open editor callback.
 * @param {Function} props.onDelete - Draft-only delete callback.
 * @returns {JSX.Element} Compact editable row.
 */
function ItemRow({ children, onEdit, onDelete }) {
  return (
    <article className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>{children}</div>
        <div className="flex gap-2">
          <button type="button" onClick={onEdit} className="text-sm font-semibold text-brand-700 hover:text-brand-500 dark:text-brand-300">Modifier</button>
          <button type="button" onClick={onDelete} className="text-sm font-semibold text-danger">Supprimer</button>
        </div>
      </div>
    </article>
  );
}

/**
 * Render the four compact CandidateDossier collections and their extracted editors.
 * @param {object} props - Component properties.
 * @param {object} props.draftDossier - Complete editable dossier.
 * @param {object|null} props.editingItem - Single current editor identity.
 * @param {object} props.editorKind - Closed editor kind vocabulary.
 * @param {object} props.collapsedSections - Section visibility state.
 * @param {Function} props.renderSection - Shared section renderer.
 * @param {Function} props.toggleSection - Toggle section callback.
 * @param {Function} props.openEditor - Single-editor protected opener.
 * @param {Function} props.deleteItem - Draft-only delete callback.
 * @param {Function} props.confirmItem - Insert or replace callback.
 * @param {Function} props.confirmBulkSkills - Insert confirmed bulk Skill items.
 * @param {Function} props.closeEditor - Cancel callback.
 * @param {Function} props.onDirtyChange - Local editor dirty callback.
 * @param {Function} props.createNewItem - Stable factory callback.
 * @param {Function} props.formatPeriod - Readable nullable period formatter.
 * @returns {JSX.Element} Four functional section siblings.
 */
function CandidateDossierRemainingSections({
  draftDossier,
  editingItem,
  editorKind,
  collapsedSections,
  renderSection: Section,
  toggleSection,
  openEditor,
  deleteItem,
  confirmItem,
  confirmBulkSkills,
  closeEditor,
  onDirtyChange,
  createNewItem,
  formatPeriod,
}) {
  const languageHasDetails = (language) => {
    return [language.reading, language.writing, language.speaking, language.listening]
      .some(Boolean);
  };
  const sections = [
    {
      key: "skills", label: "Compétences", kind: editorKind.SKILL,
      maximum: CandidateDossierConstants.LIMIT.SKILLS,
    },
    {
      key: "education", label: "Formations", kind: editorKind.EDUCATION,
      maximum: CandidateDossierConstants.LIMIT.EDUCATION, addLabel: "+ Ajouter une formation",
    },
    {
      key: "languages", label: "Langues", kind: editorKind.LANGUAGE,
      maximum: CandidateDossierConstants.LIMIT.LANGUAGES, addLabel: "+ Ajouter une langue",
    },
    {
      key: "softSkills", label: "Soft skills", kind: editorKind.SOFT_SKILL,
      maximum: CandidateDossierConstants.LIMIT.SOFT_SKILLS,
      addLabel: "+ Ajouter une qualité professionnelle",
    },
  ];

  const renderItems = (section) => {
    const items = draftDossier[section.key];
    if (section.key === "skills") {
      const remainingCapacity = CandidateDossierConstants.LIMIT.SKILLS - items.length;
      return (
        <div className="mt-4 space-y-4">
          {SKILL_GROUPS.map((group) => {
            const grouped = items.filter((item) => {
              return item.category === group.category;
            });
            return (
              <div key={group.category}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold">{group.label}</h4>
                  {remainingCapacity > 0 ? (
                    <button
                      type="button"
                      aria-label={group.addLabel}
                      onClick={() => {
                        openEditor({
                          kind: editorKind.SKILL_BULK,
                          category: group.category,
                          isNew: true,
                        });
                      }}
                      className="rounded-lg border border-brand-500 px-3 py-1 text-xs font-semibold text-brand-700 transition hover:bg-brand-500 hover:text-white dark:text-brand-300"
                    >
                      + Ajouter
                    </button>
                  ) : <span className="text-xs text-muted">Maximum atteint</span>}
                </div>
                {grouped.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    {grouped.map((item) => {
                      return (
                        <div key={item.id} className="space-y-2">
                          <ItemRow onEdit={() => {
                            openEditor({ kind: section.kind, item, isNew: false });
                          }} onDelete={() => {
                            deleteItem(section.kind, item.id);
                          }}>
                            <p className="font-medium">{item.value}</p>
                            {item.detail ? (
                              <p className="text-sm text-muted">{item.detail}</p>
                            ) : null}
                          </ItemRow>
                          {editingItem?.kind === editorKind.SKILL
                            && editingItem.item.id === item.id ? (
                              <SkillEditor
                                skill={editingItem.item}
                                onConfirm={(skill) => {
                                  confirmItem(section.key, skill);
                                }}
                                onCancel={closeEditor}
                                onDirtyChange={onDirtyChange}
                              />
                            ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted">Aucune compétence renseignée.</p>
                )}
                {editingItem?.kind === editorKind.SKILL_BULK
                  && editingItem.category === group.category ? (
                    <BulkSkillEditor
                      key={`bulk-${group.category}`}
                      categoryLabel={group.label}
                      remainingCapacity={remainingCapacity}
                      onConfirm={confirmBulkSkills}
                      onCancel={closeEditor}
                      onDirtyChange={onDirtyChange}
                    />
                  ) : null}
              </div>
            );
          })}
        </div>
      );
    }
    if (items.length === 0) {
      return <p className="mt-3 text-sm text-muted">Aucun élément renseigné.</p>;
    }
    return (
      <div className="mt-4 space-y-2">
        {items.map((item) => {
          let title = item.diploma ?? item.language ?? item.value;
          let detail = item.institution ?? item.overall ?? item.detail;
          if (section.key === "education") {
            const period = formatPeriod(item.startDate, item.endDate);
            detail = [item.institution, period].filter(Boolean).join(" · ");
          }
          if (section.key === "languages" && !item.overall && languageHasDetails(item)) {
            detail = "Niveaux détaillés renseignés";
          }
          return (
            <ItemRow key={item.id} onEdit={() => {
              openEditor({ kind: section.kind, item, isNew: false });
            }} onDelete={() => {
              deleteItem(section.kind, item.id);
            }}>
              <p className="font-medium">{title}</p>
              {detail ? <p className="text-sm text-muted">{detail}</p> : null}
            </ItemRow>
          );
        })}
      </div>
    );
  };

  const renderEditor = (section) => {
    if (editingItem?.kind !== section.kind) {
      return null;
    }
    if (section.key === "skills") {
      return null;
    }
    const common = {
      onConfirm: (item) => {
        confirmItem(section.key, item);
      },
      onCancel: closeEditor,
      onDirtyChange,
    };
    if (section.key === "education") {
      return <EducationEditor key={editingItem.item.id} education={editingItem.item} isNew={editingItem.isNew} {...common} />;
    }
    if (section.key === "languages") {
      return <LanguageEditor key={editingItem.item.id} language={editingItem.item} isNew={editingItem.isNew} {...common} />;
    }
    if (section.key === "softSkills") {
      return <SoftSkillEditor key={editingItem.item.id} softSkill={editingItem.item} isNew={editingItem.isNew} {...common} />;
    }
    return null;
  };

  return sections.map((section) => {
    const items = draftDossier[section.key];
    const canAdd = items.length < section.maximum;
    return (
      <Section
        key={section.key}
        label={section.label}
        count={items.length}
        collapsed={Boolean(collapsedSections[section.key])}
        onToggle={() => {
          toggleSection(section.key);
        }}
        action={section.key === "skills" ? null : canAdd ? (
          <button type="button" onClick={() => {
            openEditor({ kind: section.kind, item: createNewItem(section.kind), isNew: true });
          }} className="rounded-lg border border-brand-500 px-3 py-1.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-500 hover:text-white dark:text-brand-300">
            {section.addLabel}
          </button>
        ) : <span className="text-xs text-muted">Maximum atteint</span>}
      >
        {renderItems(section)}
        {renderEditor(section)}
      </Section>
    );
  });
}

export { CandidateDossierRemainingSections };
