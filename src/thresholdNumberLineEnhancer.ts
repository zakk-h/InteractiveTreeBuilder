type RegistryEntry = {
  internalFeature: number;
  originalFeature: number;
  originalName: string;
  threshold: number;
  kind: 'binary_threshold' | 'continuous_threshold';
  continuousGroup: number | null;
};

type CurrentPayload = {
  meta?: {
    featureRegistry?: RegistryEntry[];
  };
};

declare global {
  interface Window {
    ARBORENUM_CURRENT_BUILDER_PAYLOAD?: CurrentPayload;
    ARBORENUM_BUILDER_PAYLOAD?: CurrentPayload;
    PRAXIS_BUILDER_PAYLOAD?: CurrentPayload;
  }
}

const STYLE_ID = 'arborenum-threshold-line-style';
const ENHANCER_CLASS = 'threshold-line-enhancer';
const HIDDEN_CLASS = 'threshold-native-hidden';
const MIN_NUMBER_LINE_CHOICES = 11;

function currentPayload(): CurrentPayload | undefined {
  return (
    window.ARBORENUM_CURRENT_BUILDER_PAYLOAD ??
    window.ARBORENUM_BUILDER_PAYLOAD ??
    window.PRAXIS_BUILDER_PAYLOAD
  );
}

function registry(): RegistryEntry[] {
  const raw = currentPayload()?.meta?.featureRegistry;
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry) => ({
      internalFeature: Number(entry.internalFeature),
      originalFeature: Number(entry.originalFeature),
      originalName: String(entry.originalName),
      threshold: Number(entry.threshold),
      kind: entry.kind,
      continuousGroup:
        entry.continuousGroup === null ? null : Number(entry.continuousGroup),
    }))
    .filter(
      (entry) =>
        Number.isInteger(entry.internalFeature) &&
        Number.isFinite(entry.threshold) &&
        entry.kind === 'continuous_threshold' &&
        Number.isInteger(entry.continuousGroup),
    );
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .threshold-native-hidden {
      display: none !important;
    }

    .threshold-line-enhancer {
      margin-top: 10px;
      padding: 14px 13px 13px;
      border: 1px solid #dbe4ee;
      border-radius: 16px;
      background: #ffffff;
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.045);
      color: #102033;
    }

    .threshold-line-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      margin-bottom: 10px;
      color: #526277;
      font-size: 11px;
      font-weight: 800;
    }

    .threshold-line-legend > span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .threshold-line-swatch {
      width: 18px;
      height: 8px;
      border-radius: 999px;
      border: 1px solid rgba(15, 23, 42, 0.18);
    }

    .threshold-line-swatch.feasible {
      background: #0072b2;
    }

    .threshold-line-swatch.blocked {
      background: repeating-linear-gradient(
        135deg,
        #d55e00 0,
        #d55e00 4px,
        #ffffff 4px,
        #ffffff 7px
      );
    }

    .threshold-line-track {
      position: relative;
      display: block;
      width: 100%;
      height: 46px;
      padding: 0 7px;
      border: 0;
      background: transparent;
      cursor: crosshair;
    }

    .threshold-line-axis {
      position: absolute;
      left: 7px;
      right: 7px;
      top: 19px;
      height: 8px;
      border-radius: 999px;
      background: #d8e1eb;
      overflow: hidden;
    }

    .threshold-line-segment {
      position: absolute;
      top: 0;
      bottom: 0;
      min-width: 1px;
    }

    .threshold-line-segment.feasible {
      background: #0072b2;
    }

    .threshold-line-segment.blocked {
      background: repeating-linear-gradient(
        135deg,
        #d55e00 0,
        #d55e00 5px,
        #ffffff 5px,
        #ffffff 8px
      );
    }

    .threshold-line-tick {
      position: absolute;
      top: 14px;
      width: 14px;
      height: 14px;
      margin-left: -7px;
      border: 2px solid #ffffff;
      box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.28);
      pointer-events: none;
      z-index: 2;
    }

    .threshold-line-tick.feasible {
      border-radius: 999px;
      background: #0072b2;
    }

    .threshold-line-tick.blocked {
      border-radius: 2px;
      background: #d55e00;
      transform: rotate(45deg);
    }

    .threshold-line-selected {
      position: absolute;
      top: 8px;
      width: 2px;
      height: 26px;
      margin-left: -1px;
      background: #111827;
      pointer-events: none;
      z-index: 3;
    }

    .threshold-line-labels {
      display: flex;
      justify-content: space-between;
      margin-top: -3px;
      color: #64748b;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }

    .threshold-line-manual {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: end;
      margin-top: 12px;
    }

    .threshold-line-manual label {
      display: grid;
      gap: 5px;
      color: #526277;
      font-size: 11px;
      font-weight: 800;
    }

    .threshold-line-manual input {
      width: 100%;
      min-width: 0;
      height: 38px;
      border: 1px solid #d8e1eb;
      border-radius: 10px;
      padding: 0 10px;
      color: #102033;
      background: #ffffff;
      outline: none;
    }

    .threshold-line-manual input:focus {
      border-color: #0072b2;
      box-shadow: 0 0 0 3px rgba(0, 114, 178, 0.12);
    }

    .threshold-line-use {
      min-height: 38px;
      border: 1px solid #00679f;
      border-radius: 10px;
      padding: 0 12px;
      color: #ffffff;
      background: #0072b2;
      font-weight: 850;
      cursor: pointer;
    }

    .threshold-line-use:disabled {
      cursor: not-allowed;
      color: #64748b;
      background: #f1f5f9;
      border-color: #d8e1eb;
    }

    .threshold-line-message {
      margin-top: 9px;
      min-height: 30px;
      padding: 8px 10px;
      border-radius: 10px;
      color: #315f72;
      background: #eef8fc;
      border: 1px solid #b9dfeb;
      font-size: 11px;
      line-height: 1.35;
      font-weight: 750;
    }

    .threshold-line-message.blocked {
      color: #8b4513;
      background: #fff5eb;
      border-color: #f2c49e;
    }

    .threshold-line-help {
      margin-top: 7px;
      color: #64748b;
      font-size: 10px;
      line-height: 1.35;
    }
  `;

  document.head.appendChild(style);
}

function parseFeatureAndSplit(card: Element) {
  const sub = card.querySelector('.choice-card-sub')?.textContent ?? '';
  const featureMatch = sub.match(/feature\s+(\d+)/i);
  const splitMatch = sub.match(/split\s+#\s*(\d+)/i);

  if (!featureMatch || !splitMatch) return undefined;

  return {
    feature: Number(featureMatch[1]),
    splitId: Number(splitMatch[1]),
    card: card as HTMLElement,
  };
}

function restoreNativeControls() {
  document
    .querySelectorAll(`.${HIDDEN_CLASS}`)
    .forEach((element) => element.classList.remove(HIDDEN_CLASS));

  document
    .querySelectorAll(`.${ENHANCER_CLASS}`)
    .forEach((element) => element.remove());
}

function enhanceThresholdPanel() {
  const panel = document.querySelector('.panel-section.choice-panel');
  if (!panel) return;

  const sectionTitle = panel.querySelector('.section-title')?.textContent?.trim() ?? '';
  if (!sectionTitle.startsWith('Thresholds for ')) {
    restoreNativeControls();
    return;
  }

  const group = panel.querySelector('.choice-group');
  const grid = group?.querySelector('.choice-grid');
  if (!group || !grid) return;

  const countText = group.querySelector('.choice-group-count')?.textContent ?? '';
  const countMatch = countText.match(/(\d+)\s+choices/i);
  const totalChoices = countMatch ? Number(countMatch[1]) : 0;

  if (totalChoices < MIN_NUMBER_LINE_CHOICES) {
    restoreNativeControls();
    return;
  }

  const availableCards = Array.from(grid.querySelectorAll('.choice-card.split-choice'))
    .map(parseFeatureAndSplit)
    .filter((x): x is NonNullable<typeof x> => !!x);

  if (availableCards.length === 0) return;

  const entries = registry();
  const firstRegistryEntry = entries.find(
    (entry) => entry.internalFeature === availableCards[0].feature,
  );

  if (!firstRegistryEntry || firstRegistryEntry.continuousGroup === null) return;

  const candidates = entries
    .filter(
      (entry) =>
        entry.continuousGroup === firstRegistryEntry.continuousGroup &&
        entry.originalFeature === firstRegistryEntry.originalFeature,
    )
    .sort((a, b) => a.threshold - b.threshold || a.internalFeature - b.internalFeature);

  if (candidates.length < MIN_NUMBER_LINE_CHOICES) return;

  const availableByFeature = new Map(
    availableCards.map((entry) => [entry.feature, entry]),
  );

  const signature = `${sectionTitle}|${totalChoices}|${candidates
    .map((entry) => `${entry.internalFeature}:${entry.threshold}`)
    .join(',')}|${availableCards.map((entry) => entry.feature).join(',')}`;

  const existing = panel.querySelector<HTMLElement>(`.${ENHANCER_CLASS}`);
  if (existing?.dataset.signature === signature) return;

  existing?.remove();
  injectStyles();

  grid.classList.add(HIDDEN_CLASS);
  panel.querySelector('.search-box')?.classList.add(HIDDEN_CLASS);

  const wrapper = document.createElement('div');
  wrapper.className = ENHANCER_CLASS;
  wrapper.dataset.signature = signature;

  const legend = document.createElement('div');
  legend.className = 'threshold-line-legend';
  legend.innerHTML = `
    <span><i class="threshold-line-swatch feasible"></i>available now</span>
    <span><i class="threshold-line-swatch blocked"></i>not available within the current budget/continuation</span>
  `;
  wrapper.appendChild(legend);

  const track = document.createElement('button');
  track.type = 'button';
  track.className = 'threshold-line-track';
  track.title = 'Click anywhere to use the represented cut immediately below that value.';

  const axis = document.createElement('span');
  axis.className = 'threshold-line-axis';
  track.appendChild(axis);

  const minValue = candidates[0].threshold;
  const maxValue = candidates[candidates.length - 1].threshold;
  const span = Math.max(maxValue - minValue, Number.EPSILON);

  const pct = (value: number) => (100 * (value - minValue)) / span;

  for (let i = 0; i < candidates.length - 1; i += 1) {
    const current = candidates[i];
    const next = candidates[i + 1];
    const segment = document.createElement('span');
    segment.className = `threshold-line-segment ${
      availableByFeature.has(current.internalFeature) ? 'feasible' : 'blocked'
    }`;
    segment.style.left = `${pct(current.threshold)}%`;
    segment.style.width = `${Math.max(0, pct(next.threshold) - pct(current.threshold))}%`;
    axis.appendChild(segment);
  }

  for (const candidate of candidates) {
    const tick = document.createElement('span');
    const available = availableByFeature.has(candidate.internalFeature);
    tick.className = `threshold-line-tick ${available ? 'feasible' : 'blocked'}`;
    tick.style.left = `calc(7px + (100% - 14px) * ${pct(candidate.threshold) / 100})`;
    tick.title = `${candidate.originalName} ≤ ${candidate.threshold} · ${
      available ? 'available now' : 'not available now'
    }`;
    track.appendChild(tick);
  }

  const selectedMarker = document.createElement('span');
  selectedMarker.className = 'threshold-line-selected';
  selectedMarker.hidden = true;
  track.appendChild(selectedMarker);

  wrapper.appendChild(track);

  const labels = document.createElement('div');
  labels.className = 'threshold-line-labels';
  labels.innerHTML = `<span>${minValue}</span><span>${maxValue}</span>`;
  wrapper.appendChild(labels);

  const manual = document.createElement('div');
  manual.className = 'threshold-line-manual';

  const inputLabel = document.createElement('label');
  const labelText = document.createElement('span');
  labelText.textContent = 'Split value';
  const input = document.createElement('input');
  input.type = 'number';
  input.step = 'any';
  input.placeholder = String((minValue + maxValue) / 2);
  inputLabel.append(labelText, input);

  const useButton = document.createElement('button');
  useButton.type = 'button';
  useButton.className = 'threshold-line-use';
  useButton.textContent = 'Use split';
  useButton.disabled = true;

  manual.append(inputLabel, useButton);
  wrapper.appendChild(manual);

  const message = document.createElement('div');
  message.className = 'threshold-line-message';
  message.setAttribute('aria-live', 'polite');
  message.textContent = 'Click the number line or type a value.';
  wrapper.appendChild(message);

  const help = document.createElement('div');
  help.className = 'threshold-line-help';
  help.textContent =
    'Values between represented cutpoints snap to the cut immediately below them, which gives the same split over the represented training cutpoints.';
  wrapper.appendChild(help);

  grid.before(wrapper);

  let selected:
    | {
        candidate: RegistryEntry;
        card?: HTMLElement;
      }
    | undefined;

  function lowerCandidate(value: number) {
    let lo = 0;
    let hi = candidates.length - 1;
    let best = -1;

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (candidates[mid].threshold <= value) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    return best >= 0 ? candidates[best] : undefined;
  }

  function selectValue(value: number, applyImmediately: boolean) {
    if (!Number.isFinite(value)) {
      selected = undefined;
      selectedMarker.hidden = true;
      useButton.disabled = true;
      message.className = 'threshold-line-message';
      message.textContent = 'Enter a numeric threshold value.';
      return;
    }

    if (value < minValue || value > maxValue) {
      selected = undefined;
      selectedMarker.hidden = true;
      useButton.disabled = true;
      message.className = 'threshold-line-message';
      message.textContent = `Enter a value from ${minValue} to ${maxValue}.`;
      return;
    }

    const candidate = lowerCandidate(value);
    if (!candidate) return;

    const available = availableByFeature.get(candidate.internalFeature);
    selected = { candidate, card: available?.card };

    selectedMarker.hidden = false;
    selectedMarker.style.left = `calc(7px + (100% - 14px) * ${pct(candidate.threshold) / 100})`;

    const exact = Math.abs(value - candidate.threshold) <=
      Math.max(1, Math.abs(candidate.threshold)) * 1e-12;
    const snapText = exact
      ? `Cut ${candidate.threshold}`
      : `Snaps down to cut ${candidate.threshold}`;

    if (!available) {
      useButton.disabled = true;
      useButton.textContent = 'Not available';
      message.className = 'threshold-line-message blocked';
      message.textContent = `${snapText}, but that cut cannot be selected in the current budget/continuation.`;
      return;
    }

    useButton.disabled = false;
    useButton.textContent = 'Use split';
    message.className = 'threshold-line-message';
    message.textContent = `${snapText} · available now.`;

    if (applyImmediately) {
      available.card.click();
    }
  }

  track.addEventListener('click', (event) => {
    const rect = track.getBoundingClientRect();
    const x = Math.min(rect.right - 7, Math.max(rect.left + 7, event.clientX));
    const ratio = (x - (rect.left + 7)) / Math.max(1, rect.width - 14);
    const value = minValue + ratio * (maxValue - minValue);
    input.value = String(value);
    selectValue(value, true);
  });

  input.addEventListener('input', () => {
    if (input.value.trim() === '') {
      selected = undefined;
      selectedMarker.hidden = true;
      useButton.disabled = true;
      useButton.textContent = 'Use split';
      message.className = 'threshold-line-message';
      message.textContent = 'Click the number line or type a value.';
      return;
    }

    selectValue(Number(input.value), false);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && selected?.card) {
      selected.card.click();
    }
  });

  useButton.addEventListener('click', () => {
    selected?.card?.click();
  });
}

let scheduled = false;
function scheduleEnhance() {
  if (scheduled) return;
  scheduled = true;

  requestAnimationFrame(() => {
    scheduled = false;
    enhanceThresholdPanel();
  });
}

const observer = new MutationObserver(scheduleEnhance);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true,
});

window.addEventListener('load', scheduleEnhance);
scheduleEnhance();

export {};
