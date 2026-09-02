/**
 * The settings page.
 *
 * It writes every change at once, because a settings page with a save button
 * loses the change of a user who closes the tab. The schema validates the state
 * before the write, so an impossible combination never reaches the storage.
 */

import { DEFAULT_LANGUAGE, LANGUAGES } from "../core/languages.js";
import {
  defaultSettings,
  LayoutModeSchema,
  type Settings,
  SettingsSchema,
} from "../core/settings.js";
import { readSettings, writeSettings } from "../shared/settings-store.js";

const need = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`the page holds no #${id}`);
  return node as T;
};

const fields = {
  languageFilter: need<HTMLInputElement>("language-filter"),
  languages: need<HTMLDivElement>("languages"),
  layout: need<HTMLSelectElement>("layout"),
  minConfidence: need<HTMLInputElement>("min-confidence"),
  minConfidenceValue: need<HTMLOutputElement>("min-confidence-value"),
  upscale: need<HTMLInputElement>("upscale"),
  maxScale: need<HTMLInputElement>("max-scale"),
  maxScaleValue: need<HTMLOutputElement>("max-scale-value"),
  autoCopy: need<HTMLInputElement>("auto-copy"),
  showBoxes: need<HTMLInputElement>("show-boxes"),
  state: need<HTMLSpanElement>("state"),
  reset: need<HTMLButtonElement>("reset"),
};

const languageBoxes = new Map<string, HTMLInputElement>();

const buildLanguageList = (): void => {
  const rows = LANGUAGES.map((entry) => {
    const row = document.createElement("label");
    row.className = "language";
    row.dataset["code"] = entry.code;
    row.dataset["label"] = entry.label.toLowerCase();

    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = entry.code;

    const name = document.createElement("span");
    name.textContent = entry.label;

    row.append(box, name);
    if (entry.bundled) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = "bundled";
      row.append(tag);
    }

    languageBoxes.set(entry.code, box);
    box.addEventListener("change", () => void save());
    return row;
  });

  fields.languages.replaceChildren(...rows);
};

const selectedLanguages = (): string[] =>
  [...languageBoxes.entries()].filter(([, box]) => box.checked).map(([code]) => code);

/** Reads the form. An invalid form keeps the stored value of the invalid field. */
const readForm = (): Settings => {
  const draft = {
    languages: selectedLanguages(),
    layout: LayoutModeSchema.catch("auto").parse(fields.layout.value),
    minConfidence: Number(fields.minConfidence.value),
    upscale: fields.upscale.checked,
    maxScale: Number(fields.maxScale.value),
    autoCopy: fields.autoCopy.checked,
    showBoxes: fields.showBoxes.checked,
  };

  const parsed = SettingsSchema.safeParse(draft);
  return parsed.success
    ? parsed.data
    : { ...defaultSettings(), ...draft, languages: [DEFAULT_LANGUAGE] };
};

const applyToForm = (settings: Settings): void => {
  for (const [code, box] of languageBoxes) box.checked = settings.languages.includes(code);
  fields.layout.value = settings.layout;
  fields.minConfidence.value = String(settings.minConfidence);
  fields.upscale.checked = settings.upscale;
  fields.maxScale.value = String(settings.maxScale);
  fields.autoCopy.checked = settings.autoCopy;
  fields.showBoxes.checked = settings.showBoxes;
  renderReadouts(settings);
};

const renderReadouts = (settings: Settings): void => {
  fields.minConfidenceValue.textContent = `${settings.minConfidence}%`;
  fields.maxScaleValue.textContent = `${settings.maxScale}×`;
  fields.maxScale.disabled = !settings.upscale;
};

let stateTimer = 0;

const announce = (text: string): void => {
  fields.state.textContent = text;
  window.clearTimeout(stateTimer);
  stateTimer = window.setTimeout(() => {
    fields.state.textContent = "";
  }, 1800);
};

/** One language must stay, so the last box that a user clears comes back. */
const ensureOneLanguage = (): void => {
  if (selectedLanguages().length > 0) return;
  const fallback = languageBoxes.get(DEFAULT_LANGUAGE);
  if (fallback !== undefined) fallback.checked = true;
  announce("At least one language stays selected.");
};

const save = async (): Promise<void> => {
  ensureOneLanguage();
  const settings = readForm();

  renderReadouts(settings);
  await writeSettings(settings);
  announce("Saved");
};

const filterLanguages = (): void => {
  const needle = fields.languageFilter.value.trim().toLowerCase();
  for (const row of fields.languages.children) {
    if (!(row instanceof HTMLElement)) continue;
    const label = row.dataset["label"] ?? "";
    const code = row.dataset["code"] ?? "";
    row.hidden = needle !== "" && !label.includes(needle) && !code.includes(needle);
  }
};

const start = async (): Promise<void> => {
  buildLanguageList();
  applyToForm(await readSettings());

  for (const field of [
    fields.layout,
    fields.minConfidence,
    fields.upscale,
    fields.maxScale,
    fields.autoCopy,
    fields.showBoxes,
  ]) {
    field.addEventListener("change", () => void save());
  }
  fields.minConfidence.addEventListener("input", () => renderReadouts(readForm()));
  fields.maxScale.addEventListener("input", () => renderReadouts(readForm()));
  fields.languageFilter.addEventListener("input", filterLanguages);

  fields.reset.addEventListener("click", () => {
    const defaults = defaultSettings();
    applyToForm(defaults);
    void writeSettings(defaults).then(() => announce("Defaults restored"));
  });
};

void start();
