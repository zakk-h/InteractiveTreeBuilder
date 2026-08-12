type ArborEnumFeature = {
  internalFeature: number;
  originalFeature: number;
  originalName: string;
  threshold: number;
};

type CurrentPayload = {
  graph?: {
    leaf_nodes?: Array<{ prediction: number }>;
  };
  meta?: Record<string, unknown> & {
    featureRegistry?: ArborEnumFeature[];
  };
};

type ConstraintResult = {
  ok: boolean;
  message?: string;
};

const STYLE_ID = 'arborenum-constrained-completion-style';
const BUTTON_ID = 'arborenum-constrained-completion-button';
const MODAL_ID = 'arborenum-constrained-completion-modal';

function internalWindow() {
  return window as Window & Record<string, unknown>;
}

function currentPayload(): CurrentPayload | undefined {
  const w = internalWindow();
  return (
    w.ARBORENUM_CURRENT_BUILDER_PAYLOAD ??
    w.ARBORENUM_BUILDER_PAYLOAD
  ) as CurrentPayload | undefined;
}

function registry(): ArborEnumFeature[] {
  const raw = currentPayload()?.meta?.featureRegistry;
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry) => ({
      internalFeature: Number(entry.internalFeature),
      originalFeature: Number(entry.originalFeature),
      originalName: String(entry.originalName),
      threshold: Number(entry.threshold),
    }))
    .filter(
      (entry) =>
        Number.isInteger(entry.internalFeature) &&
        Number.isInteger(entry.originalFeature) &&
        entry.originalName.length > 0 &&
        Number.isFinite(entry.threshold),
    );
}

function originalFeatures() {
  const features = new Map<number, string>();
  for (const entry of registry()) {
    if (!features.has(entry.originalFeature)) {
      features.set(entry.originalFeature, entry.originalName);
    }
  }

  return Array.from(features.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.id - b.id);
}

