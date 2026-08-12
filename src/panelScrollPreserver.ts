const PANEL_SELECTOR = '.panel';
const CHOICE_PANEL_SELECTOR = '.panel-section.choice-panel';
const ENTER_THRESHOLD_SELECTOR = '.feature-summary-card';
const EXIT_THRESHOLD_SELECTOR = '.back-button';

function restoreScrollPosition(
  panel: HTMLElement,
  choicePanel: HTMLElement,
  targetTop: number,
) {
  if (!panel.isConnected || !choicePanel.isConnected) return;

  // A compact threshold/range chooser can be much shorter than the feature
  // list it replaces. If the whole panel becomes too short, the browser has
  // no choice but to clamp scrollTop upward. Give only the choice section the
  // extra height required to keep the user's current viewport reachable.
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
  targetTop: number,
) {
  const restore = () => restoreScrollPosition(panel, choicePanel, targetTop);

  // React updates synchronously from the click, while Framer Motion may adjust
  // layout for another frame or two. Restore before the next paint and for a
  // few following frames so neither path can pull the panel back to the top.
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

    const targetTop = panel.scrollTop;

    if (entering) {
      // Start from the section's natural height; restoreScrollPosition will add
      // only as much height as is needed after the threshold chooser appears.
      choicePanel.style.minHeight = '';
    } else {
      // Returning to the feature list normally makes the section taller again,
      // so remove any height retained for the compact threshold chooser.
      choicePanel.style.minHeight = '';
    }

    preserveThroughMenuSwap(panel, choicePanel, targetTop);
  },
  true,
);
