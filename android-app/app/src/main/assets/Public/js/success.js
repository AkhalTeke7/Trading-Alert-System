// ── State ──────────────────────────────────────────────
let initialized = false;
let toast, titleEl, messageEl, progressEl;
let autoHideTimer;

// ── CSS (injected once) ────────────────────────────────
const CSS = `
  .success-toast {
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

  .success-toast.show {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transform: translateX(0);
  }

  .success-toast__head {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .success-toast__icon {
    width: 38px;
    height: 38px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    background: #159d78;
    color: white;
    font-size: 17px;
  }

  .success-toast__info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .success-toast__label {
    font-family: "Space Grotesk", sans-serif;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: .1em;
  }

  .success-toast__code {
    font-family: "JetBrains Mono", monospace;
    font-size: 9px;
    color: #8b877b;
    letter-spacing: .06em;
  }

  .success-toast__close {
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

  .success-toast__close:hover {
    color: #e9e4d6;
    border-color: rgba(233, 228, 214, .25);
  }

  .success-toast__divider {
    height: 1px;
    background: rgba(233, 228, 214, .14);
    margin: 16px 0;
  }

  .success-toast__title {
    font-family: "Fraunces", Georgia, serif;
    font-size: 25px;
    font-weight: 400;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  .success-toast__message {
    margin-top: 8px;
    color: #a5a095;
    font-size: 12px;
    line-height: 1.9;
    overflow-wrap: anywhere;
  }

  .success-toast__footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin: 20px 0 14px;
    font-family: "JetBrains Mono", monospace;
    font-size: 9px;
    color: #8b877b;
  }

  .success-toast__status {
    color: #159d78;
    letter-spacing: .08em;
  }

  /* Green line countdown timer */
  .success-toast__progress {
    height: 2px;
    width: 100%;
    background: #159d78;
    transform-origin: left;
    transform: scaleX(0);
  }

  .success-toast.show .success-toast__progress {
    animation: success-toast-countdown var(--toast-duration, 4s) linear forwards;
  }

  @keyframes success-toast-countdown {
    from { transform: scaleX(1); }
    to   { transform: scaleX(0); }
  }

  @media (max-width: 480px) {
    .success-toast { top: 16px; right: 16px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .success-toast, .success-toast * {
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
  toast.className = "success-toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");

  toast.innerHTML = `
    <div class="success-toast__head">
      <div class="success-toast__icon" aria-hidden="true">✓</div>
      <div class="success-toast__info">
        <span class="success-toast__label">OPERATION SUCCESSFUL</span>
        <span class="success-toast__code">SYSTEM SUCCESS // 000</span>
      </div>
      <button type="button" class="success-toast__close" aria-label="Close success">&times;</button>
    </div>
    <div class="success-toast__divider"></div>
    <h3 class="success-toast__title"></h3>
    <p class="success-toast__message"></p>
    <div class="success-toast__footer">
      <span class="success-toast__status">● SUCCESS</span>
      <span>JUST NOW</span>
    </div>
    <div class="success-toast__progress"></div>
  `;

  document.body.appendChild(toast);

  titleEl    = toast.querySelector(".success-toast__title");
  messageEl  = toast.querySelector(".success-toast__message");
  progressEl = toast.querySelector(".success-toast__progress");

  toast.querySelector(".success-toast__close").addEventListener("click", hideSuccess);
}

// ── Public Exports ─────────────────────────────────────

export function hideSuccess() {
  clearTimeout(autoHideTimer);
  if (toast) toast.classList.remove("show");
}

export function showSuccess(
  message,
  title = "Operation completed successfully",
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
    autoHideTimer = setTimeout(hideSuccess, duration);
  }
}

export function destroySuccessToast() {
  hideSuccess();
  if (toast?.parentNode) toast.parentNode.removeChild(toast);
  initialized = false;
}

// Global window fallback
if (typeof window !== "undefined") {
  window.showSuccess = showSuccess;
  window.hideSuccess = hideSuccess;
}

export default showSuccess;
