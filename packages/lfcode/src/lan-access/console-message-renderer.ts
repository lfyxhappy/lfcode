/**
 * The LAN console cannot mount the desktop Solid message tree: that tree owns
 * privileged file, terminal, tool and desktop actions. Keep this renderer
 * dependency-free and DOM-only so its safe, projected DTO stays useful in a
 * normal browser as well.
 */
export const lanConsoleMessageStyles = String.raw`
    [data-lan-message-renderer="safe-markdown"] { gap: 20px; padding-top: 8px; padding-bottom: 18px; }
    .lan-turn { display: flex; width: 100%; min-width: 0; flex-direction: column; gap: 10px; }
    .lan-turn::before { color: var(--text-weak, var(--text-muted)); content: attr(data-lan-label); font-size: 11px; font-weight: 600; letter-spacing: .04em; line-height: 1; }
    .lan-turn-user { align-items: flex-end; }
    .lan-turn-assistant { align-items: stretch; }
    .lan-turn-user::before { align-self: flex-end; }
    .lan-user-message { max-width: min(82%, 64ch); border: 1px solid color-mix(in srgb, var(--accent) 32%, var(--border-weak-base, var(--border))); border-radius: 12px 4px 12px 12px; background: color-mix(in srgb, var(--accent-surface) 76%, var(--surface)); color: var(--text-strong, #f1f1eb); padding: 9px 12px; white-space: pre-wrap; overflow-wrap: anywhere; box-shadow: 0 1px 0 rgb(255 255 255 / 3%) inset; }
    .lan-assistant-text { width: 100%; min-width: 0; border-left: 2px solid color-mix(in srgb, var(--accent) 56%, transparent); color: var(--text-strong, #f1f1eb); padding-left: 12px; }
    .lan-assistant-text + .lan-assistant-text { margin-top: 4px; }
    .lan-assistant-actions { display: flex; min-height: 28px; align-items: center; justify-content: flex-end; margin-top: 6px; }
    .lan-message-meta { min-width: 0; flex: 1; overflow: hidden; color: var(--text-weak, var(--text-muted)); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
    .lan-message-copy { min-height: 28px; border: 0; border-radius: 5px; background: transparent; padding: 2px 7px; color: var(--text-weak, var(--text-muted)); font-size: 12px; }
    .lan-message-copy { margin-left: auto; flex: none; }
    .lan-message-copy:hover { background: var(--surface-raised); color: var(--text-strong, #f1f1eb); }
    .lan-markdown { min-width: 0; max-width: 100%; overflow-wrap: break-word; color: var(--text-strong, #f1f1eb); font-size: 14px; line-height: 1.6; }
    .lan-markdown > :first-child { margin-top: 0; }
    .lan-markdown > :last-child { margin-bottom: 0; }
    .lan-markdown h1, .lan-markdown h2, .lan-markdown h3, .lan-markdown h4, .lan-markdown h5, .lan-markdown h6 { margin: 0 0 18px; color: var(--text-strong, #f1f1eb); font-size: 14px; font-weight: 600; line-height: 1.5; }
    .lan-markdown p { margin: 0 0 12px; }
    .lan-markdown strong { color: var(--text-strong, #f1f1eb); font-weight: 600; }
    .lan-markdown em { color: var(--text-strong, #f1f1eb); }
    .lan-markdown del { color: var(--text-weak, var(--text-muted)); }
    .lan-markdown a { color: #9cc5ff; text-decoration: none; overflow-wrap: anywhere; }
    .lan-markdown a:hover { text-decoration: underline; text-underline-offset: 2px; }
    .lan-markdown ul, .lan-markdown ol { margin: 8px 0 12px; padding-left: 28px; }
    .lan-markdown li { margin: 0 0 7px; }
    .lan-markdown li::marker { color: var(--text-weak, var(--text-muted)); }
    .lan-markdown .lan-task-list { padding-left: 0; list-style: none; }
    .lan-markdown .lan-task-item { display: flex; align-items: flex-start; gap: 8px; }
    .lan-markdown .lan-task-item input { width: 15px; height: 15px; min-width: 15px; margin: 4px 0 0; accent-color: var(--accent); opacity: 1; }
    .lan-markdown .lan-task-item span { min-width: 0; }
    .lan-markdown blockquote { margin: 16px 0; border-left: 2px solid var(--border-weak-base, var(--border)); padding-left: 10px; color: var(--text-weak, var(--text-muted)); }
    .lan-markdown hr { height: 1px; margin: 24px 0; border: 0; background: var(--border-weak-base, var(--border)); }
    .lan-table-scroll { width: 100%; margin: 16px 0; overflow-x: auto; overscroll-behavior-inline: contain; }
    .lan-markdown table { width: 100%; min-width: max-content; border-collapse: collapse; font-size: 14px; }
    .lan-markdown th, .lan-markdown td { border-bottom: 1px solid var(--border-weak-base, var(--border)); padding: 8px 10px; vertical-align: top; }
    .lan-markdown th { color: var(--text-strong, #f1f1eb); font-weight: 600; text-align: left; }
    .lan-markdown td { color: var(--text-strong, #f1f1eb); }
    .lan-markdown :not(pre) > code { border-radius: 4px; background: var(--surface-raised); padding: 1px 4px; color: #b8d8ad; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: .92em; }
    .lan-code { position: relative; margin: 12px 0 20px; border: 1px solid var(--border-weak-base, var(--border)); border-radius: 6px; background: #141615; overflow: hidden; }
    .lan-code-header { display: flex; min-height: 32px; align-items: center; justify-content: space-between; gap: 8px; border-bottom: 1px solid var(--border-weak-base, var(--border)); padding: 4px 8px 4px 12px; color: var(--text-weak, var(--text-muted)); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; }
    .lan-code-copy { min-height: 28px; border: 1px solid var(--border-weak-base, var(--border)); border-radius: 5px; background: transparent; padding: 2px 8px; color: var(--text-weak, var(--text-muted)); font-size: 12px; }
    .lan-code-copy:hover { background: var(--surface-raised); color: var(--text-strong, #f1f1eb); }
    .lan-code pre { max-height: min(46dvh, 440px); margin: 0; overflow: auto; padding: 12px; color: #e4e7e2; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 13px; line-height: 1.55; white-space: pre; }
    .lan-reasoning { width: 100%; margin: 4px 0 0; border-left: 2px solid var(--border-weak-base, var(--border)); padding-left: 12px; color: var(--text-weak, var(--text-muted)); }
    .lan-reasoning-label { margin: 0 0 6px; color: var(--text-weak, var(--text-muted)); font-size: 12px; font-weight: 600; }
    .lan-reasoning .lan-markdown { color: var(--text-weak, var(--text-muted)); font-size: 13px; }
    .lan-reasoning .lan-markdown strong { color: var(--text-weak, var(--text-muted)); }
    .lan-tool-summary { display: inline-flex; min-height: 34px; max-width: 100%; align-items: center; gap: 8px; border: 1px solid var(--border-weak-base, var(--border)); border-radius: 8px; background: var(--surface-raised); padding: 5px 10px; color: var(--text-weak, var(--text-muted)); font-size: 12px; }
    .lan-tool-dot { width: 7px; height: 7px; flex: none; border-radius: 999px; background: #7d8990; }
    .lan-tool-summary[data-status="running"] .lan-tool-dot, .lan-tool-summary[data-status="pending"] .lan-tool-dot { background: #e5c07b; }
    .lan-tool-summary[data-status="completed"] .lan-tool-dot { background: #85b785; }
    .lan-tool-summary[data-status="error"] .lan-tool-dot { background: #d98080; }
    .lan-tool-label { min-width: 0; overflow: hidden; color: var(--text-strong, #f1f1eb); text-overflow: ellipsis; white-space: nowrap; }
    .lan-tool-status { flex: none; color: var(--text-weak, var(--text-muted)); }
    .lan-attachment { display: inline-flex; min-height: 34px; max-width: min(82%, 320px); align-items: center; gap: 7px; align-self: flex-end; border: 1px solid var(--border-weak-base, var(--border)); border-radius: 6px; background: var(--surface-raised); padding: 5px 9px; color: var(--text-weak, var(--text-muted)); font-size: 12px; }
    .lan-attachment-icon { flex: none; color: #9cc5ff; }
    .lan-attachment-name { min-width: 0; overflow: hidden; color: var(--text-strong, #f1f1eb); text-overflow: ellipsis; white-space: nowrap; }
    button.lan-attachment { border: 1px solid var(--border-weak-base, var(--border)); cursor: pointer; text-align: left; }
    button.lan-attachment:hover { border-color: var(--border-strong); background: var(--surface); }
    .lan-attachment-image { width: 56px; min-width: 56px; height: 56px; min-height: 56px; overflow: hidden; padding: 0; }
    .lan-attachment-image img { display: block; width: 100%; height: 100%; object-fit: cover; background: var(--surface-raised); }
    .lan-image-preview { position: fixed; z-index: 100; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, .72); padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); }
    .lan-image-preview-content { position: relative; display: flex; max-width: min(96vw, 1080px); max-height: 94dvh; flex-direction: column; gap: 8px; }
    .lan-image-preview img { display: block; max-width: 100%; max-height: calc(94dvh - 48px); border-radius: 8px; object-fit: contain; background: #111; }
    .lan-image-preview-close { align-self: flex-end; min-height: 32px; border-color: rgba(255, 255, 255, .2); background: rgba(0, 0, 0, .35); color: #fff; padding: 4px 10px; }
    .lan-divider { display: flex; width: 100%; align-items: center; gap: 10px; color: var(--text-weak, var(--text-muted)); font-size: 12px; }
    .lan-divider::before, .lan-divider::after { height: 1px; flex: 1; background: var(--border-weak-base, var(--border)); content: ''; }
    @media (hover: hover) and (pointer: fine) { .lan-message-copy { opacity: 0; transition: opacity 120ms ease-out; } .lan-turn:hover .lan-message-copy, .lan-message-copy:focus-visible { opacity: 1; } }
    @media (max-width: 680px) { .lan-user-message, .lan-attachment { max-width: 92%; } .lan-code pre { max-height: min(42dvh, 360px); } .lan-turn { gap: 8px; } .lan-assistant-text { padding-left: 10px; } }
`