function predictions() {
  const leaves = currentPayload()?.graph?.leaf_nodes ?? [];
  return Array.from(
    new Set(
      leaves
        .map((leaf) => Number(leaf.prediction))
        .filter((prediction) => Number.isFinite(prediction) && prediction >= 0),
    ),
  ).sort((a, b) => a - b);
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .constraint-backdrop {
      position: fixed;
      inset: 0;
      z-index: 10000;
      background: rgba(15, 23, 42, 0.36);
      backdrop-filter: blur(3px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }

    .constraint-modal {
      width: min(760px, calc(100vw - 48px));
      max-height: min(820px, calc(100vh - 48px));
      overflow: auto;
      border-radius: 18px;
      background: white;
      border: 1px solid #dbe4ee;
      box-shadow: 0 30px 80px rgba(15, 23, 42, 0.24);
      color: #162033;
    }

    .constraint-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      padding: 22px 24px 18px;
      border-bottom: 1px solid #e7edf4;
    }

    .constraint-header-copy { display: grid; gap: 4px; }
    .constraint-header-copy b { font-size: 18px; }

    .constraint-header-copy span,
    .constraint-help {
      color: #607086;
      font-size: 13px;
      line-height: 1.45;
    }

    .constraint-close {
      border: 0;
      background: #f4f7fa;
      width: 34px;
      height: 34px;
      border-radius: 9px;
      cursor: pointer;
      font-size: 20px;
      color: #526277;
    }

    .constraint-tabs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      padding: 18px 24px 0;
    }

    .constraint-tabs button {
      border: 1px solid #dbe4ee;
      background: #f8fafc;
      border-radius: 10px;
      padding: 11px 14px;
      font-weight: 750;
      color: #526277;
      cursor: pointer;
    }

    .constraint-tabs button.active {
      border-color: #8ab4e2;
      background: #edf6ff;
      color: #244f7d;
    }

    .constraint-body {
      padding: 18px 24px 24px;
      display: grid;
      gap: 16px;
    }

    .constraint-check-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      max-height: 330px;
      overflow: auto;
      padding-right: 4px;
    }

    .constraint-check-row {
      display: flex;
      align-items: center;
      gap: 9px;
      border: 1px solid #e0e7ef;
      border-radius: 9px;
      padding: 9px 10px;
      background: #fbfdff;
      font-size: 13px;
    }

    .constraint-sample-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px 14px;
      max-height: 360px;
      overflow: auto;
      padding-right: 4px;
    }

    .constraint-sample-grid label,
    .constraint-prediction-row {
      display: grid;
      gap: 5px;
      font-size: 12px;
      color: #526277;
    }

    .constraint-sample-grid input,
    .constraint-prediction-row select {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #d8e1eb;
      border-radius: 8px;
      padding: 9px 10px;
      background: white;
      color: #172033;
      font: inherit;
    }

    .constraint-primary {
      justify-self: start;
      border: 0;
      border-radius: 10px;
      padding: 11px 15px;
      background: #315f8f;
      color: white;
      font-weight: 800;
      cursor: pointer;
    }

    .constraint-primary:hover { filter: brightness(0.97); }

    .constraint-message {
      border-radius: 10px;
      background: #fff7ed;
      border: 1px solid #fed7aa;
      color: #9a4f10;
      padding: 10px 12px;
      font-size: 13px;
      line-height: 1.4;
    }

    @media (max-width: 680px) {
      .constraint-check-grid,
      .constraint-sample-grid { grid-template-columns: 1fr; }
    }
  `;
  document.head.appendChild(style);
}

function closeModal() {
  document.getElementById(MODAL_ID)?.remove();
}

function findOptimalButton(): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.toolbar-row button')).find(
    (button) => button.textContent?.trim().toLowerCase().includes('optimal'),
  );
}

function runConstraint(
  spec:
    | { mode: 'avoid'; forbiddenInternalFeatures: number[] }
    | { mode: 'sample'; featureTruth: Record<string, boolean>; targetPrediction: number },
  message: HTMLElement,
) {
  const optimal = findOptimalButton();

  if (!optimal || optimal.disabled) {
    message.textContent = 'The tree has no unfinished choices to complete.';
    message.style.display = 'block';
    return;
  }

  const w = internalWindow();
  w.ARBORENUM_CONSTRAINED_COMPLETION_RESULT = undefined;
  w.ARBORENUM_CONSTRAINED_COMPLETION = spec;
  optimal.click();
  w.ARBORENUM_CONSTRAINED_COMPLETION = undefined;

  const result = w.ARBORENUM_CONSTRAINED_COMPLETION_RESULT as
    | ConstraintResult
    | undefined;

  if (result?.ok) {
    closeModal();
    return;
  }

  message.textContent = result?.message ?? 'No feasible constrained completion was found.';
  message.style.display = 'block';
}

function avoidPanel(message: HTMLElement) {
  const body = document.createElement('div');
  body.className = 'constraint-body';

  const help = document.createElement('div');
  help.className = 'constraint-help';
  help.textContent =
    'Select one or more original features. The final tree will not use any threshold of those features. Existing splits are kept; if one already uses a selected feature, rewind it first.';
  body.appendChild(help);

  const features = originalFeatures();
  if (features.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'constraint-message';
    empty.textContent = 'This payload does not contain ArborEnum featureRegistry metadata.';
    body.appendChild(empty);
    return body;
  }

  const grid = document.createElement('div');
  grid.className = 'constraint-check-grid';

  for (const feature of features) {
    const label = document.createElement('label');
    label.className = 'constraint-check-row';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.originalFeature = String(feature.id);

    const name = document.createElement('span');
    name.textContent = feature.name;
    label.append(input, name);
    grid.appendChild(label);
  }

  const run = document.createElement('button');
  run.type = 'button';
  run.className = 'constraint-primary';
  run.textContent = 'Build optimal constrained completion';
  run.addEventListener('click', () => {
    const selected = Array.from(
      grid.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'),
    ).map((input) => Number(input.dataset.originalFeature));

    if (selected.length === 0) {
      message.textContent = 'Select at least one feature to avoid.';
      message.style.display = 'block';
      return;
    }

    const selectedSet = new Set(selected);
    const forbiddenInternalFeatures = registry()
      .filter((entry) => selectedSet.has(entry.originalFeature))
      .map((entry) => entry.internalFeature);

    runConstraint({ mode: 'avoid', forbiddenInternalFeatures }, message);
  });

  body.append(grid, run);
  return body;
}

function samplePanel(message: HTMLElement) {
  const body = document.createElement('div');
  body.className = 'constraint-body';

  const help = document.createElement('div');
  help.className = 'constraint-help';
  help.textContent =
    'Enter any feature values you know and leave the rest blank. Blank means unknown: the completed tree must produce the requested prediction for every full sample consistent with the values you entered. If an unknown feature is used by a split, both branches are constrained.';
  body.appendChild(help);

  const features = originalFeatures();
  const featureRegistry = registry();
  if (features.length === 0 || featureRegistry.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'constraint-message';
    empty.textContent = 'Sample constraints require ArborEnum featureRegistry metadata.';
    body.appendChild(empty);
    return body;
  }

  const grid = document.createElement('div');
  grid.className = 'constraint-sample-grid';
  const inputs = new Map<number, HTMLInputElement>();

  for (const feature of features) {
    const label = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = feature.name;

    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.placeholder = 'blank = unknown';
    inputs.set(feature.id, input);
    label.append(name, input);
    grid.appendChild(label);
  }

  const predictionLabel = document.createElement('label');
  predictionLabel.className = 'constraint-prediction-row';
  const predictionName = document.createElement('span');
  predictionName.textContent = 'Prediction to ensure';

  const select = document.createElement('select');
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = 'Choose class';
  select.appendChild(blank);

  for (const prediction of predictions()) {
    const option = document.createElement('option');
    option.value = String(prediction);
    option.textContent = `class ${prediction}`;
    select.appendChild(option);
  }
  predictionLabel.append(predictionName, select);

  const run = document.createElement('button');
  run.type = 'button';
  run.className = 'constraint-primary';
  run.textContent = 'Build optimal constrained completion';
  run.addEventListener('click', () => {
    const values = new Map<number, number>();

    for (const feature of features) {
      const raw = inputs.get(feature.id)?.value.trim() ?? '';
      if (raw === '') continue;

      const value = Number(raw);
      if (!Number.isFinite(value)) {
        message.textContent = `Enter a numeric value for ${feature.name}, or leave it blank.`;
        message.style.display = 'block';
        return;
      }
      values.set(feature.id, value);
    }

    const targetPrediction = Number(select.value);
    if (select.value === '' || !Number.isFinite(targetPrediction)) {
      message.textContent = 'Choose the prediction to ensure.';
      message.style.display = 'block';
      return;
    }

    const featureTruth: Record<string, boolean> = {};
    for (const entry of featureRegistry) {
      const value = values.get(entry.originalFeature);
      if (!Number.isFinite(value)) continue;
      featureTruth[String(entry.internalFeature)] = Number(value) <= entry.threshold;
    }

    runConstraint({ mode: 'sample', featureTruth, targetPrediction }, message);
  });

  body.append(grid, predictionLabel, run);
  return body;
}

function openModal() {
  closeModal();
  injectStyles();

  const backdrop = document.createElement('div');
  backdrop.id = MODAL_ID;
  backdrop.className = 'constraint-backdrop';

  const modal = document.createElement('div');
  modal.className = 'constraint-modal';
  modal.addEventListener('mousedown', (event) => event.stopPropagation());

  const header = document.createElement('div');
  header.className = 'constraint-header';

  const headerCopy = document.createElement('div');
  headerCopy.className = 'constraint-header-copy';
  const title = document.createElement('b');
  title.textContent = 'Constrained completion';
  const subtitle = document.createElement('span');
  subtitle.textContent =
    'Optimally fill every unfinished node subject to a constraint and the current Rashomon budget.';
  headerCopy.append(title, subtitle);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'constraint-close';
  close.textContent = '×';
  close.addEventListener('click', closeModal);
  header.append(headerCopy, close);

  const tabs = document.createElement('div');
  tabs.className = 'constraint-tabs';
  const avoidTab = document.createElement('button');
  avoidTab.type = 'button';
  avoidTab.textContent = 'Avoid features';
  const sampleTab = document.createElement('button');
  sampleTab.type = 'button';
  sampleTab.textContent = 'Ensure sample prediction';
  tabs.append(avoidTab, sampleTab);

  const content = document.createElement('div');
  const message = document.createElement('div');
  message.className = 'constraint-message';
  message.style.display = 'none';
  message.style.margin = '0 24px 24px';

  const show = (mode: 'avoid' | 'sample') => {
    avoidTab.classList.toggle('active', mode === 'avoid');
    sampleTab.classList.toggle('active', mode === 'sample');
    message.style.display = 'none';
    content.replaceChildren(mode === 'avoid' ? avoidPanel(message) : samplePanel(message));
  };

  avoidTab.addEventListener('click', () => show('avoid'));
  sampleTab.addEventListener('click', () => show('sample'));

  modal.append(header, tabs, content, message);
  backdrop.appendChild(modal);
  backdrop.addEventListener('mousedown', closeModal);
  document.body.appendChild(backdrop);
  show('avoid');
}

function installButton() {
  const toolbar = document.querySelector('.toolbar-row');
  if (!toolbar || document.getElementById(BUTTON_ID)) return;

  const optimal = findOptimalButton();
  if (!optimal) return;

  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.type = 'button';
  button.className = 'ghost-button';
  button.textContent = 'Constrained';
  button.title = 'Optimally complete the unfinished nodes subject to a constraint';
  button.disabled = optimal.disabled;
  button.addEventListener('click', openModal);
  optimal.insertAdjacentElement('afterend', button);
}

function syncButton() {
  installButton();
  const button = document.getElementById(BUTTON_ID) as HTMLButtonElement | null;
  const optimal = findOptimalButton();
  if (button && optimal && button.disabled !== optimal.disabled) {
    button.disabled = optimal.disabled;
  }
}

injectStyles();
syncButton();

const observer = new MutationObserver(syncButton);
observer.observe(document.body, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ['disabled'],
});
