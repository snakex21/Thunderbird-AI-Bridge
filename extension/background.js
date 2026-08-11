"use strict";

const BRIDGE_URL = "http://127.0.0.1:47831";
const BRIDGE_TOKEN = "supercli-thunderbird-local-v1-7b2e44c91a";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function plainFolder(folder) {
  if (!folder) return null;
  const capabilities = folder.capabilities || {};
  return {
    id: folder.id ?? null,
    accountId: folder.accountId ?? null,
    name: folder.name ?? "",
    path: folder.path ?? "",
    specialUse: Array.isArray(folder.specialUse) ? folder.specialUse : [],
    capabilities: {
      canAddMessages: typeof capabilities.canAddMessages === "boolean" ? capabilities.canAddMessages : null,
      canAddSubfolders: typeof capabilities.canAddSubfolders === "boolean" ? capabilities.canAddSubfolders : null,
      canBeDeleted: typeof capabilities.canBeDeleted === "boolean" ? capabilities.canBeDeleted : null,
      canBeRenamed: typeof capabilities.canBeRenamed === "boolean" ? capabilities.canBeRenamed : null,
      canDeleteMessages: typeof capabilities.canDeleteMessages === "boolean" ? capabilities.canDeleteMessages : null,
    },
  };
}

function plainMessage(message) {
  return {
    id: message.id,
    author: message.author || "",
    recipients: Array.isArray(message.recipients) ? message.recipients : [],
    ccList: Array.isArray(message.ccList) ? message.ccList : [],
    bccList: Array.isArray(message.bccList) ? message.bccList : [],
    subject: message.subject || "",
    date: message.date instanceof Date ? message.date.toISOString() : String(message.date || ""),
    read: Boolean(message.read),
    flagged: Boolean(message.flagged),
    folder: plainFolder(message.folder),
  };
}

function plainAttachment(attachment) {
  const name = attachment.name || "";
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
  return {
    name,
    filename: name,
    extension,
    contentType: attachment.contentType || "",
    size: Number(attachment.size) || 0,
    partName: attachment.partName || "",
    contentDisposition: attachment.contentDisposition || "",
    contentId: attachment.contentId || "",
  };
}

async function selectAttachment(messageId, args = {}) {
  const attachments = await messenger.messages.listAttachments(messageId);
  if (!attachments || attachments.length === 0) {
    throw new Error("Ta wiadomość nie ma załączników.");
  }
  const partName = String(args.part_name ?? args.partName ?? "").trim();
  if (partName) {
    const found = attachments.find((attachment) => String(attachment.partName || "") === partName);
    if (!found) throw new Error(`Nie znaleziono załącznika o partName: ${partName}`);
    return found;
  }
  const wantedName = String(args.attachment_name ?? args.attachmentName ?? "").trim().toLowerCase();
  if (wantedName) {
    const matches = attachments.filter((attachment) => String(attachment.name || "").trim().toLowerCase() === wantedName);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error(`Wiadomość ma kilka załączników o nazwie ${args.attachment_name || args.attachmentName}; użyj part_name.`);
    throw new Error(`Nie znaleziono załącznika: ${args.attachment_name || args.attachmentName}`);
  }
  if (attachments.length === 1) return attachments[0];
  throw new Error("Wiadomość ma kilka załączników; podaj part_name lub attachment_name z operacji attachments/search.");
}

async function plainMessageWithAttachments(message) {
  const base = plainMessage(message);
  try {
    const attachments = await messenger.messages.listAttachments(message.id);
    const listed = (attachments || []).map(plainAttachment);
    return {
      ...base,
      hasAttachments: listed.length > 0,
      attachmentCount: listed.length,
      attachments: listed,
    };
  } catch (error) {
    return {
      ...base,
      hasAttachments: false,
      attachmentCount: 0,
      attachments: [],
      attachmentError: String(error?.message || error || "Nie udało się odczytać metadanych załączników."),
    };
  }
}

function messagePartContentType(part) {
  return String(part?.contentType || "").split(";", 1)[0].trim().toLowerCase();
}

function messagePartText(part) {
  if (typeof part?.content === "string") return part.content;
  if (typeof part?.body === "string") return part.body;
  return "";
}

function collectInlineTextParts(part, output = []) {
  if (!part) return output;
  const contentType = messagePartContentType(part);
  const disposition = (part.headers?.["content-disposition"] || [])
    .map(value => String(value).toLowerCase())
    .join(";");
  if (contentType.startsWith("text/") && messagePartText(part) && !disposition.startsWith("attachment")) {
    output.push(part);
  }
  for (const child of part.parts || []) collectInlineTextParts(child, output);
  return output;
}

function basicHTMLToText(html) {
  const entities = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return String(html || "")
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
    .replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(parseInt(value, 16)))
    .replace(/&(nbsp|amp|lt|gt|quot|apos);/gi, (_, name) => entities[name.toLowerCase()]);
}

async function inlinePartToText(part) {
  const body = messagePartText(part);
  if (messagePartContentType(part) !== "text/html") return body;
  if (messenger.messengerUtilities?.convertToPlainText) {
    try {
      return await messenger.messengerUtilities.convertToPlainText(body);
    } catch (_) {}
  }
  return basicHTMLToText(body);
}

