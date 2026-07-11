/**
 * Element picker content script for "watch this section" mode.
 */

(() => {
  let picking = false;
  let overlay = null;
  let highlightBox = null;
  let instructionBar = null;

  browserAPI.runtime.onMessage.addListener((message) => {
    if (message.type === 'START_PICKER') {
      startPicker();
    }
  });

  function startPicker() {
    if (picking) return;
    picking = true;
    createOverlay();
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  }

  function stopPicker() {
    picking = false;
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    overlay?.remove();
    overlay = null;
    highlightBox = null;
    instructionBar = null;
  }

  function createOverlay() {
    overlay = document.createElement('div');
    overlay.id = 'alert-me-picker-overlay';
    overlay.innerHTML = `
      <div id="alert-me-highlight"></div>
      <div id="alert-me-instructions">
        Click an element to watch it · Esc to cancel
      </div>
    `;
    document.body.appendChild(overlay);
    highlightBox = overlay.querySelector('#alert-me-highlight');
    instructionBar = overlay.querySelector('#alert-me-instructions');
  }

  function onMouseMove(e) {
    if (!picking) return;
    overlay.style.pointerEvents = 'none';
    const el = document.elementFromPoint(e.clientX, e.clientY);
    overlay.style.pointerEvents = 'auto';

    if (!el || el.closest('#alert-me-picker-overlay')) return;

    const rect = el.getBoundingClientRect();
    highlightBox.style.top = `${rect.top + window.scrollY}px`;
    highlightBox.style.left = `${rect.left + window.scrollX}px`;
    highlightBox.style.width = `${rect.width}px`;
    highlightBox.style.height = `${rect.height}px`;
    highlightBox.style.display = 'block';
  }

  function onClick(e) {
    if (!picking) return;
    e.preventDefault();
    e.stopPropagation();

    overlay.style.pointerEvents = 'none';
    const el = document.elementFromPoint(e.clientX, e.clientY);
    overlay.style.pointerEvents = 'auto';

    if (!el || el.closest('#alert-me-picker-overlay')) return;

    const selector = generateSelector(el);
    stopPicker();

    browserAPI.runtime.sendMessage({
      type: 'WATCH_PAGE',
      payload: {
        url: window.location.href,
        title: document.title,
        favicon: getFavicon(),
        selector,
      },
    });
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      stopPicker();
    }
  }

  function generateSelector(el) {
    if (el.id) {
      return `#${CSS.escape(el.id)}`;
    }

    const classes = Array.from(el.classList).filter((c) => !c.match(/^(active|hover|focus|selected)/i));
    if (classes.length > 0) {
      const classSelector = `.${classes.map((c) => CSS.escape(c)).join('.')}`;
      const matches = document.querySelectorAll(classSelector);
      if (matches.length === 1) return classSelector;
    }

    const path = [];
    let current = el;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector = `#${CSS.escape(current.id)}`;
        path.unshift(selector);
        break;
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }
      path.unshift(selector);
      current = parent;
    }

    return path.join(' > ');
  }

  function getFavicon() {
    const link = document.querySelector('link[rel*="icon"]');
    return link?.href || '';
  }
})();
