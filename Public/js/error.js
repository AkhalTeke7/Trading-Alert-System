// ── State ──────────────────────────────────────────────
let initialized = false;
let toast, titleEl, messageEl, progressEl;
let autoHideTimer;

// ── CSS (injected once) ────────────────────────────────
const CSS = `
  .error-toast {
    position: fixed;
    z-index: 99999;
    top: 24px;
    right: 24px;
    width: min(380px, calc(100vw - 32px));
    padding: 18px 18px 0;
    background: #101010;
    color: #e9e4d6;
    border: 1px solid rgba(233, 228, 214, .25);
    box-shadow: 0 18px 55px rgba(0, 0, 0, .5);
    font-family: Inter, sans-serif;

    opacity: 0;
    visibility: hidden;
    pointer-events: none;

    /* Slide in from the right */
    transform: translateX(calc(100% + 24px));

    transition:
      opacity .35s ease,
      transform .45s cubic-bezier(.22, 1, .36, 1),
      visibility .35s ease;
  }

  .error-toast.show {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transform: translateX(0);
  }

  .error-toast__head {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .error-toast__icon {
    width: 38px;
    height: 38px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    background: #d13b2f;
    color: white;
    font-size: 17px;
  }

  .error-toast__info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .error-toast__label {
    font-family: "Space Grotesk", sans-serif;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: .1em;
  }

  .error-toast__code {
    font-family: "JetBrains Mono", monospace;
    font-size: 9px;
    color: #8b877b;
    letter-spacing: .06em;
  }

  .error-toast__close {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    background: transparent;
    border: 1px solid transparent;
    color: #8b877b;
    cursor: pointer;
    font-size: 20px;
  }

  .error-toast__close:hover {
    color: #e9e4d6;
    border-color: rgba(233, 228, 214, .25);
  }

  .error-toast__divider {
    height: 1px;
    background: rgba(233, 228, 214, .14);
    margin: 16px 0;
  }

  .error-toast__title {
    font-family: "Fraunces", Georgia, serif;
    font-size: 25px;
    font-weight: 400;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  .error-toast__message {
    margin-top: 8px;
    color: #a5a095;
    font-size: 12px;
    line-height: 1.9;
    overflow-wrap: anywhere;
  }

  .error-toast__footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin: 20px 0 14px;
    font-family: "JetBrains Mono", monospace;
    font-size: 9px;
    color: #8b877b;
  }

  .error-toast__status {
    color: #d13b2f;
    letter-spacing: .08em;
  }

  /* Red line countdown timer */
  .error-toast__progress {
    height: 2px;
    width: 100%;
    background: #d13b2f;
    transform-origin: left;
    transform: scaleX(0);
  }

  .error-toast.show .error-toast__progress {
    animation: error-toast-countdown var(--toast-duration, 4s) linear forwards;
  }

  @keyframes error-toast-countdown {
    from { transform: scaleX(1); }
    to   { transform: scaleX(0); }
  }

  @media (max-width: 480px) {
    .error-toast { top: 16px; right: 16px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .error-toast, .error-toast * {
      transition: none !important;
      animation: none !important;
    }
  }
`;

// ── Lazy Initializer ───────────────────────────────────
function init() {
  if (initialized) return;
  initialized = true;

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  toast = document.createElement("div");
  toast.className = "error-toast";
  toast.setAttribute("role", "alert");
  toast.setAttribute("aria-live", "assertive");

  toast.innerHTML = `
    <div class="error-toast__head">
      <div class="error-toast__icon" aria-hidden="true">!</div>
      <div class="error-toast__info">
        <span class="error-toast__label">OPERATION FAILED</span>
        <span class="error-toast__code">SYSTEM ERROR // 001</span>
      </div>
      <button type="button" class="error-toast__close" aria-label="Close error">&times;</button>
    </div>
    <div class="error-toast__divider"></div>
    <h3 class="error-toast__title"></h3>
    <p class="error-toast__message"></p>
    <div class="error-toast__footer">
      <span class="error-toast__status">● ERROR</span>
      <span>JUST NOW</span>
    </div>
    <div class="error-toast__progress"></div>
  `;

  document.body.appendChild(toast);

  titleEl    = toast.querySelector(".error-toast__title");
  messageEl  = toast.querySelector(".error-toast__message");
  progressEl = toast.querySelector(".error-toast__progress");

  toast.querySelector(".error-toast__close").addEventListener("click", hideError);
}

// ── Public Exports ─────────────────────────────────────

export function hideError() {
  clearTimeout(autoHideTimer);
  if (toast) toast.classList.remove("show");
}

export function showError(
  message,
  title = "An unexpected error occurred",
  duration = 4000
) {
  init();
  clearTimeout(autoHideTimer);

  titleEl.textContent   = title;
  messageEl.textContent = String(message);

  // Set duration variable for CSS progress bar
  toast.style.setProperty("--toast-duration", `${duration}ms`);

  // Reset and retrigger animation
  progressEl.style.animation = "none";
  void progressEl.offsetWidth;
  progressEl.style.animation = "";

  toast.classList.add("show");

  if (duration > 0) {
    autoHideTimer = setTimeout(hideError, duration);
  }
}

export function destroyErrorToast() {
  hideError();
  if (toast?.parentNode) toast.parentNode.removeChild(toast);
  initialized = false;
}

// Global window fallback
if (typeof window !== "undefined") {
  window.showError = showError;
  window.hideError = hideError;
}

export default showError;