function normalizeMessageBody(body) {
  return String(body || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

async function readMessageBody(messageId) {
  let parts = [];
  let source = "listInlineTextParts";
  if (messenger.messages.listInlineTextParts) {
    parts = await messenger.messages.listInlineTextParts(messageId);
  }
  if (!parts || parts.length === 0) {
    source = "getFull";
    const full = await messenger.messages.getFull(messageId, {
      decodeContent: true,
      decodeHeaders: true,
      decrypt: true,
    });
    parts = collectInlineTextParts(full);
  }

  const usable = (parts || []).filter(part => messagePartText(part).length > 0);
  const plain = usable.filter(part => messagePartContentType(part) === "text/plain");
  const html = usable.filter(part => messagePartContentType(part) === "text/html");
  const selected = plain.length > 0 ? plain : (html.length > 0 ? html : usable);
  const body = normalizeMessageBody((await Promise.all(selected.map(inlinePartToText))).join("\n\n"));
  return {
    body,
    source,
    format: plain.length > 0 ? "plain" : (html.length > 0 ? "html-converted" : "text"),
    contentTypes: [...new Set(selected.map(messagePartContentType).filter(Boolean))],
  };
}

async function allMessagePages(first, max = Infinity) {
  const messages = [];
  let page = first;
  while (page) {
    for (const message of page.messages || []) {
      messages.push(message);
      if (messages.length >= max) {
        if (page.id) {
          try { await messenger.messages.abortList(page.id); } catch (_) {}
        }
        return messages;
      }
    }
    if (!page.id) break;
    page = await messenger.messages.continueList(page.id);
  }
  return messages;
}

async function resolveAccount(args = {}) {
  const accounts = await messenger.accounts.list();
  if (!accounts.length) throw new Error("Thunderbird nie ma skonfigurowanego konta pocztowego.");
  const wanted = String(args.account || args.accountId || "").trim().toLowerCase();
  if (wanted) {
    const found = accounts.find((account) =>
      String(account.id || "").toLowerCase() === wanted ||
      String(account.name || "").toLowerCase().includes(wanted)
    );
    if (!found) throw new Error(`Nie znaleziono konta: ${args.account || args.accountId}`);
    return found;
  }
  return accounts.find((account) => String(account.type || "").toLowerCase() === "imap") || accounts[0];
}

async function resolveFolder(account, raw) {
  const wanted = String(raw || "").trim();
  if (!wanted) return null;
  const folders = await messenger.folders.query({ accountId: account.id });
  const needle = wanted.toLowerCase().replace(/\\/g, "/");
  const exact = folders.find((folder) => {
    const id = String(folder.id || "").toLowerCase();
    const name = String(folder.name || "").toLowerCase();
    const path = String(folder.path || "").toLowerCase().replace(/\\/g, "/");
    return id === needle || name === needle || path === needle || path.endsWith(`/${needle}`);
  });
  if (exact) return exact;
  throw new Error(`Nie znaleziono folderu Thunderbird: ${wanted}`);
}

async function buildMessageQuery(args = {}) {
  const account = await resolveAccount(args);
  const query = { accountId: account.id, autoPaginationTimeout: 250 };
  const scope = String(args.scope || "inbox").trim().toLowerCase();
  let folder = await resolveFolder(account, args.folder);
  if (!folder && scope !== "account") {
    folder = await resolveSpecialFolder(account, "inbox", ["inbox", "odebrane"]);
  }
  if (folder) {
    query.folderId = folder.id;
    query.includeSubFolders = Boolean(args.includeSubFolders);
  }
  const from = String(args.from || args.author || "").trim();
  const to = String(args.to || args.recipient || "").trim();
  const subject = String(args.subject || "").trim();
  const fullText = String(args.fullText || args.text || "").trim();
  if (from) query.author = from;
  if (to) query.recipients = to;
  if (subject) query.subject = subject;
  if (fullText) query.fullText = fullText;
  if (args.since) query.fromDate = new Date(`${args.since}T00:00:00`);
  if (args.until) query.toDate = new Date(`${args.until}T23:59:59`);
  return { account, query, folder, scope };
}

async function searchMessages(args = {}, max = Infinity) {
  const address = String(args.address || "").trim();
  if (!address) {
    const built = await buildMessageQuery(args);
    const first = await messenger.messages.query(built.query);
    return { ...built, messages: await allMessagePages(first, max) };
  }

  // Thunderbird exposes sender and To-recipient as separate query fields.
  // Run both and merge so a user can simply say "find mail for this address"
  // without knowing whether the address was on the From or To side.
  const senderArgs = { ...args, address: "", from: address, to: "" };
  const recipientArgs = { ...args, address: "", from: "", to: address };
  const senderBuilt = await buildMessageQuery(senderArgs);
  const recipientBuilt = await buildMessageQuery(recipientArgs);
  const [senderFirst, recipientFirst] = await Promise.all([
    messenger.messages.query(senderBuilt.query),
    messenger.messages.query(recipientBuilt.query),
  ]);
  const [senderMessages, recipientMessages] = await Promise.all([
    allMessagePages(senderFirst, max),
    allMessagePages(recipientFirst, max),
  ]);
  const byId = new Map();
  for (const message of [...senderMessages, ...recipientMessages]) byId.set(message.id, message);
  const messages = [...byId.values()]
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .slice(0, Number.isFinite(max) ? max : undefined);
  return { ...senderBuilt, messages };
}

function hasMutationFilter(args = {}) {
  return Boolean(
    String(args.from || args.author || "").trim() ||
    String(args.subject || "").trim() ||
    String(args.fullText || args.text || "").trim() ||
    String(args.since || "").trim() ||
    String(args.until || "").trim()
  );
}

async function resolveSpecialFolder(account, specialUse, fallbackNames = []) {
  const folders = await messenger.folders.query({ accountId: account.id });
  const bySpecial = folders.find((folder) =>
    Array.isArray(folder.specialUse) && folder.specialUse.some((value) => String(value).toLowerCase() === specialUse)
  );
  if (bySpecial) return bySpecial;
  const wanted = new Set(fallbackNames.map((name) => String(name).toLowerCase()));
  return folders.find((folder) => {
    const name = String(folder.name || "").toLowerCase();
    const path = String(folder.path || "").toLowerCase();
    return wanted.has(name) || [...wanted].some((needle) => path.endsWith(`/${needle}`));
  }) || null;
}

function mutationBatchSize(args = {}) {
  return Math.max(1, Math.min(Number(args.batch_size ?? args.batchSize) || 250, 500));
}

function nextContinuationToken(op) {
  return `${op}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const bulkContinuations = new Map();

function cleanupBulkContinuations() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [token, state] of bulkContinuations) {
    if ((state.updatedAt || 0) < cutoff) bulkContinuations.delete(token);
  }
}

function mutationFingerprint(op, account, source, args = {}) {
  return JSON.stringify({
    op,
    accountId: account.id,
    folderId: source.id,
    from: String(args.from || args.author || "").trim().toLowerCase(),
    subject: String(args.subject || "").trim().toLowerCase(),
    text: String(args.fullText || args.text || "").trim().toLowerCase(),
    since: String(args.since || "").trim(),
    until: String(args.until || "").trim(),
    destination: String(args.destination || "").trim().toLowerCase(),
    all: args.all === true,
  });
}

function takeBulkState(op, args, account, source) {
  cleanupBulkContinuations();
  const fingerprint = mutationFingerprint(op, account, source, args);
  const token = String(args.continuation || "").trim();
  if (!token) return { fingerprint, processed: 0, updatedAt: Date.now() };
  const state = bulkContinuations.get(token);
  bulkContinuations.delete(token);
  if (!state) throw new Error("Token continuation wygasł albo nie istnieje. Zacznij zatwierdzoną operację od nowa.");
  if (state.fingerprint !== fingerprint) throw new Error("Token continuation nie pasuje do operacji lub filtrów. Przerwano dla bezpieczeństwa.");
  state.updatedAt = Date.now();
  return state;
}

function saveBulkState(op, state) {
  const token = nextContinuationToken(op);
  state.updatedAt = Date.now();
  bulkContinuations.set(token, state);
  return token;
}

async function mutationMessages(args = {}, defaultFolder = "inbox", allowWholeFolder = false) {
  if (!args.confirm) throw new Error("Ta operacja wymaga confirm:true po wyraźnej zgodzie użytkownika.");
  if (!hasMutationFilter(args) && !(allowWholeFolder && args.all === true)) {
    throw new Error("Ta operacja wymaga filtra: from/subject/text/since/until.");
  }
  const account = await resolveAccount(args);
  let source = await resolveFolder(account, args.folder);
  if (!source && defaultFolder === "inbox") {
    source = await resolveSpecialFolder(account, "inbox", ["inbox", "odebrane"]);
  }
  if (!source && defaultFolder === "trash") {
    source = await resolveSpecialFolder(account, "trash", ["trash", "kosz"]);
  }
  if (!source) throw new Error(`Nie znaleziono folderu źródłowego (${defaultFolder}).`);
  const batchSize = mutationBatchSize(args);
  const scoped = { ...args, account: account.id, folder: source.id };
  const built = await buildMessageQuery(scoped);
  const first = await messenger.messages.query(built.query);
  const candidates = await allMessagePages(first, batchSize + 1);
  const more = candidates.length > batchSize;
  const messages = more ? candidates.slice(0, batchSize) : candidates;
  return { account, source, scoped, messages, batchSize, more };
}

async function inChunks(items, size, fn) {
  for (let i = 0; i < items.length; i += size) {
    await fn(items.slice(i, i + size));
  }
}

async function executeRequest(request) {
  const op = String(request.op || "").toLowerCase();
  const args = request.args || {};

  if (op === "status") {
    const accounts = await messenger.accounts.list();
    return {
      connected: true,
      extensionVersion: messenger.runtime.getManifest().version,
      nativeExpungeAvailable: Boolean(messenger.mailbridge && messenger.mailbridge.compactAndRefresh),
      nativeEmptyTrashAvailable: Boolean(messenger.mailbridge && messenger.mailbridge.emptyTrashAndRefresh),
      attachmentMetadataAvailable: Boolean(messenger.messages && messenger.messages.listAttachments),
      attachmentContentAvailable: Boolean(messenger.messages && messenger.messages.getAttachmentFile),
      messageBodyAvailable: Boolean(messenger.messages && (messenger.messages.listInlineTextParts || messenger.messages.getFull)),
      accounts: accounts.map((account) => ({ id: account.id, name: account.name, type: account.type })),
    };
  }

  if (op === "accounts") {
    const accounts = await messenger.accounts.list();
    return accounts.map((account) => ({ id: account.id, name: account.name, type: account.type }));
  }

  if (op === "folders") {
    const account = await resolveAccount(args);
    const folders = await messenger.folders.query({ accountId: account.id });
    return {
      account: { id: account.id, name: account.name, type: account.type },
      folders: folders.map(plainFolder),
    };
  }

  if (op === "compact_folder") {
    if (!args.confirm) {
      throw new Error("compact_folder requires confirm:true after explicit user approval.");
    }
    const account = await resolveAccount(args);
    const folder = await resolveFolder(account, args.folder);
    if (!folder || folder.path === "/") {
      throw new Error("compact_folder requires a specific folder other than the account root.");
    }
    if (!messenger.mailbridge?.compactAndRefresh) {
      throw new Error("Native compaction is unavailable. Update the bridge and restart Thunderbird.");
    }
    const measurement = await messenger.mailbridge.compactAndRefresh(folder.accountId, folder.path);
    return {
      account: { id: account.id, name: account.name, type: account.type },
      folder: plainFolder(folder),
      compacted: true,
      beforeBytes: Number(measurement?.beforeBytes) || 0,
      afterBytes: Number(measurement?.afterBytes) || 0,
      reclaimedBytes: Number(measurement?.reclaimedBytes) || 0,
      beforeExpungedBytes: Number(measurement?.beforeExpungedBytes) || 0,
      afterExpungedBytes: Number(measurement?.afterExpungedBytes) || 0,
      skipped: measurement?.skipped === true,
      messagesChanged: false,
    };
  }

  if (op === "create_folder") {
    if (!args.confirm) throw new Error("create_folder wymaga confirm:true po wyraźnej zgodzie użytkownika.");
    const account = await resolveAccount(args);
    const name = String(args.name || "").trim();
    if (!name) throw new Error("create_folder wymaga nazwy w polu name.");
    if (/[\\/]/.test(name) || name === "." || name === "..") throw new Error("Nazwa folderu nie może zawierać / ani \\.");
    const parent = String(args.parent || "").trim() ? await resolveFolder(account, args.parent) : null;
    if (parent?.capabilities?.canAddSubfolders === false) throw new Error("Wybrany folder nie pozwala tworzyć podfolderów.");
    // Prefer stable folder ids on modern Thunderbird. Full MailFolder and
    // MailAccount arguments are deprecated since TB 121. The official create
    // API is reliable on Gmail; unlike rename/delete it completes correctly.
    const destination = parent
      ? (parent.id || parent)
      : (account.rootFolder?.id || account.rootFolder || account);
    const created = await messenger.folders.create(destination, name);
    // Thunderbird resolves folders.create() before a new IMAP mailbox is
    // always ready for a following RENAME. Give the local/server tree one
    // cheap settling window so chained CRUD calls do not race Gmail.
    await sleep(2000);
    const settledFolders = await messenger.folders.query({ accountId: account.id });
    const settledCreated = settledFolders.find(item => item.id === created.id || item.path === created.path) || created;
    return {
      account: { id: account.id, name: account.name, type: account.type },
      parent: parent ? plainFolder(parent) : null,
      created: plainFolder(settledCreated),
      changed: true,
    };
  }

  if (op === "rename_folder") {
    if (!args.confirm) throw new Error("rename_folder wymaga confirm:true po wyraźnej zgodzie użytkownika.");
    const account = await resolveAccount(args);
    const folder = await resolveFolder(account, args.folder);
    const newName = String(args.new_name || args.newName || "").trim();
    if (!folder) throw new Error("Nie znaleziono folderu do zmiany nazwy.");
    if (!newName) throw new Error("rename_folder wymaga new_name.");
    if (/[\\/]/.test(newName) || newName === "." || newName === "..") throw new Error("Nowa nazwa folderu nie może zawierać / ani \\.");
    if ((folder.specialUse || []).length > 0 || folder.path === "/") throw new Error("Folder systemowy/root nie może być przemianowany przez bridge.");
    if (folder.capabilities?.canBeRenamed === false) throw new Error("Thunderbird oznacza ten folder jako nieprzemianowywalny.");
    let renamed;
    if (String(account.type || "").toLowerCase() === "imap") {
      if (!messenger.mailbridge || !messenger.mailbridge.renameFolderAndRefresh) {
        throw new Error("Natywna zmiana nazwy folderu IMAP jest niedostępna. Zaktualizuj bridge i uruchom ponownie Thunderbirda.");
      }
      const oldPath = String(folder.path || "");
      const slash = oldPath.lastIndexOf("/");
      const expectedPath = `${slash >= 0 ? oldPath.slice(0, slash + 1) : "/"}${newName}`;
      const nativeError = await messenger.mailbridge.renameFolderAndRefresh(folder.accountId, folder.path, newName);
      if (nativeError) throw new Error(nativeError);
      const folders = await messenger.folders.query({ accountId: account.id });
      renamed = folders.find(item => item.path === expectedPath) ||
        folders.find(item => item.name === newName && item.path?.endsWith(`/${newName}`));
      if (!renamed) throw new Error(`Thunderbird nie potwierdził zmiany nazwy folderu na ${newName}.`);
    } else {
      renamed = await messenger.folders.rename(folder.id || folder, newName);
    }
    return { account: { id: account.id, name: account.name, type: account.type }, original: plainFolder(folder), renamed: plainFolder(renamed), changed: true };
  }

  if (op === "delete_folder") {
    if (!args.confirm) throw new Error("delete_folder wymaga confirm:true po wyraźnej zgodzie użytkownika.");
    const account = await resolveAccount(args);
    const folder = await resolveFolder(account, args.folder);
    if (!folder) throw new Error("Nie znaleziono folderu do usunięcia.");
    if ((folder.specialUse || []).length > 0 || folder.path === "/") throw new Error("Folder systemowy/root nie może być usunięty przez bridge.");
    if (folder.capabilities?.canBeDeleted === false) throw new Error("Thunderbird oznacza ten folder jako nieusuwalny.");
    const before = plainFolder(folder);
    if (String(account.type || "").toLowerCase() === "imap") {
      if (!messenger.mailbridge || !messenger.mailbridge.deleteFolderAndRefresh) {
        throw new Error("Natywne usuwanie folderu IMAP jest niedostępne. Zaktualizuj bridge i uruchom ponownie Thunderbirda.");
      }
      const nativeError = await messenger.mailbridge.deleteFolderAndRefresh(folder.accountId, folder.path);
      if (nativeError) throw new Error(nativeError);
    } else {
      await messenger.folders.delete(folder.id || folder);
    }

    let remaining = [];
    let deleted = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      remaining = await messenger.folders.query({ accountId: account.id });
      deleted = !remaining.some((item) =>
        item.id === folder.id ||
        (item.path && item.path === folder.path)
      );
      if (deleted) break;
      await sleep(300);
    }
    if (!deleted) {
      throw new Error(`Thunderbird nie potwierdził usunięcia folderu ${folder.path || folder.name}.`);
    }
    return {
      account: { id: account.id, name: account.name, type: account.type },
      deleted: true,
      serverVerified: String(account.type || "").toLowerCase() === "imap",
      folder: before,
      changed: true,
    };
  }

  if (op === "senders") {
    const { account, query, folder, scope } = await buildMessageQuery(args);
    const first = await messenger.messages.query(query);
    const messages = await allMessagePages(first, Infinity);
    const grouped = new Map();
    for (const message of messages) {
      const author = String(message.author || "(brak nadawcy)").trim() || "(brak nadawcy)";
      let item = grouped.get(author);
      if (!item) {
        item = { author, count: 0, unread: 0, sampleSubjects: [] };
        grouped.set(author, item);
      }
      item.count++;
      if (!message.read) item.unread++;
      const subject = String(message.subject || "").trim();
      if (subject && item.sampleSubjects.length < 2 && !item.sampleSubjects.includes(subject)) {
        item.sampleSubjects.push(subject);
      }
    }
    const limit = Math.max(1, Math.min(Number(args.limit) || 40, 100));
    const senders = [...grouped.values()]
      .sort((a, b) => b.count - a.count || a.author.localeCompare(b.author))
      .slice(0, limit);
    return {
      account: { id: account.id, name: account.name, type: account.type },
      folder: plainFolder(folder),
      scope,
      totalMessages: messages.length,
      senderCount: grouped.size,
      senders,
    };
  }

  if (op === "count" || op === "search") {
    const max = op === "search" ? Math.max(1, Math.min(Number(args.limit) || 20, 100)) : Infinity;
    const { account, folder, scope, messages } = await searchMessages(args, max);
    if (op === "count") {
      return {
        account: { id: account.id, name: account.name, type: account.type },
        count: messages.length,
        query: {
          from: args.from || args.author || "",
          to: args.to || args.recipient || "",
          address: args.address || "",
          subject: args.subject || "",
          fullText: args.fullText || args.text || "",
          folder: folder ? folder.path || folder.name || folder.id : "",
          scope,
        },
      };
    }
    const enriched = await Promise.all(messages.map((message) => plainMessageWithAttachments(message)));
    return {
      account: { id: account.id, name: account.name, type: account.type },
      count: enriched.length,
      messages: enriched,
    };
  }

  if (op === "read") {
    const messageId = Number(args.message_id ?? args.messageId);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      throw new Error("read wymaga poprawnego message_id zwróconego przez search.");
    }
    const maxChars = Math.max(500, Math.min(Number(args.max_chars ?? args.maxChars) || 12000, 100000));
    const startChar = Math.max(0, Math.floor(Number(args.start_char ?? args.startChar) || 0));
    const [message, content] = await Promise.all([
      messenger.messages.get(messageId),
      readMessageBody(messageId),
    ]);
    const totalCharacters = content.body.length;
    const endChar = Math.min(startChar + maxChars, totalCharacters);
    const body = startChar < totalCharacters ? content.body.slice(startChar, endChar) : "";
    const hasMore = endChar < totalCharacters;
    return {
      message: await plainMessageWithAttachments(message),
      body,
      bodyAvailable: totalCharacters > 0,
      bodyFormat: content.format,
      bodySource: content.source,
      contentTypes: content.contentTypes,
      totalCharacters,
      returnedCharacters: body.length,
      startChar,
      endChar,
      hasMore,
      nextStartChar: hasMore ? endChar : null,
      readStateChanged: false,
    };
  }

  if (op === "attachments") {
    const messageId = Number(args.message_id ?? args.messageId);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      throw new Error("attachments wymaga poprawnego message_id zwróconego przez search.");
    }
    const message = await messenger.messages.get(messageId);
    const attachments = await messenger.messages.listAttachments(messageId);
    const listed = (attachments || []).map(plainAttachment);
    return {
      message: plainMessage(message),
      hasAttachments: listed.length > 0,
      attachmentCount: listed.length,
      attachments: listed,
    };
  }

  if (op === "get_attachment") {
    const messageId = Number(args.message_id ?? args.messageId);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      throw new Error("get_attachment wymaga poprawnego message_id zwróconego przez search.");
    }
    if (!messenger.messages || !messenger.messages.getAttachmentFile) {
      throw new Error("Ta wersja Thunderbirda nie udostępnia messages.getAttachmentFile.");
    }
    const attachment = await selectAttachment(messageId, args);
    const file = await messenger.messages.getAttachmentFile(messageId, attachment.partName);
    if (!file) throw new Error("Thunderbird nie zwrócił zawartości załącznika.");
    const transferId = `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    const filename = String(attachment.name || file.name || "attachment.bin").trim() || "attachment.bin";
    const contentType = String(file.type || attachment.contentType || "application/octet-stream").trim() || "application/octet-stream";
    const uploadURL = `${BRIDGE_URL}/attachment-file?token=${encodeURIComponent(BRIDGE_TOKEN)}&id=${encodeURIComponent(transferId)}&filename=${encodeURIComponent(filename)}&content_type=${encodeURIComponent(contentType)}`;
    const upload = await fetch(uploadURL, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: file,
    });
    if (!upload.ok) {
      const detail = await upload.text().catch(() => "");
      throw new Error(`Nie udało się przekazać załącznika do local bridge host (HTTP ${upload.status})${detail ? `: ${detail.trim()}` : ""}.`);
    }
    const message = await messenger.messages.get(messageId);
    const meta = plainAttachment(attachment);
    return {
      transferId,
      filename,
      extension: meta.extension,
      contentType,
      size: Number(file.size) || meta.size || 0,
      partName: attachment.partName || "",
      message: plainMessage(message),
    };
  }

  if (op === "import_msg") {
    if (!args.confirm) {
      throw new Error("import_msg wymaga confirm:true po wyraźnej zgodzie użytkownika.");
    }
    const transferId = String(args.transfer_id || "").trim();
    if (!transferId) throw new Error("Brak bezpiecznego transferu przekonwertowanej wiadomości.");
    if (!String(args.destination || "").trim()) {
      throw new Error("Import .msg wymaga folderu docelowego w polu destination.");
    }
    const account = await resolveAccount(args);
    const destination = await resolveFolder(account, args.destination);
    if (!destination) throw new Error(`Nie znaleziono folderu docelowego: ${args.destination}`);

    const response = await fetch(
      `${BRIDGE_URL}/message-file?token=${encodeURIComponent(BRIDGE_TOKEN)}&id=${encodeURIComponent(transferId)}`,
      { cache: "no-store" }
    );
    if (!response.ok) throw new Error(`Nie udało się pobrać przekonwertowanej wiadomości z local bridge host (HTTP ${response.status}).`);
    const blob = await response.blob();
    const sourceName = String(args.source_name || "message.msg").trim() || "message.msg";
    const emlName = String(args.eml_name || sourceName.replace(/\.msg$/i, ".eml") || "message.eml").trim();
    const file = new File([blob], emlName, { type: "message/rfc822", lastModified: Date.now() });
    const imported = await messenger.messages.import(file, destination.id);
    return {
      account: { id: account.id, name: account.name, type: account.type },
      destination: plainFolder(destination),
      sourceName,
      emlName,
      convertedFrom: "msg",
      imported: plainMessage(imported),
      uploadedToServer: String(account.type || "").toLowerCase() === "imap",
      permanent: false,
    };
  }

  if (op === "move") {
    if (!String(args.destination || "").trim()) {
      throw new Error("Przenoszenie wymaga folderu docelowego w polu destination.");
    }
    const { account, source, messages, batchSize, more } = await mutationMessages(args, "inbox", true);
    const destination = await resolveFolder(account, args.destination);
    if (!destination) throw new Error(`Nie znaleziono folderu docelowego: ${args.destination}`);
    if (source.id === destination.id) throw new Error("Folder źródłowy i docelowy są takie same.");

    const state = takeBulkState("move", args, account, source);
    const ids = messages.map((message) => message.id);
    if (args.dry_run === true) {
      const continuation = more ? saveBulkState("move", state) : "";
      return {
        account: { id: account.id, name: account.name, type: account.type },
        source: plainFolder(source),
        destination: plainFolder(destination),
        batchSize,
        processed: 0,
        wouldProcess: ids.length,
        more,
        continuation,
        permanent: false,
        wholeFolder: args.all === true,
        dryRun: true,
      };
    }

    await inChunks(ids, 100, async (chunk) => {
      await messenger.messages.move(chunk, destination.id, { isUserAction: true });
    });
    state.processed += ids.length;
    const continuation = more ? saveBulkState("move", state) : "";
    return {
      account: { id: account.id, name: account.name, type: account.type },
      source: plainFolder(source),
      destination: plainFolder(destination),
      batchSize,
      processed: ids.length,
      moved: ids.length,
      movedTotal: state.processed,
      more,
      continuation,
      permanent: false,
      wholeFolder: args.all === true,
    };
  }

  if (op === "trash") {
    const { account, source, messages, batchSize, more } = await mutationMessages(args, "inbox");
    const trash = await resolveSpecialFolder(account, "trash", ["trash", "kosz"]);
    if (!trash) throw new Error("Nie znaleziono Kosza na koncie Thunderbird.");
    if (source.id === trash.id) throw new Error("Folder źródłowy jest już Koszem.");
    const state = takeBulkState("trash", args, account, source);
    const ids = messages.map((message) => message.id);
    if (args.dry_run === true) {
      const continuation = more ? saveBulkState("trash", state) : "";
      return {
        account: { id: account.id, name: account.name, type: account.type },
        source: plainFolder(source),
        destination: plainFolder(trash),
        batchSize,
        processed: 0,
        wouldProcess: ids.length,
        more,
        continuation,
        permanent: false,
        dryRun: true,
      };
    }
    await inChunks(ids, 100, async (chunk) => {
      await messenger.messages.move(chunk, trash.id, { isUserAction: true });
    });
    state.processed += ids.length;
    const continuation = more ? saveBulkState("trash", state) : "";
    return {
      account: { id: account.id, name: account.name, type: account.type },
      source: plainFolder(source),
      destination: plainFolder(trash),
      batchSize,
      processed: ids.length,
      moved: ids.length,
      movedTotal: state.processed,
      more,
      continuation,
      permanent: false,
    };
  }

  if (op === "restore") {
    const { account, source, messages, batchSize, more } = await mutationMessages(args, "trash");
    const trash = await resolveSpecialFolder(account, "trash", ["trash", "kosz"]);
    if (!trash || source.id !== trash.id) {
      throw new Error("Przywracanie jest dozwolone tylko z domyślnego Kosza Thunderbird.");
    }
    let destination = await resolveFolder(account, args.destination);
    if (!destination) {
      destination = await resolveSpecialFolder(account, "inbox", ["inbox", "odebrane"]);
    }
    if (!destination) throw new Error("Nie znaleziono folderu docelowego Inbox/Odebrane.");
    if (destination.id === trash.id) throw new Error("Folder docelowy przywracania nie może być Koszem.");

    const state = takeBulkState("restore", args, account, source);
    const ids = messages.map((message) => message.id);
    if (args.dry_run === true) {
      const continuation = more ? saveBulkState("restore", state) : "";
      return {
        account: { id: account.id, name: account.name, type: account.type },
        source: plainFolder(source),
        destination: plainFolder(destination),
        batchSize,
        processed: 0,
        wouldProcess: ids.length,
        more,
        continuation,
        permanent: false,
        dryRun: true,
      };
    }

    await inChunks(ids, 100, async (chunk) => {
      await messenger.messages.move(chunk, destination.id, { isUserAction: true });
    });
    state.processed += ids.length;
    const continuation = more ? saveBulkState("restore", state) : "";
    return {
      account: { id: account.id, name: account.name, type: account.type },
      source: plainFolder(source),
      destination: plainFolder(destination),
      batchSize,
      processed: ids.length,
      restored: ids.length,
      restoredTotal: state.processed,
      more,
      continuation,
      permanent: false,
    };
  }

  if (op === "empty_trash") {
    if (!args.confirm) {
      throw new Error("empty_trash wymaga confirm:true po wyraźnej zgodzie użytkownika.");
    }
    const account = await resolveAccount(args);
    const trash = await resolveSpecialFolder(account, "trash", ["trash", "kosz"]);
    if (!trash) throw new Error("Nie znaleziono Kosza na koncie Thunderbird.");
    if (!messenger.mailbridge || !messenger.mailbridge.emptyTrashAndRefresh) {
      throw new Error("Natywne IMAP Empty Trash nie jest dostępne. Bridge wymaga ponownego uruchomienia/aktualizacji.");
    }

    // Use Thunderbird core's real EmptyTrash operation. For an IMAP account
    // this dispatches DeleteAllMessages() to the server-side Trash folder, so
    // it also works when Thunderbird's local cache already incorrectly says 0.
    await messenger.mailbridge.emptyTrashAndRefresh(trash.accountId, trash.path);

    const verifyBuilt = await buildMessageQuery({ account: account.id, folder: trash.id, scope: "account" });
    const verifyFirst = await messenger.messages.query(verifyBuilt.query);
    const remaining = await allMessagePages(verifyFirst, Infinity);
    return {
      account: { id: account.id, name: account.name, type: account.type },
      source: plainFolder(trash),
      permanent: true,
      serverOperation: "imap_delete_all_messages",
      serverVerified: true,
      remainingLocalAfterRefresh: remaining.length,
      status: "server_empty_trash_completed",
    };
  }

  if (op === "purge" || op === "delete_permanently") {
    const { account, source, scoped, messages, batchSize, more } = await mutationMessages(args, "trash");
    const trash = await resolveSpecialFolder(account, "trash", ["trash", "kosz"]);
    if (!trash || source.id !== trash.id) {
      throw new Error("Trwałe usuwanie jest dozwolone tylko z domyślnego Kosza Thunderbird.");
    }
    const isIMAP = String(account.type || "").toLowerCase() === "imap";
    if (isIMAP && (!messenger.mailbridge || !messenger.mailbridge.compactAndRefresh)) {
      throw new Error("Natywny IMAP EXPUNGE nie jest dostępny. Bridge wymaga ponownego uruchomienia/aktualizacji.");
    }
    const state = takeBulkState("purge", args, account, source);
    const ids = messages.map((message) => message.id);
    if (args.dry_run === true) {
      const continuation = more ? saveBulkState("purge", state) : "";
      return {
        account: { id: account.id, name: account.name, type: account.type },
        source: plainFolder(source),
        batchSize,
        processed: 0,
        wouldProcess: ids.length,
        more,
        continuation,
        permanent: true,
        serverVerified: false,
        dryRun: true,
      };
    }

    let deleteApiError = "";
    try {
      await inChunks(ids, 100, async (chunk) => {
        await messenger.messages.delete(chunk, { deletePermanently: true });
      });
    } catch (error) {
      // Thunderbird can occasionally reject the API promise after the IMAP
      // deletion already happened. Do not report failure until the final
      // folder refresh/query verifies the real mailbox state.
      deleteApiError = String(error?.message || error || "messages.delete failed");
    }
    state.processed += ids.length;

    if (more) {
      if (deleteApiError) {
        throw new Error(`Trwałe usuwanie zwróciło błąd API przed końcem operacji i nie można jeszcze bezpiecznie zweryfikować partii: ${deleteApiError}`);
      }
      const continuation = saveBulkState("purge", state);
      return {
        account: { id: account.id, name: account.name, type: account.type },
        source: plainFolder(source),
        batchSize,
        processed: ids.length,
        attemptedTotal: state.processed,
        more: true,
        continuation,
        permanent: true,
        pendingExpunge: true,
        serverVerified: false,
      };
    }

    // Final batch: IMAP needs a real EXPUNGE/compact before server success can
    // be claimed. Local Folders have no server, so verify directly against the
    // local folder instead of trying to run an IMAP operation on it.
    let refreshError = "";
    if (isIMAP) {
      try {
        await messenger.mailbridge.compactAndRefresh(source.accountId, source.path);
      } catch (error) {
        refreshError = String(error?.message || error || "compact/refresh failed");
      }
    }
    const verifyBuilt = await buildMessageQuery(scoped);
    const verifyFirst = await messenger.messages.query(verifyBuilt.query);
    const remainingMessages = await allMessagePages(verifyFirst, Infinity);
    const locallyGone = remainingMessages.length === 0;
    const verified = locallyGone && (!isIMAP || !refreshError);
    if (!locallyGone && deleteApiError) {
      throw new Error(`Trwałe usuwanie nie zostało potwierdzone po błędzie API (${deleteApiError}); pozostało ${remainingMessages.length} wiadomości.`);
    }
    return {
      account: { id: account.id, name: account.name, type: account.type },
      source: plainFolder(source),
      batchSize,
      processed: ids.length,
      attemptedTotal: state.processed,
      deletedPermanently: verified ? state.processed : 0,
      remaining: remainingMessages.length,
      more: false,
      continuation: "",
      permanent: true,
      pendingExpunge: false,
      serverVerified: isIMAP ? verified : false,
      localVerified: !isIMAP ? locallyGone : false,
      deleteApiError: deleteApiError || undefined,
      refreshError: refreshError || undefined,
      status: verified
        ? (deleteApiError ? "verified_deleted_after_api_error" : (isIMAP ? "verified_deleted" : "verified_local_deleted"))
        : (locallyGone ? "locally_gone_but_server_refresh_failed" : "verification_failed"),
    };
  }

  throw new Error(`Nieznana operacja Thunderbird Bridge: ${op}`);
}