export const lanConsoleMessageScript = String.raw`
      function lanMessageElement(tag, className) { const node = document.createElement(tag); if (className) node.className = className; return node; }
      function lanMessageText(value) { return typeof value === 'string' ? value : ''; }
      function lanMessageHref(value) { try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : ''; } catch { return ''; } }
      function lanMessagePreviewURL(sessionID, partID) { if (typeof sessionID !== 'string' || typeof partID !== 'string' || !sessionID || !partID) return ''; return '/lan/v1/sessions/' + encodeURIComponent(sessionID) + '/attachments/' + encodeURIComponent(partID); }
      function lanMessageShowImage(source, name) { const existing = document.getElementById('lan-image-preview'); if (existing) existing.remove(); const root = lanMessageElement('div', 'lan-image-preview'); root.id = 'lan-image-preview'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', name || '图片预览'); const content = lanMessageElement('div', 'lan-image-preview-content'); const close = lanMessageElement('button', 'lan-image-preview-close'); close.type = 'button'; close.textContent = '关闭'; close.addEventListener('click', () => root.remove()); const image = lanMessageElement('img'); image.src = source; image.alt = name || '图片附件'; content.append(close, image); root.append(content); root.addEventListener('click', (event) => { if (event.target === root) root.remove(); }); document.body.append(root); }
      function lanMessageAppendText(root, value) { const lines = lanMessageText(value).split('\n'); lines.forEach((line, index) => { if (index) root.append(document.createElement('br')); root.append(document.createTextNode(line)); }); }
      function lanMessageAppendInline(root, value) {
        const source = lanMessageText(value); const token = /(\x60[^\x60\n]+\x60|~~[^~\n]+~~|\*\*[^*\n]+\*\*|__[^_\n]+__|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s<>()]+|\*[^*\n]+\*|_[^_\n]+_)/g; let offset = 0; let match;
        while ((match = token.exec(source))) { if (match.index > offset) root.append(document.createTextNode(source.slice(offset, match.index))); const raw = match[0];
          if (raw.charCodeAt(0) === 96) { const code = lanMessageElement('code'); code.textContent = raw.slice(1, -1); root.append(code); }
          else if (raw.startsWith('~~')) { const deleted = lanMessageElement('del'); deleted.textContent = raw.slice(2, -2); root.append(deleted); }
          else if (raw.startsWith('**') || raw.startsWith('__')) { const strong = lanMessageElement('strong'); strong.textContent = raw.slice(2, -2); root.append(strong); }
          else if (raw.startsWith('*') || raw.startsWith('_')) { const emphasis = lanMessageElement('em'); emphasis.textContent = raw.slice(1, -1); root.append(emphasis); }
          else if (raw.startsWith('[')) { const linkMatch = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(raw); const href = linkMatch && lanMessageHref(linkMatch[2]); if (linkMatch && href) { const link = lanMessageElement('a'); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = linkMatch[1]; root.append(link); } else root.append(document.createTextNode(raw)); }
          else { const href = lanMessageHref(raw.replace(/[),.;!?]+$/, '')); if (href) { const link = lanMessageElement('a'); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = raw; root.append(link); } else root.append(document.createTextNode(raw)); }
          offset = match.index + raw.length;
        }
        if (offset < source.length) root.append(document.createTextNode(source.slice(offset)));
      }
      function lanMessageCode(code, language) {
        const root = lanMessageElement('div', 'lan-code'); const header = lanMessageElement('div', 'lan-code-header'); const label = lanMessageElement('span'); label.textContent = language || 'text'; const copy = lanMessageElement('button', 'lan-code-copy'); copy.type = 'button'; copy.textContent = '复制'; copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(code); copy.textContent = '已复制'; setTimeout(() => { copy.textContent = '复制'; }, 1800); } catch { copy.textContent = '无法复制'; setTimeout(() => { copy.textContent = '复制'; }, 1800); } }); const pre = lanMessageElement('pre'); const content = lanMessageElement('code'); content.textContent = code; pre.append(content); header.append(label, copy); root.append(header, pre); return root;
      }
      function lanMessageTableCells(value) { const source = lanMessageText(value).trim(); if (!source.includes('|')) return []; const body = source.startsWith('|') ? source.slice(1) : source; const text = body.endsWith('|') ? body.slice(0, -1) : body; const cells = []; let current = ''; for (let index = 0; index < text.length; index++) { const character = text[index]; if (character === '\\' && text[index + 1] === '|') { current += '|'; index++; continue; } if (character === '|') { cells.push(current.trim()); current = ''; continue; } current += character; } cells.push(current.trim()); return cells; }
      function lanMessageTableInfo(lines, index) { const header = lanMessageTableCells(lines[index] || ''); const divider = lanMessageTableCells(lines[index + 1] || ''); if (!header.length || header.length !== divider.length || divider.some((cell) => !/^:?-{3,}:?$/.test(cell))) return; return { header, divider }; }
      function lanMessageTableAlign(value) { const cell = lanMessageText(value); if (cell.startsWith(':') && cell.endsWith(':')) return 'center'; if (cell.endsWith(':')) return 'right'; if (cell.startsWith(':')) return 'left'; return ''; }
      function lanMessageTableCell(tag, value, alignment) { const cell = lanMessageElement(tag); if (alignment) cell.style.textAlign = alignment; lanMessageAppendInline(cell, value); return cell; }
      function lanMessageTable(lines, index, info) { const wrapper = lanMessageElement('div', 'lan-table-scroll'); const table = lanMessageElement('table'); const head = lanMessageElement('thead'); const headerRow = lanMessageElement('tr'); info.header.forEach((cell, column) => headerRow.append(lanMessageTableCell('th', cell, lanMessageTableAlign(info.divider[column])))); head.append(headerRow); const body = lanMessageElement('tbody'); let cursor = index + 2; while (cursor < lines.length) { const cells = lanMessageTableCells(lines[cursor] || ''); if (!cells.length) break; const row = lanMessageElement('tr'); info.header.forEach((_, column) => row.append(lanMessageTableCell('td', cells[column] || '', lanMessageTableAlign(info.divider[column])))); body.append(row); cursor++; } table.append(head, body); wrapper.append(table); return { node: wrapper, cursor }; }
      function lanMessageMarkdown(root, value) {
        const lines = lanMessageText(value).replace(/\r\n?/g, '\n').split('\n'); let cursor = 0;
        const boundary = (line) => /^\s*$|^\x60\x60\x60|^#{1,6}\s+|^>\s?|^[-*+]\s+|^\d+\.\s+|^(?:---+|\*\*\*+|___+)\s*$/.test(line);
        while (cursor < lines.length) { const line = lines[cursor] || ''; if (!line.trim()) { cursor++; continue; }
          const table = lanMessageTableInfo(lines, cursor); if (table) { const rendered = lanMessageTable(lines, cursor, table); root.append(rendered.node); cursor = rendered.cursor; continue; }
          const fence = /^\x60\x60\x60\s*([^\s]*)/.exec(line); if (fence) { const values = []; cursor++; while (cursor < lines.length && !/^\x60\x60\x60/.test(lines[cursor] || '')) { values.push(lines[cursor] || ''); cursor++; } if (cursor < lines.length) cursor++; root.append(lanMessageCode(values.join('\n'), fence[1] || 'text')); continue; }
          const heading = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line); if (heading) { const node = lanMessageElement('h' + Math.min(6, heading[1].length)); lanMessageAppendInline(node, heading[2]); root.append(node); cursor++; continue; }
          if (/^(?:---+|\*\*\*+|___+)\s*$/.test(line)) { root.append(lanMessageElement('hr')); cursor++; continue; }
          if (/^>\s?/.test(line)) { const values = []; while (cursor < lines.length && /^>\s?/.test(lines[cursor] || '')) { values.push((lines[cursor] || '').replace(/^>\s?/, '')); cursor++; } const quote = lanMessageElement('blockquote'); lanMessageMarkdown(quote, values.join('\n')); root.append(quote); continue; }
          const unordered = /^[-*+]\s+(.+)$/.exec(line); const ordered = /^\d+\.\s+(.+)$/.exec(line); if (unordered || ordered) { const list = lanMessageElement(unordered ? 'ul' : 'ol'); const expression = unordered ? /^[-*+]\s+(.+)$/ : /^\d+\.\s+(.+)$/; while (cursor < lines.length) { const next = expression.exec(lines[cursor] || ''); if (!next) break; const item = lanMessageElement('li'); const task = unordered && /^\[([ xX])\]\s+([\s\S]+)$/.exec(next[1]); if (task) { list.classList.add('lan-task-list'); item.classList.add('lan-task-item'); const checkbox = lanMessageElement('input'); checkbox.type = 'checkbox'; checkbox.checked = task[1].toLowerCase() === 'x'; checkbox.disabled = true; checkbox.tabIndex = -1; checkbox.setAttribute('aria-label', checkbox.checked ? '已完成' : '未完成'); const text = lanMessageElement('span'); lanMessageAppendInline(text, task[2]); item.append(checkbox, text); } else lanMessageAppendInline(item, next[1]); list.append(item); cursor++; } root.append(list); continue; }
          const values = []; while (cursor < lines.length && !boundary(lines[cursor] || '') && !lanMessageTableInfo(lines, cursor)) { values.push(lines[cursor] || ''); cursor++; } const paragraph = lanMessageElement('p'); values.forEach((entry, index) => { if (index) paragraph.append(document.createElement('br')); lanMessageAppendInline(paragraph, entry); }); root.append(paragraph);
        }
      }
      function lanMessageStatus(value) { if (value === 'pending') return '等待中'; if (value === 'running') return '进行中'; if (value === 'completed') return '已完成'; if (value === 'error') return '失败'; return '已更新'; }
      function lanMessageDuration(value) { if (typeof value !== 'number' || !(value >= 0)) return ''; const total = Math.round(value / 1000); if (total < 60) return total + ' 秒'; return Math.floor(total / 60) + ' 分 ' + total % 60 + ' 秒'; }
      function lanMessageAssistantMeta(message, turnDuration) { const info = message && message.info && typeof message.info === 'object' ? message.info : {}; const agent = lanMessageText(info.agent); const title = agent ? agent.charAt(0).toUpperCase() + agent.slice(1) : ''; return [title, lanMessageText(info.model), lanMessageDuration(turnDuration)].filter(Boolean).join(' · '); }
      function lanMessageCopyButton(text) { const copy = lanMessageElement('button', 'lan-message-copy'); copy.type = 'button'; copy.textContent = '复制回复'; copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(text); copy.textContent = '已复制'; setTimeout(() => { copy.textContent = '复制回复'; }, 1800); } catch { copy.textContent = '无法复制'; setTimeout(() => { copy.textContent = '复制回复'; }, 1800); } }); return copy; }
      function lanMessagePart(part, role, sessionID, showAssistantCopy, assistantMeta) {
        if (!part || typeof part !== 'object') return; const type = part.type;
        if (type === 'text') { const node = lanMessageElement('div', role === 'user' ? 'lan-user-message lan-markdown' : 'lan-assistant-text'); const markdown = lanMessageElement('div', role === 'user' ? '' : 'lan-markdown'); lanMessageMarkdown(markdown, part.text); node.append(markdown); if (role === 'assistant' && showAssistantCopy) { const actions = lanMessageElement('div', 'lan-assistant-actions'); if (assistantMeta) { const meta = lanMessageElement('span', 'lan-message-meta'); meta.textContent = assistantMeta; actions.append(meta); } actions.append(lanMessageCopyButton(lanMessageText(part.text))); node.append(actions); } return node; }
        if (type === 'reasoning') { const node = lanMessageElement('div', 'lan-reasoning'); const label = lanMessageElement('p', 'lan-reasoning-label'); label.textContent = '思考'; const markdown = lanMessageElement('div', 'lan-markdown'); lanMessageMarkdown(markdown, part.text); node.append(label, markdown); return node; }
        if (type === 'tool-summary') { const node = lanMessageElement('div', 'lan-tool-summary'); const status = typeof part.status === 'string' ? part.status : ''; node.dataset.status = status; const dot = lanMessageElement('span', 'lan-tool-dot'); const label = lanMessageElement('span', 'lan-tool-label'); label.textContent = lanMessageText(part.label) || '工具调用'; const state = lanMessageElement('span', 'lan-tool-status'); state.textContent = lanMessageStatus(status); node.append(dot, label, state); return node; }
        if (type === 'attachment') { const name = lanMessageText(part.name) || '附件'; const source = part.preview === true && /^image\//.test(lanMessageText(part.mime)) ? lanMessagePreviewURL(sessionID, lanMessageText(part.id)) : ''; if (source) { const node = lanMessageElement('button', 'lan-attachment lan-attachment-image'); node.type = 'button'; node.dataset.preview = 'true'; node.setAttribute('aria-label', '预览图片附件 ' + name); const image = lanMessageElement('img'); image.src = source; image.alt = name; image.loading = 'lazy'; image.addEventListener('error', () => { node.className = 'lan-attachment'; node.replaceChildren(); const icon = lanMessageElement('span', 'lan-attachment-icon'); icon.textContent = '⌁'; const label = lanMessageElement('span', 'lan-attachment-name'); label.textContent = name; node.append(icon, label); }); node.append(image); node.addEventListener('click', () => lanMessageShowImage(source, name)); return node; } const node = lanMessageElement('div', 'lan-attachment'); const icon = lanMessageElement('span', 'lan-attachment-icon'); icon.textContent = '⌁'; const label = lanMessageElement('span', 'lan-attachment-name'); label.textContent = name; node.append(icon, label); return node; }
        if (type === 'divider') { const node = lanMessageElement('div', 'lan-divider'); node.textContent = part.kind === 'compaction' ? '上下文已整理' : '步骤完成'; return node; }
      }
      function lanMessageRole(message) { return message && message.info && message.info.role === 'assistant' ? 'assistant' : 'user'; }
      function lanMessageKey(message, index) { const id = message && message.info && typeof message.info.id === 'string' && message.info.id ? message.info.id : ''; return id || 'message-' + index; }
      function lanMessagePartKey(part, index) { return part && typeof part.id === 'string' && part.id ? part.id : 'part-' + index; }
      function lanMessagePartFingerprint(part, showAssistantCopy, assistantMeta) { if (!part || typeof part !== 'object') return ''; const type = lanMessageText(part.type); if (type === 'text' || type === 'reasoning') return type + '\u0000' + lanMessageText(part.text) + '\u0000' + String(showAssistantCopy) + '\u0000' + (showAssistantCopy ? assistantMeta : ''); if (type === 'tool-summary') return type + '\u0000' + lanMessageText(part.label) + '\u0000' + lanMessageText(part.status); if (type === 'attachment') return type + '\u0000' + lanMessageText(part.name) + '\u0000' + lanMessageText(part.mime) + '\u0000' + String(part.preview === true); if (type === 'divider') return type + '\u0000' + lanMessageText(part.kind); return type; }
      function lanMessageReconcileChildren(root, nodes) { nodes.forEach((node, index) => { const current = root.children.item(index); if (current !== node) root.insertBefore(node, current || null); }); while (root.children.length > nodes.length) root.lastElementChild.remove(); }
      function lanMessageUpdateTurn(turn, message, turnDuration) {
        const role = lanMessageRole(message); const sessionID = message && message.info && typeof message.info.sessionID === 'string' ? message.info.sessionID : ''; const parts = Array.isArray(message && message.parts) ? message.parts : []; const lastTextID = role === 'assistant' ? [...parts].reverse().find((part) => part && part.type === 'text' && lanMessageText(part.text).trim())?.id : ''; const assistantMeta = role === 'assistant' ? lanMessageAssistantMeta(message, turnDuration) : ''; const existing = new Map(Array.from(turn.children).map((node) => [node.dataset.lanPartID, node])); const nodes = parts.flatMap((part, index) => { const key = lanMessagePartKey(part, index); const showAssistantCopy = role === 'assistant' && part && part.id === lastTextID; const fingerprint = lanMessagePartFingerprint(part, showAssistantCopy, assistantMeta); const prior = existing.get(key); if (prior && prior.dataset.lanPartFingerprint === fingerprint) return [prior]; const node = lanMessagePart(part, role, sessionID, showAssistantCopy, assistantMeta); if (!node) return []; node.dataset.lanPartID = key; node.dataset.lanPartFingerprint = fingerprint; return [node]; }); turn.className = 'lan-turn lan-turn-' + role; turn.dataset.role = role; turn.dataset.lanLabel = role === 'assistant' ? 'Lfcode' : '你'; turn.setAttribute('aria-label', role === 'assistant' ? 'Lfcode 的回复' : '你的消息'); lanMessageReconcileChildren(turn, nodes); return turn.childElementCount ? turn : undefined;
      }
      function lanMessageInfo(message) { return message && message.info && typeof message.info === 'object' ? message.info : {}; }
      function lanMessageTurnDurations(messages) { const starts = new Map(); const ends = new Map(); messages.forEach((message) => { const info = lanMessageInfo(message); if (info.role !== 'user' || typeof info.id !== 'string' || !info.time || typeof info.time.created !== 'number') return; starts.set(info.id, info.time.created); }); messages.forEach((message) => { const info = lanMessageInfo(message); if (info.role !== 'assistant' || typeof info.parentID !== 'string' || !info.time || typeof info.time.completed !== 'number') return; const prior = ends.get(info.parentID); if (typeof prior !== 'number' || info.time.completed > prior) ends.set(info.parentID, info.time.completed); }); return new Map(messages.flatMap((message) => { const info = lanMessageInfo(message); const start = starts.get(info.parentID); const end = ends.get(info.parentID); if (info.role !== 'assistant' || typeof info.id !== 'string' || typeof start !== 'number' || typeof end !== 'number' || end < start) return []; return [[info.id, end - start]]; })); }
      function lanMessageTurn(message, turnDuration) { return lanMessageUpdateTurn(lanMessageElement('article'), message, turnDuration); }
      function renderLanMessages(root, messages) { const values = Array.isArray(messages) ? messages : []; const durations = lanMessageTurnDurations(values); const existing = new Map(Array.from(root.children).map((node) => [node.dataset.lanMessageID, node])); const turns = values.flatMap((message, index) => { const key = lanMessageKey(message, index); const turn = lanMessageUpdateTurn(existing.get(key) || lanMessageElement('article'), message, durations.get(key)); if (!turn) return []; turn.dataset.lanMessageID = key; return [turn]; }); lanMessageReconcileChildren(root, turns); root.dataset.lanMessageCount = String(turns.length); }
`
