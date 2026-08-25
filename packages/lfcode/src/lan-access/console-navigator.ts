/**
 * The LAN console is a static page, so keep the navigator shell isolated from
 * the prompt and message styles in routes.ts. It mirrors the desktop sidebar:
 * a full-height project rail on wide screens and an overlay drawer on phones.
 */
export const lanConsoleNavigatorStyles = String.raw`
    :root {
      --motion-micro-ms: 160ms;
      --motion-ease-out: cubic-bezier(0.22, 1, 0.36, 1);
    }

    body:has(#app:not(.hidden)) {
      overflow: hidden;
    }

    body:has(#app:not(.hidden)) main {
      display: flex;
      height: 100vh;
      height: 100dvh;
      min-height: 0;
      max-width: none;
      flex-direction: column;
      margin: 0;
      padding: 0;
      overflow: hidden;
    }

    body:has(#app:not(.hidden)) .app-header {
      flex: none;
      padding: max(12px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 12px max(16px, env(safe-area-inset-left));
    }

    #app.workspace:not(.hidden) {
      flex: 1;
      min-height: 0;
      gap: 0;
      margin: 0;
      overflow: hidden;
    }

    #app.workspace .navigator-summary {
      display: none;
    }

    #app.workspace .navigator {
      min-height: 0;
      background: var(--background-base, var(--background));
    }

    #app.workspace.navigator-collapsed .navigator {
      display: none;
    }

    #app.workspace .navigator-body {
      display: flex;
      height: 100%;
      min-height: 0;
      flex-direction: column;
      padding: 12px;
      overflow: hidden;
    }

    #app.workspace .navigator-heading {
      flex: none;
      margin: 0 0 10px;
    }

    #app.workspace .project-groups {
      min-height: 0;
      flex: 1;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-width: thin;
    }

    #app.workspace .navigator-collapse,
    #app.workspace .navigator-toggle {
      transition:
        background-color var(--motion-micro-ms) var(--motion-ease-out),
        color var(--motion-micro-ms) var(--motion-ease-out);
    }

    @media (min-width: 681px) {
      #app.workspace:not(.hidden) {
        display: grid;
        grid-template-columns: minmax(244px, 300px) minmax(0, 1fr);
        align-items: stretch;
      }

      #app.workspace.navigator-collapsed {
        grid-template-columns: minmax(0, 1fr);
      }

      #app.workspace .navigator {
        position: relative;
        display: block;
        height: 100%;
        overflow: hidden;
        border: 0;
        border-right: 1px solid var(--border-weak-base, var(--border));
        border-radius: 0;
      }

      #app.workspace .conversation {
        grid-column: 2;
        height: 100%;
        min-height: 0;
        border: 0;
        border-radius: 0;
        background: var(--background-base, var(--background));
      }

      #app.workspace.navigator-collapsed .conversation {
        grid-column: 1 / -1;
      }
    }

    @media (max-width: 680px) {
      #app.workspace:not(.hidden) {
        position: relative;
        display: block;
      }

      #app.workspace .conversation {
        height: 100%;
        min-height: 0;
        border: 0;
        border-radius: 0;
        background: var(--background-base, var(--background));
      }

      #app.workspace .navigator {
        position: absolute;
        z-index: 3;
        top: 0;
        bottom: 0;
        left: 0;
        display: block;
        width: min(88vw, 360px);
        max-width: 100%;
        height: auto;
        margin: 0;
        overflow: hidden;
        border: 0;
        border-right: 1px solid var(--border-weak-base, var(--border));
        border-radius: 0;
        box-shadow: 12px 12px 30px rgb(0 0 0 / 28%);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      #app.workspace .navigator-collapse,
      #app.workspace .navigator-toggle {
        transition-duration: 0ms;
      }
    }

    /* The route deliberately supplies only semantic HTML. These presentation
       rules make the remote console feel like a focused workspace without
       adding a client framework or exposing another privileged surface. */
    #app.workspace:not(.hidden) {
      background:
        radial-gradient(circle at 16% -10%, rgb(130 168 144 / 12%), transparent 34%),
        var(--background-base, var(--background));
    }

    body:has(#app:not(.hidden)) .app-header {
      position: relative;
      z-index: 5;
      border-bottom-color: var(--border-weak-base, var(--border));
      background: color-mix(in srgb, var(--background-base, var(--background)) 86%, transparent);
      backdrop-filter: blur(14px);
    }

    body:has(#app:not(.hidden)) #status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 24px;
      border: 1px solid var(--border-weak-base, var(--border));
      border-radius: 999px;
      background: var(--surface-raised-base-hover, var(--surface-raised));
      padding: 3px 9px;
      color: var(--text-weak, var(--text-muted));
    }

    body:has(#app:not(.hidden)) #status::before {
      width: 7px;
      height: 7px;
      flex: none;
      border-radius: 999px;
      background: #85b785;
      box-shadow: 0 0 0 3px rgb(133 183 133 / 12%);
      content: '';
    }

    #app.workspace .navigator-heading {
      min-height: 36px;
      padding: 0 4px;
    }

    #app.workspace .navigator-heading h2 {
      color: var(--text-strong, #f1f1eb);
      font-size: 13px;
      font-weight: 650;
      letter-spacing: .01em;
    }

    #app.workspace .conversation-header {
      min-height: 44px;
      border-bottom: 1px solid var(--border-weak-base, var(--border));
      padding: 2px 2px 12px;
    }

    #app.workspace #project-title {
      color: var(--text-weak, var(--text-muted));
      font-size: 12px;
    }

    #app.workspace #session-title {
      color: var(--text-strong, #f1f1eb);
      font-size: 15px;
      font-weight: 650;
    }

    #app.workspace .conversation-actions button {
      min-height: 32px;
      border-color: var(--border-weak-base, var(--border));
      background: transparent;
      color: var(--text-weak, var(--text-muted));
      font-size: 12px;
    }

    #app.workspace .conversation-actions button:hover:not(:disabled) {
      background: var(--surface-raised-base-hover, var(--surface-raised));
      color: var(--text-strong, #f1f1eb);
    }

    #app.workspace .messages {
      gap: 20px;
      margin-top: 0;
      padding: 22px clamp(4px, 2vw, 24px) 20px;
      scroll-behavior: smooth;
    }

    #app.workspace .messages > p:only-child {
      align-self: center;
      max-width: 340px;
      margin: auto;
      border: 1px dashed var(--border-weak-base, var(--border));
      border-radius: 12px;
      padding: 16px;
      color: var(--text-weak, var(--text-muted));
      text-align: center;
    }

    #app.workspace .conversation-support {
      margin-top: 0;
      border-top: 1px solid var(--border-weak-base, var(--border));
      padding: 8px 2px 0;
    }

    #app.workspace .helper-row {
      min-height: 30px;
    }

    #app.workspace .helper-row button {
      border-color: transparent;
      background: transparent;
      color: var(--text-weak, var(--text-muted));
    }

    #app.workspace .conversation-support details {
      border: 1px solid var(--border-weak-base, var(--border));
      border-radius: 9px;
      background: var(--surface-raised-base-hover, var(--surface-raised));
      overflow: hidden;
    }

    #app.workspace .conversation-support details > summary {
      display: flex;
      min-height: 38px;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      list-style: none;
      padding: 0 10px;
      color: var(--text-strong, #f1f1eb);
      font-size: 12px;
      font-weight: 600;
    }

    #app.workspace .conversation-support details > summary::-webkit-details-marker { display: none; }
    #app.workspace .conversation-support details > summary::after { margin-left: auto; color: var(--text-weak, var(--text-muted)); content: '展开'; font-weight: 400; }
    #app.workspace .conversation-support details[open] > summary { border-bottom: 1px solid var(--border-weak-base, var(--border)); }
    #app.workspace .conversation-support details[open] > summary::after { content: '收起'; }

    #app.workspace .request-list {
      gap: 8px;
      padding: 8px;
    }

    #app.workspace .request-card {
      border-color: var(--border-weak-base, var(--border));
      border-radius: 8px;
      background: var(--background-base, var(--background));
      box-shadow: 0 1px 0 rgb(255 255 255 / 3%) inset;
    }

    #app.workspace .request-title { color: var(--text-strong, #f1f1eb); }
    #app.workspace .request-detail { color: var(--text-weak, var(--text-muted)); }
    #app.workspace .request-actions button { border-color: var(--border-weak-base, var(--border)); background: var(--surface-raised); color: var(--text-strong, #f1f1eb); }

    #app.workspace .composer-dock {
      position: relative;
      z-index: 1;
      margin: 10px clamp(2px, 1vw, 12px) max(2px, env(safe-area-inset-bottom));
      border-color: var(--border-weak-base, var(--border));
      border-radius: 14px;
      background: color-mix(in srgb, var(--surface) 92%, var(--background-base, var(--background)));
      box-shadow: 0 10px 28px rgb(0 0 0 / 12%);
    }

    #app.workspace .composer-dock:focus-within {
      border-color: color-mix(in srgb, var(--accent) 56%, var(--border-weak-base, var(--border)));
      box-shadow: 0 0 0 3px rgb(133 183 133 / 12%), 0 10px 28px rgb(0 0 0 / 12%);
    }

    #app.workspace .composer textarea { padding-top: 12px; }
    #app.workspace .composer-send { box-shadow: 0 1px 5px rgb(0 0 0 / 22%); }

    @media (hover: hover) and (pointer: fine) {
      #app.workspace .navigator { transition: width var(--motion-micro-ms) var(--motion-ease-out); }
      #app.workspace .helper-row button:hover { background: var(--surface-raised-base-hover, var(--surface-raised)); color: var(--text-strong, #f1f1eb); }
    }

    @media (max-width: 680px) {
      body:has(#app:not(.hidden)) .app-header { padding-bottom: 10px; }
      #app.workspace:has(.navigator[open])::before { position: absolute; z-index: 2; inset: 0; background: rgb(0 0 0 / 34%); content: ''; }
      #app.workspace .navigator { z-index: 4; width: min(86vw, 344px); box-shadow: 18px 0 42px rgb(0 0 0 / 32%); }
      #app.workspace .conversation-header { min-height: 52px; padding-bottom: 10px; }
      #app.workspace .conversation-actions { width: auto; margin-left: auto; }
      #app.workspace .conversation-actions button { min-height: 36px; }
      #app.workspace .messages { padding: 16px 2px 16px; }
      #app.workspace .conversation-support { max-height: min(30dvh, 230px); }
      #app.workspace .composer-dock { margin: 8px 0 max(2px, env(safe-area-inset-bottom)); border-right: 0; border-left: 0; border-radius: 12px 12px 0 0; }
      #app.workspace .composer textarea { min-height: 78px; }
      #app.workspace .request-actions button { flex: 1 1 120px; }
    }
`