async function postResult(payload) {
  const response = await fetch(`${BRIDGE_URL}/result?token=${encodeURIComponent(BRIDGE_TOKEN)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Bridge result HTTP ${response.status}`);
}

const requestQueue = [];
let requestWorkerRunning = false;

function enqueueRequest(request) {
  requestQueue.push(request);
  if (!requestWorkerRunning) void requestWorker();
}

async function requestWorker() {
  if (requestWorkerRunning) return;
  requestWorkerRunning = true;
  try {
    while (requestQueue.length) {
      const request = requestQueue.shift();
      try {
        const data = await executeRequest(request);
        await postResult({ id: request.id, ok: true, data });
      } catch (error) {
        try {
          await postResult({ id: request.id, ok: false, error: String(error?.message || error) });
        } catch (_) {}
      }
    }
  } finally {
    requestWorkerRunning = false;
    if (requestQueue.length) void requestWorker();
  }
}

async function bridgeLoop() {
  for (;;) {
    try {
      const response = await fetch(`${BRIDGE_URL}/poll?token=${encodeURIComponent(BRIDGE_TOKEN)}`, {
        cache: "no-store",
      });
      if (response.status === 204) continue;
      if (!response.ok) throw new Error(`Bridge poll HTTP ${response.status}`);
      const request = await response.json();
      if (!request || !request.id) continue;
      // Keep polling immediately even while Thunderbird is executing a slow
      // search. Otherwise a busy extension looks disconnected to the host.
      enqueueRequest(request);
    } catch (_) {
      await sleep(1000);
    }
  }
}

bridgeLoop();
