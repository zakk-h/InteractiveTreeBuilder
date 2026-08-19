type BuilderPayloadLike = {
  meta?: Record<string, unknown>;
};

type TreeCounts = {
  split: number;
  leaf: number;
  choice: number;
};

const internalWindow = window as Window & Record<string, unknown>;

let baselineTreeCounts: TreeCounts | null = null;
let lastPayloadLabel = '';
let scheduledFrame: number | null = null;

function setText(element: Element | null | undefined, text: string) {
  if (element && element.textContent !== text) {
    element.textContent = text;
  }
}

function sameTreeCounts(a: TreeCounts, b: TreeCounts): boolean {
  return a.split === b.split && a.leaf === b.leaf && a.choice === b.choice;
}

function currentTreeCounts(): TreeCounts | null {
  const split = document.querySelectorAll('.arborenum-node-split').length;
  const leaf = document.querySelectorAll('.arborenum-node-leaf').length;
  const choice = document.querySelectorAll('.arborenum-node-choice').length;

  if (split + leaf + choice === 0) return null;

  return { split, leaf, choice };
}

function featureCountFromCurrentPayload(): number | null {
  const payload = internalWindow.ARBORENUM_CURRENT_BUILDER_PAYLOAD as
    | BuilderPayloadLike
    | undefined;
  const meta = payload?.meta;

  if (!meta) return null;

  const featureNames = Array.isArray(meta.featureNames)
    ? meta.featureNames
    : [];
  const continuousGroups = meta.continuousGroups;

  const groups: unknown[][] = Array.isArray(continuousGroups)
    ? continuousGroups.filter(Array.isArray)
    : continuousGroups && typeof continuousGroups === 'object'
      ? Object.values(continuousGroups).filter(Array.isArray)
      : [];

  if (featureNames.length > 0) {
    const groupedFeatureIds = new Set<number>();

    for (const group of groups) {
      for (const feature of group) {
        const id = Number(feature);
        if (Number.isInteger(id) && id >= 0 && id < featureNames.length) {
          groupedFeatureIds.add(id);
        }
      }
    }

    const binaryFeatureCount = featureNames.length - groupedFeatureIds.size;
    return groups.length + binaryFeatureCount;
  }

  const registry = meta.featureRegistry;
  if (Array.isArray(registry)) {
    const originalFeatures = new Set<number>();

    for (const rawEntry of registry) {
      if (!rawEntry || typeof rawEntry !== 'object') continue;
      const originalFeature = Number(
        (rawEntry as Record<string, unknown>).originalFeature,
      );
      if (Number.isInteger(originalFeature) && originalFeature >= 0) {
        originalFeatures.add(originalFeature);
      }
    }

    if (originalFeatures.size > 0) {
      return originalFeatures.size;
    }
  }

  return null;
}

function hideRemainingChoicesSection(panel: Element) {
  for (const section of panel.querySelectorAll<HTMLElement>('.panel-section')) {
    const title = section.querySelector('.section-title')?.textContent?.trim();
    if (title === 'Remaining Choices') {
      section.hidden = true;
    }
  }
}

function simplifyTopMetrics(panel: Element, hasPartialTree: boolean) {
  const metrics = Array.from(panel.querySelectorAll<HTMLElement>('.metric-grid .metric'));
  if (metrics.length < 4) return;

  const [optimalMetric, boundMetric, samplesMetric, featuresMetric] = metrics;

  setText(
    optimalMetric.querySelector('span'),
    hasPartialTree ? 'Optimal Completion of Partial Tree' : 'Optimal Tree',
  );
  setText(boundMetric.querySelector('span'), 'Rashomon Bound');

  const trainingSamples = featuresMetric.querySelector('b')?.textContent?.trim();
  if (trainingSamples) {
    setText(samplesMetric.querySelector('b'), trainingSamples);
  }
  setText(samplesMetric.querySelector('span'), 'Training Samples');

  const featureCount = featureCountFromCurrentPayload();
  if (featureCount !== null) {
    setText(featuresMetric.querySelector('b'), featureCount.toLocaleString());
  }
  setText(featuresMetric.querySelector('span'), 'Number of Features');
}

function simplifySlackCard(panel: Element) {
  const slackCard = panel.querySelector('.rashomon-slack-card');
  if (!slackCard) return;

  setText(
    slackCard.querySelector('.rashomon-slack-head span'),
    'Rashomon Slack Remaining',
  );
}

function simplifyChoiceBudget(panel: Element) {
  const choicePanel = panel.querySelector('.choice-panel');
  if (!choicePanel) return;

  const budget = choicePanel.querySelector('.budget-box');
  if (!budget) return;

  const items = Array.from(budget.children) as HTMLElement[];
  if (items.length < 2) return;

  setText(items[0].querySelector('span'), 'Available Here');
  setText(items[1].querySelector('span'), 'Best Here');

  for (let i = 2; i < items.length; i += 1) {
    items[i].hidden = true;
  }
}

function applyPanelSimplifications() {
  const panel = document.querySelector('.panel');
  if (!panel) return;

  const payloadLabel = document.querySelector('.payload-name')?.textContent?.trim() ?? '';
  if (payloadLabel !== lastPayloadLabel) {
    lastPayloadLabel = payloadLabel;
    baselineTreeCounts = null;
  }

  const counts = currentTreeCounts();
  if (counts && baselineTreeCounts === null) {
    baselineTreeCounts = counts;
  }

  const hasPartialTree = Boolean(
    counts && baselineTreeCounts && !sameTreeCounts(counts, baselineTreeCounts),
  );

  hideRemainingChoicesSection(panel);
  simplifyTopMetrics(panel, hasPartialTree);
  simplifySlackCard(panel);
  simplifyChoiceBudget(panel);
}

function scheduleApply() {
  if (scheduledFrame !== null) return;

  scheduledFrame = window.requestAnimationFrame(() => {
    scheduledFrame = null;
    applyPanelSimplifications();
  });
}

const observer = new MutationObserver(scheduleApply);
observer.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true,
});

scheduleApply();
