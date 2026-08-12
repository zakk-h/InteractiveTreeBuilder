const STYLE_ID = 'arborenum-history-style';
const WRAP_ID = 'arborenum-history-wrap';

type HistoryEntry = {
  label: string;
};

let entries: HistoryEntry[] = [];
let jumping = false;
let open = false;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${WRAP_ID} {
      position: relative;
      display: inline-flex;
    }

    .builder-history-button {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    .builder-history-count {
      min-width: 17px;
      height: 17px;
      padding: 0 5px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #edf4fb;
      color: #315f8f;
      font-size: 9px;
      font-weight: 900;
      line-height: 1;
    }

    .builder-history-popover {
      position: absolute;
      z-index: 1000;
      top: calc(100% + 7px);
      left: 0;
      width: 255px;
      max-height: 310px;
      overflow-y: auto;
      padding: 7px;
      border: 1px solid #dbe4ee;
      border-radius: 12px;
      background: #ffffff;
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.16);
    }

    .builder-history-title {
      padding: 4px 5px 7px;
      color: #64748b;
      font-size: 10px;
      font-weight: 850;
    }

    .builder-history-item {
      width: 100%;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      padding: 8px 9px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: #334155;
      text-align: left;
      cursor: pointer;
    }

    .builder-history-item:hover {
      background: #f4f8fc;
    }

    .builder-history-item.current {
      background: #edf6ff;
      color: #244f7d;
      cursor: default;
    }

    .builder-history-item-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 10px;
      font-weight: 800;
    }

    .builder-history-item-step {
      color: #94a3b8;
      font-size: 9px;
      font-weight: 800;
      white-space: nowrap;
    }

    .builder-history-empty {
      padding: 9px;
      color: #94a3b8;
      font-size: 10px;
      line-height: 1.35;
    }
  `;
  document.head.appendChild(style);
}

function undoButton(): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.toolbar-row .ghost-button')).find(
    (button) => button.textContent?.trim().toLowerCase().startsWith('undo'),
  );
}

function historyWrap(): HTMLElement | undefined {
  return document.getElementById(WRAP_ID) ?? undefined;
}

function compactLabel(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/\s*obj\s+.*$/i, '')
    .trim()
    .slice(0, 90) || 'Decision';
}

function actionFromClick(target: Element): string | undefined {
  const choice = target.closest('.choice-card');
  if (choice && !choice.classList.contains('choice-card-disabled')) {
    return compactLabel(choice.textContent ?? 'Choice');
  }

  const node = target.closest('.react-flow__node-praxis');
  if (
    node &&
    (node.querySelector('.praxis-node-split') || node.querySelector('.praxis-node-leaf'))
  ) {
    return `Rewind ${compactLabel(node.textContent ?? 'tree node')}`;
  }

  const toolbar = target.closest<HTMLButtonElement>('.toolbar-row .ghost-button');
  if (toolbar) {
    const text = toolbar.textContent?.trim().toLowerCase() ?? '';
    if (text.startsWith('undo')) return undefined;
    if (text.startsWith('reset')) return 'Reset tree';
    if (text.startsWith('random') && !toolbar.disabled) return 'Random completion';
    if (text.startsWith('optimal') && !toolbar.disabled) return 'Optimal completion';
  }

  return undefined;
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function jumpToDepth(depth: number) {
  if (jumping) return;
  const steps = entries.length - depth;
  if (steps <= 0) return;

  jumping = true;
  open = false;
  render();

  for (let i = 0; i < steps; i += 1) {
    const undo = undoButton();
    if (!undo || undo.disabled) break;
    undo.click();
    await waitForPaint();
  }

  entries = entries.slice(0, depth);
  jumping = false;
  render();
}

function render() {
  injectStyles();

  const toolbar = document.querySelector('.toolbar-row');
  if (!toolbar) return;

  let wrap = historyWrap();
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = WRAP_ID;
    const undo = undoButton();
    if (undo?.parentElement === toolbar) {
      undo.insertAdjacentElement('afterend', wrap);
    } else {
      toolbar.prepend(wrap);
    }
  }

  wrap.replaceChildren();

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'ghost-button builder-history-button';
  trigger.innerHTML = `History <span class="builder-history-count">${entries.length}</span>`;
  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    open = !open;
    render();
  });
  wrap.appendChild(trigger);

  if (!open) return;

  const popover = document.createElement('div');
  popover.className = 'builder-history-popover';
  popover.addEventListener('click', (event) => event.stopPropagation());

  const title = document.createElement('div');
  title.className = 'builder-history-title';
  title.textContent = 'Jump back to an earlier tree';
  popover.appendChild(title);

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'builder-history-empty';
    empty.textContent = 'No committed decisions yet.';
    popover.appendChild(empty);
  } else {
    const current = document.createElement('button');
    current.type = 'button';
    current.className = 'builder-history-item current';
    current.innerHTML = '<span class="builder-history-item-label">Current tree</span><span class="builder-history-item-step">now</span>';
    popover.appendChild(current);

    for (let depth = entries.length - 1; depth >= 0; depth -= 1) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'builder-history-item';
      const label = depth === 0 ? 'Initial tree' : `Before: ${entries[depth].label}`;
      const back = entries.length - depth;
      item.innerHTML = `<span class="builder-history-item-label"></span><span class="builder-history-item-step">${back} back</span>`;
      const labelEl = item.querySelector('.builder-history-item-label');
      if (labelEl) labelEl.textContent = label;
      item.addEventListener('click', () => void jumpToDepth(depth));
      popover.appendChild(item);
    }
  }

  wrap.appendChild(popover);
}

document.addEventListener(
  'click',
  (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (!target.closest(`#${WRAP_ID}`)) {
      open = false;
    }

    const undo = target.closest<HTMLButtonElement>('.toolbar-row .ghost-button');
    if (undo && undo.textContent?.trim().toLowerCase().startsWith('undo')) {
      if (!jumping && !undo.disabled && entries.length > 0) {
        entries = entries.slice(0, -1);
        requestAnimationFrame(render);
      }
      return;
    }

    if (jumping) return;

    const action = actionFromClick(target);
    if (action) {
      entries.push({ label: action });
      requestAnimationFrame(render);
    }
  },
  true,
);

const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
fileInput?.addEventListener('change', () => {
  entries = [];
  open = false;
  requestAnimationFrame(render);
});

const observer = new MutationObserver(() => render());
observer.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && open) {
    open = false;
    render();
  }
});

render();
