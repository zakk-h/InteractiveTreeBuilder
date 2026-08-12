const PANEL_SELECTOR = '.panel';
const CHOICE_PANEL_SELECTOR = '.panel-section.choice-panel';
const ENTER_THRESHOLD_SELECTOR = '.feature-summary-card';
const EXIT_THRESHOLD_SELECTOR = '.back-button';
const ANCHOR_GAP = 8;

function choicePanelTop(panel: HTMLElement, choicePanel: HTMLElement): number {
  const panelRect = panel.getBoundingClientRect();
  const choiceRect = choicePanel.getBoundingClientRect();

  // Convert the section's current viewport position back into the panel's
  // scroll coordinate system. This remains correct even if the browser briefly
  // clamps scrollTop while React swaps a tall feature list for a short chooser.
  return Math.max(
    0,
    panel.scrollTop + choiceRect.top - panelRect.top - ANCHOR_GAP,
  );
}

function restoreScrollPosition(
  panel: HTMLElement,
  choicePanel: HTMLElement,
  requestedTop: number,
  keepChoicePanelTopVisible: boolean,
) {
  if (!panel.isConnected || !choicePanel.isConnected) return;

  // Preserve the user's position unless doing so would put the selected
  // feature's threshold section above the viewport. In that case, move upward
  // only as far as the top of that section (e.g. "Thresholds for Whole_weight").
  const targetTop = keepChoicePanelTopVisible
    ? Math.min(requestedTop, choicePanelTop(panel, choicePanel))
    : requestedTop;

  // A compact threshold/range chooser can be much shorter than the feature
  // list it replaces. If the whole panel becomes too short, the browser has
  // no choice but to clamp scrollTop upward. Give only the choice section the
  // extra height required to keep the desired viewport reachable.
  const requiredScrollHeight = targetTop + panel.clientHeight;
  const deficit = requiredScrollHeight - panel.scrollHeight;

  if (deficit > 0) {
    const currentHeight = choicePanel.getBoundingClientRect().height;
    choicePanel.style.minHeight = `${Math.ceil(currentHeight + deficit + 2)}px`;
  }

  panel.scrollTop = targetTop;
}

function preserveThroughMenuSwap(
  panel: HTMLElement,
  choicePanel: HTMLElement,
  requestedTop: number,
  keepChoicePanelTopVisible: boolean,
) {
  const restore = () =>
    restoreScrollPosition(
      panel,
      choicePanel,
      requestedTop,
      keepChoicePanelTopVisible,
    );

  // React updates synchronously from the click, while Framer Motion may adjust
  // layout for another frame or two. Restore before the next paint and for a
  // few following frames so neither path can pull the panel somewhere else.
  queueMicrotask(restore);

  let frames = 0;
  const restoreFrame = () => {
    restore();
    frames += 1;
    if (frames < 4) requestAnimationFrame(restoreFrame);
  };
  requestAnimationFrame(restoreFrame);

  window.setTimeout(restore, 120);
  window.setTimeout(restore, 300);
}

document.addEventListener(
  'click',
  (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const entering = target.closest(ENTER_THRESHOLD_SELECTOR);
    const exiting = target.closest(EXIT_THRESHOLD_SELECTOR);
    if (!entering && !exiting) return;

    const panel = target.closest(PANEL_SELECTOR);
    const choicePanel = target.closest(CHOICE_PANEL_SELECTOR);
    if (!(panel instanceof HTMLElement) || !(choicePanel instanceof HTMLElement)) {
      return;
    }

    const requestedTop = panel.scrollTop;

    // Start from the section's natural height; restoreScrollPosition will add
    // only as much height as is needed after the menu changes.
    choicePanel.style.minHeight = '';

    preserveThroughMenuSwap(
      panel,
      choicePanel,
      requestedTop,
      Boolean(entering),
    );
  },
  true,
);
