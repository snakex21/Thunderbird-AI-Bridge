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
    headerMessageId: message.headerMessageId || "",
    size: Number(message.size) || 0,
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

function normalizedHeaderMessageId(message) {
  return String(message?.headerMessageId || "").trim().replace(/^<|>$/g, "").toLowerCase();
}

async function folderMessageIdCounts(folder) {
  const first = await messenger.messages.query({ accountId: folder.accountId, folderId: folder.id });
  const messages = await allMessagePages(first, Infinity);
  const counts = new Map();
  for (const message of messages) {
    const key = normalizedHeaderMessageId(message);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

async function sourceMessagesGone(ids, sourceId) {
  const checks = await Promise.all(ids.map(async id => {
    try {
      const message = await messenger.messages.get(id);
      return message?.folder?.id !== sourceId;
    } catch (_) {
      return true;
    }
  }));
  return checks.every(Boolean);
}

function isGmailAllMailFolder(account, folder) {
  if (String(account?.type || "").toLowerCase() !== "imap") return false;
  const specialUse = Array.isArray(folder?.specialUse) ? folder.specialUse.map(value => String(value).toLowerCase()) : [];
  const path = String(folder?.path || "").toLowerCase();
  return specialUse.includes("archives") && (path.includes("[gmail]") || String(account?.name || "").toLowerCase().includes("gmail"));
}

function isGmailAccount(account, folders = []) {
  if (String(account?.type || "").toLowerCase() !== "imap") return false;
  if (/gmail|googlemail/.test(String(account?.name || "").toLowerCase())) return true;
  if ((account?.identities || []).some(identity => /@(gmail|googlemail)\.com$/i.test(String(identity?.email || "").trim()))) return true;
  return folders.some(folder => /^\/?\[(gmail|google mail)\]/i.test(String(folder?.path || "")));
}

function folderHasSpecialUse(folder, ...uses) {
  const specialUse = Array.isArray(folder?.specialUse) ? folder.specialUse.map(value => String(value).toLowerCase()) : [];
  return uses.some(use => specialUse.includes(use));
}

// In Gmail a label folder is only a view of one message. Trashing it from a
// label (or moving it away) acts on the message itself, so a copy that also
// sits in Inbox or another label would disappear from there too. Inbox,
// Trash, Spam and All Mail sources are handled elsewhere.
async function assertGmailLabelSourceSafe(op, account, source, messages) {
  const folders = await messenger.folders.query({ accountId: account.id });
  if (!isGmailAccount(account, folders)) return;
  if (folderHasSpecialUse(source, "inbox", "trash", "junk") || isGmailAllMailFolder(account, source)) return;
  const ignored = new Set(folders
    .filter(folder => folderHasSpecialUse(folder, "trash", "junk") || isGmailAllMailFolder(account, folder))
    .map(folder => folder.id));
  ignored.add(source.id);
  const conflicts = [];
  let missingMessageId = 0;
  await mapWithConcurrency(messages, 4, async message => {
    const key = String(message?.headerMessageId || "").trim().replace(/^<|>$/g, "");
    if (!key) {
      missingMessageId++;
      return;
    }
    const first = await messenger.messages.query({ accountId: account.id, headerMessageId: key });
    const copies = await allMessagePages(first, Infinity);
    const other = copies.find(copy => copy?.folder?.id && !ignored.has(copy.folder.id));
    if (other) conflicts.push({ key, folder: other.folder.path || other.folder.name || other.folder.id });
  });
  if (!conflicts.length && !missingMessageId) return;
  const action = op === "trash"
    ? "przeniesienie do Kosza usunęłoby ją również z Odebranych i pozostałych etykiet"
    : "przeniesienie usunęłoby ją z etykiety źródłowej, a przy błędnej synchronizacji także oryginał z innych etykiet";
  const examples = conflicts.slice(0, 3).map(item => `${item.key} → ${item.folder}`).join(", ");
  throw new Error(
    `Operacja ${op} z etykiety Gmail "${source.name || source.path}" jest zablokowana: ` +
    (conflicts.length
      ? `${conflicts.length} z ${messages.length} wiadomości występuje także w Odebranych lub innej etykiecie (${examples}${conflicts.length > 3 ? ", ..." : ""}). `
      : "") +
    (missingMessageId ? `${missingMessageId} wiadomości nie ma nagłówka Message-ID, więc nie da się sprawdzić innych etykiet. ` : "") +
    `W Gmailu etykiety to widoki tej samej wiadomości, więc ${action}. ` +
    "Wiadomości pozostawiono bez zmian. Wykonaj operację z folderu Odebrane (INBOX) albo zawęź wybór do wiadomości, które są tylko w tej etykiecie" +
    (op === "move" ? "; jeśli celem jest wyłącznie zdjęcie tej etykiety, powtórz move z allow_other_labels:true." : ".")
  );
}

function trashCountsMeetRequired(actualCounts, requiredCounts) {
  return [...requiredCounts].every(([key, count]) =>
    (actualCounts.get(key) || 0) >= count
  );
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

async function allMessagePages(first, max = Infinity, predicate = null) {
  const messages = [];
  let page = first;
  while (page) {
    for (const message of page.messages || []) {
      if (predicate && !predicate(message)) continue;
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
  const rawWanted = String(args.account || args.accountId || "").trim();
  if (rawWanted) {
    const byId = accounts.find(account => String(account.id || "") === rawWanted);
    if (byId) return byId;
    const wanted = rawWanted.toLowerCase();
    const exact = accounts.filter(account => String(account.name || "").trim().toLowerCase() === wanted);
    if (exact.length === 1) return exact[0];
    const matches = exact.length ? exact : accounts.filter(account => String(account.name || "").toLowerCase().includes(wanted));
    if (!matches.length) throw new Error(`Nie znaleziono konta: ${rawWanted}`);
    if (matches.length > 1) {
      throw new Error(`Niejednoznaczna nazwa konta "${rawWanted}" (${matches.map(account => account.name).join(", ")}); użyj accountId z operacji accounts.`);
    }
    return matches[0];
  }

  // Folder IDs carry their owning account ("account2://INBOX").
  const folderSelector = String(args.folder || "").trim();
  const prefix = folderSelector.match(/^([^:/\s]+):\/\//);
  if (prefix) {
    const owner = accounts.find(account => String(account.id || "") === prefix[1]);
    if (owner) return owner;
  }

  const fallback = accounts.find((account) => String(account.type || "").toLowerCase() === "imap") || accounts[0];
  const isMailAccount = account => String(account.type || "").toLowerCase() !== "none";
  if (folderSelector && accounts.filter(isMailAccount).length > 1) {
    // Never silently pick the first IMAP account when a friendly folder name
    // (e.g. "Inbox", "Faktury") exists on several mail accounts.
    const matching = [];
    for (const account of accounts) {
      if (await folderExistsIn(account, folderSelector)) matching.push(account);
    }
    const mailMatching = matching.filter(isMailAccount);
    if (mailMatching.length > 1) {
      throw new Error(
        `Folder "${folderSelector}" istnieje na kilku kontach (${mailMatching.map(account => account.name).join(", ")}); ` +
        "podaj account (accountId z operacji accounts) albo folder.id z operacji folders."
      );
    }
    if (mailMatching.length === 1) return mailMatching[0];
    if (matching.length === 1) return matching[0];
  }
  return fallback;
}

async function folderExistsIn(account, selector) {
  try {
    return Boolean(await resolveFolder(account, selector));
  } catch (error) {
    // An ambiguous name inside one account still means the name exists there.
    return !/^Nie znaleziono folderu/.test(String(error?.message || ""));
  }
}

async function resolveFolder(account, raw) {
  const wanted = String(raw || "").trim();
  if (!wanted) return null;
  const folders = await messenger.folders.query({ accountId: account.id });
  const needle = wanted.toLowerCase().replace(/\\/g, "/");
  // Stable IDs and explicit full paths take precedence over friendly names.
  const byId = folders.find(folder => String(folder.id || "") === wanted);
  if (byId) return byId;
  const normalizedPath = wanted.replace(/\\/g, "/");
  const byPath = folders.find(folder => String(folder.path || "").replace(/\\/g, "/") === normalizedPath);
  if (byPath) return byPath;
  const matches = folders.filter((folder) => {
    const name = String(folder.name || "").toLowerCase();
    const path = String(folder.path || "").toLowerCase().replace(/\\/g, "/");
    return name === needle || path === needle || path.endsWith(`/${needle}`);
  });
  if (matches.length > 1) throw new Error("Niejednoznaczna nazwa folderu; użyj folder.id lub pełnej ścieżki z operacji folders.");
  if (matches.length === 1) return matches[0];
  throw new Error(`Nie znaleziono folderu Thunderbird: ${wanted}`);
}

async function buildMessageQuery(args = {}) {
  const account = await resolveAccount(args);
  const query = { accountId: account.id, autoPaginationTimeout: 250 };
  const scope = String(args.scope || "inbox").trim().toLowerCase();
  let folder = await resolveFolder(account, args.folder);
  if (!folder && scope !== "account") {
    folder = await resolveSpecialFolder(account, "inbox", ["inbox", "odebrane"]);
    if (!folder) throw new Error("Nie znaleziono folderu Inbox/Odebrane; użyj scope:account, aby przeszukać całe konto.");
  }
  if (folder) {
    query.folderId = folder.id;
    query.includeSubFolders = Boolean(args.includeSubFolders);
  }
  const from = String(args.from || args.author || "").trim();
  const to = String(args.to || args.recipient || "").trim();
  const address = String(args.address || "").trim();
  const subject = String(args.subject || "").trim();
  const fullText = String(args.fullText || args.text || "").trim();
  const headerMessageId = String(args.header_message_id || args.headerMessageId || "").trim().replace(/^<|>$/g, "");
  // Thunderbird's author/recipients query requires a full address or a name,
  // so a bare domain ("example.com" / "@example.com") would match nothing.
  // Domain filters are applied locally to the parsed mailbox instead.
  const filters = [];
  const addressDomain = domainFilterSpec(address);
  if (addressDomain) {
    filters.push(message => mailboxesMatchDomain([message.author, ...messageRecipientValues(message)], addressDomain));
  } else {
    const fromDomain = domainFilterSpec(from);
    const toDomain = domainFilterSpec(to);
    if (fromDomain) filters.push(message => mailboxesMatchDomain([message.author], fromDomain));
    else if (from) query.author = from;
    if (toDomain) filters.push(message => mailboxesMatchDomain(messageRecipientValues(message), toDomain));
    else if (to) query.recipients = to;
  }
  if (subject) query.subject = subject;
  if (fullText) query.fullText = fullText;
  if (headerMessageId) query.headerMessageId = headerMessageId;
  if (args.since) query.fromDate = new Date(`${args.since}T00:00:00`);
  if (args.until) query.toDate = new Date(`${args.until}T23:59:59`);
  const filter = filters.length ? message => filters.every(fn => fn(message)) : null;
  return { account, query, folder, scope, filter };
}

const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:[a-z]{2,}|xn--[a-z0-9-]+)$/i;

// Returns {domain, strict} for "@example.com" (strict: domain only) or a bare
// "example.com" (also matches a display name containing that text, so dotted
// names keep working), otherwise null for full addresses and plain names.
function domainFilterSpec(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return null;
  if (value.startsWith("@")) {
    const domain = value.slice(1);
    return DOMAIN_PATTERN.test(domain) ? { domain, strict: true } : null;
  }
  if (value.includes("@") || /[\s<>",;]/.test(value)) return null;
  return DOMAIN_PATTERN.test(value) ? { domain: value, strict: false } : null;
}

function messageRecipientValues(message) {
  return [
    ...(Array.isArray(message?.recipients) ? message.recipients : []),
    ...(Array.isArray(message?.ccList) ? message.ccList : []),
  ];
}

function mailboxesMatchDomain(values, spec) {
  return values.some(value => {
    const parsed = parseMailbox(value);
    if (parsed) {
      const domain = parsed.email.slice(parsed.email.lastIndexOf("@") + 1);
      if (domain === spec.domain || domain.endsWith(`.${spec.domain}`)) return true;
      return !spec.strict && parsed.name.toLowerCase().includes(spec.domain);
    }
    return !spec.strict && String(value || "").toLowerCase().includes(spec.domain);
  });
}

function sortNewestFirst(messages) {
  return messages.sort((a, b) =>
    (new Date(b.date || 0) - new Date(a.date || 0)) || (Number(b.id) || 0) - (Number(a.id) || 0)
  );
}

// Search results are always returned newest-first (date desc, then id desc).
// Thunderbird returns query pages in folder order, so a limited newest-first
// search has to scan all matching headers before slicing. Mutation selection
// passes newestFirst:false to keep its early stop after batch_size + 1.
async function searchMessages(args = {}, max = Infinity, options = {}) {
  const newestFirst = options.newestFirst !== false;
  const limit = Number.isFinite(max) ? max : undefined;
  const collect = async built => {
    const first = await messenger.messages.query(built.query);
    return allMessagePages(first, newestFirst ? Infinity : max, built.filter);
  };
  const address = String(args.address || "").trim();
  if (!address || domainFilterSpec(address)) {
    const built = await buildMessageQuery(args);
    const messages = await collect(built);
    return { ...built, messages: newestFirst ? sortNewestFirst(messages).slice(0, limit) : messages };
  }

  // Thunderbird exposes sender and To-recipient as separate query fields.
  // Run both and merge so a user can simply say "find mail for this address"
  // without knowing whether the address was on the From or To side.
  const senderArgs = { ...args, address: "", from: address, author: "", to: "", recipient: "" };
  const recipientArgs = { ...args, address: "", from: "", author: "", to: address, recipient: "" };
  const senderBuilt = await buildMessageQuery(senderArgs);
  const recipientBuilt = await buildMessageQuery(recipientArgs);
  const [senderMessages, recipientMessages] = await Promise.all([collect(senderBuilt), collect(recipientBuilt)]);
  const byId = new Map();
  for (const message of [...senderMessages, ...recipientMessages]) byId.set(message.id, message);
  const messages = sortNewestFirst([...byId.values()]).slice(0, limit);
  return { ...senderBuilt, messages };
}

function hasMutationFilter(args = {}) {
  return Boolean(
    String(args.to || args.recipient || "").trim() ||
    String(args.address || "").trim() ||
    String(args.from || args.author || "").trim() ||
    String(args.subject || "").trim() ||
    String(args.fullText || args.text || "").trim() ||
    String(args.header_message_id || args.headerMessageId || "").trim() ||
    normalizedRequestedHeaderMessageIds(args).length > 0 ||
    normalizedRequestedMessageIds(args).length > 0 ||
    String(args.since || "").trim() ||
    String(args.until || "").trim()
  );
}

function normalizedRequestedMessageIds(args = {}) {
  const raw = [
    ...(Array.isArray(args.message_ids) ? args.message_ids : []),
    ...(Array.isArray(args.messageIds) ? args.messageIds : []),
  ];
  return [...new Set(raw
    .map(value => Number(value))
    .filter(value => Number.isSafeInteger(value) && value > 0))];
}

function normalizedRequestedHeaderMessageIds(args = {}) {
  const raw = [
    args.header_message_id || args.headerMessageId || "",
    ...(Array.isArray(args.header_message_ids) ? args.header_message_ids : []),
    ...(Array.isArray(args.headerMessageIds) ? args.headerMessageIds : []),
  ];
  return [...new Set(raw
    .map(value => String(value || "").trim().replace(/^<|>$/g, "").toLowerCase())
    .filter(Boolean))];
}

async function resolveSpecialFolder(account, specialUse, fallbackNames = []) {
  const folders = await messenger.folders.query({ accountId: account.id });
  const bySpecial = folders.filter((folder) =>
    Array.isArray(folder.specialUse) && folder.specialUse.some((value) => String(value).toLowerCase() === specialUse)
  );
  if (bySpecial.length > 1) throw new Error(`Niejednoznaczny folder systemowy ${specialUse}; sprawdź konfigurację konta.`);
  if (bySpecial.length === 1) return bySpecial[0];
  const wanted = new Set(fallbackNames.map((name) => String(name).toLowerCase()));
  const matches = folders.filter((folder) => {
    const name = String(folder.name || "").toLowerCase();
    const path = String(folder.path || "").toLowerCase();
    return wanted.has(name) || [...wanted].some((needle) => path.endsWith(`/${needle}`));
  });
  if (matches.length > 1) throw new Error(`Niejednoznaczny folder systemowy ${specialUse}; sprawdź konfigurację konta.`);
  return matches[0] || null;
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

function mutationFingerprint(op, account, source, args = {}, destination = null) {
  return JSON.stringify({
    op,
    accountId: account.id,
    folderId: source.id,
    from: String(args.from || args.author || "").trim(),
    to: String(args.to || args.recipient || "").trim(),
    address: String(args.address || "").trim(),
    includeSubFolders: Boolean(args.includeSubFolders),
    subject: String(args.subject || "").trim(),
    text: String(args.fullText || args.text || "").trim(),
    headerMessageId: String(args.header_message_id || args.headerMessageId || "").trim().replace(/^<|>$/g, "").toLowerCase(),
    headerMessageIds: normalizedRequestedHeaderMessageIds(args).sort(),
    messageIds: normalizedRequestedMessageIds(args).sort((a, b) => a - b),
    since: String(args.since || "").trim(),
    until: String(args.until || "").trim(),
    destination: String(args.destination || "").trim(),
    destinationId: destination?.id ?? null,
    all: args.all === true,
  });
}

function takeBulkState(op, args, account, source, destination = null) {
  cleanupBulkContinuations();
  const fingerprint = mutationFingerprint(op, account, source, args, destination);
  const token = String(args.continuation || "").trim();
  if (!token) return { fingerprint, processed: 0, updatedAt: Date.now() };
  const state = bulkContinuations.get(token);
  if (!state) throw new Error("Token continuation wygasł albo nie istnieje. Zacznij zatwierdzoną operację od nowa.");
  if (state.fingerprint !== fingerprint) throw new Error("Token continuation nie pasuje do operacji lub filtrów. Przerwano dla bezpieczeństwa.");
  bulkContinuations.delete(token);
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
  if (args.confirm !== true) throw new Error("Ta operacja wymaga confirm:true po wyraźnej zgodzie użytkownika.");
  if (!hasMutationFilter(args) && !(allowWholeFolder && args.all === true)) {
    throw new Error("Ta operacja wymaga filtra: from/to/address/subject/text/since/until.");
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
  const requestedMessageIds = normalizedRequestedMessageIds(args);
  if (requestedMessageIds.length > 100) {
    throw new Error("Jedna operacja może wskazywać najwyżej 100 dokładnych identyfikatorów wiadomości Thunderbird.");
  }
  if (requestedMessageIds.length > 0) {
    const messages = [];
    for (const id of requestedMessageIds) {
      let message;
      try { message = await messenger.messages.get(id); } catch (_) { message = null; }
      if (!message || message.folder?.id !== source.id) {
        throw new Error(`Wiadomość Thunderbird ${id} nie istnieje już w wybranym folderze. Przerwano bez zmian.`);
      }
      messages.push(message);
    }
    return { account, source, scoped, messages, batchSize: messages.length, more: false };
  }
  const requestedHeaderMessageIds = normalizedRequestedHeaderMessageIds(args);
  if (requestedHeaderMessageIds.length > 100) {
    throw new Error("Jedna operacja może wskazywać najwyżej 100 dokładnych Message-ID.");
  }
  if (requestedHeaderMessageIds.length > 1 || Array.isArray(args.header_message_ids) || Array.isArray(args.headerMessageIds)) {
    const requestedSet = new Set(requestedHeaderMessageIds);
    const byId = new Map();
    // One local header scan is both faster and more reliable than issuing up
    // to 100 rapid Thunderbird queries. Some providers/Thunderbird versions
    // intermittently omit exact Message-ID query results containing '+' or
    // other punctuation when many queries are executed back-to-back.
    // searchMessages keeps from/to/address/subject/text/date filters
    // consistent with the non-exact mutation path.
    const { messages: candidates } = await searchMessages({
      ...scoped,
      header_message_id: "",
      headerMessageId: "",
      header_message_ids: undefined,
      headerMessageIds: undefined,
    }, Infinity);
    for (const message of candidates) {
      if (requestedSet.has(normalizedHeaderMessageId(message))) byId.set(message.id, message);
    }
    const messages = [...byId.values()];
    const foundHeaderMessageIds = new Set(messages.map(normalizedHeaderMessageId));
    const missing = requestedHeaderMessageIds.filter(id => !foundHeaderMessageIds.has(id));
    if (missing.length > 0) {
      throw new Error(
        `Nie znaleziono ${missing.length} z ${requestedHeaderMessageIds.length} dokładnie wskazanych wiadomości ` +
        `(${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ", ..." : ""}). Przerwano bez zmian.`
      );
    }
    return { account, source, scoped, messages, batchSize: messages.length, more: false };
  }
  const { messages: candidates } = await searchMessages(scoped, batchSize + 1, { newestFirst: false });
  const more = candidates.length > batchSize;
  const messages = more ? candidates.slice(0, batchSize) : candidates;
  return { account, source, scoped, messages, batchSize, more };
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function inChunks(items, size, fn) {
  for (let i = 0; i < items.length; i += size) {
    await fn(items.slice(i, i + size));
  }
}

function parseMailbox(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const emailMatch = raw.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (!emailMatch) return null;
  const email = emailMatch[0].toLowerCase();
  let name = raw.replace(emailMatch[0], "").replace(/[<>]/g, "").trim();
  name = name.replace(/^["']+|["']+$/g, "").trim();
  if (!name || name.toLowerCase() === email) name = email.split("@", 1)[0];
  return { email, name };
}

function contactNodeDetails(contact) {
  const properties = contact?.properties || {};
  let email = String(properties.PrimaryEmail || "").trim().toLowerCase();
  let name = String(properties.DisplayName || "").trim();
  const vCard = String(properties.vCard || "");
  if (!email) {
    const match = vCard.match(/^EMAIL(?:;[^:]*)?:(.+)$/im);
    if (match) email = match[1].trim().toLowerCase();
  }
  if (!name) {
    const match = vCard.match(/^FN(?:;[^:]*)?:(.+)$/im);
    if (match) name = match[1].trim();
  }
  return {
    id: contact?.id || "",
    parentId: contact?.parentId || "",
    name,
    email,
    readOnly: Boolean(contact?.readOnly),
    remote: Boolean(contact?.remote),
  };
}

function plainAddressBook(book) {
  return {
    id: book?.id || "",
    name: book?.name || "",
    readOnly: Boolean(book?.readOnly),
    remote: Boolean(book?.remote),
    contactCount: Array.isArray(book?.contacts) ? book.contacts.length : null,
  };
}

async function resolveAddressBook(raw, requireWritable = true) {
  const books = await messenger.addressBooks.list(true);
  const wanted = String(raw || "").trim().toLowerCase();
  let book = wanted
    ? books.find(item => String(item.id || "").toLowerCase() === wanted || String(item.name || "").toLowerCase() === wanted)
    : books.find(item => !item.readOnly && !item.remote);
  if (!book) throw new Error(wanted ? `Nie znaleziono książki adresowej: ${raw}` : "Nie znaleziono lokalnej książki adresowej.");
  if (requireWritable && (book.readOnly || book.remote)) throw new Error("Wybrana książka adresowa jest tylko do odczytu.");
  return book;
}

function escapeVCardText(value) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .trim();
}

function contactVCard(name, email) {
  return [
    "BEGIN:VCARD",
    "VERSION:4.0",
    `FN:${escapeVCardText(name)}`,
    `EMAIL;PREF=1:${email}`,
    "END:VCARD",
    "",
  ].join("\r\n");
}

async function contactCandidates(args = {}) {
  const { account, folder, scope, messages } = await searchMessages(args, Infinity, { newestFirst: false });
  const ownEmails = new Set();
  const accounts = await messenger.accounts.list();
  for (const item of accounts) {
    const fromName = parseMailbox(item.name);
    if (fromName) ownEmails.add(fromName.email);
    for (const identity of item.identities || []) {
      const email = String(identity.email || "").trim().toLowerCase();
      if (email) ownEmails.add(email);
    }
  }
  for (const value of args.exclude_emails || args.excludeEmails || []) {
    const parsed = parseMailbox(value);
    if (parsed) ownEmails.add(parsed.email);
  }

  const grouped = new Map();
  const add = (value, role, seen) => {
    const parsed = parseMailbox(value);
    if (!parsed || ownEmails.has(parsed.email) || seen.has(parsed.email)) return;
    seen.add(parsed.email);
    let item = grouped.get(parsed.email);
    if (!item) {
      item = { email: parsed.email, name: parsed.name, messages: 0, senderMessages: 0, recipientMessages: 0 };
      grouped.set(parsed.email, item);
    }
    const fallback = item.email.split("@", 1)[0];
    if (item.name === fallback && parsed.name !== fallback) item.name = parsed.name;
    item.messages++;
    if (role === "sender") item.senderMessages++;
    else item.recipientMessages++;
  };

  for (const message of messages) {
    const senderSeen = new Set();
    const recipientSeen = new Set();
    add(message.author, "sender", senderSeen);
    for (const value of [...(message.recipients || []), ...(message.ccList || [])]) {
      add(value, "recipient", recipientSeen);
    }
  }
  const minCount = Math.max(1, Number(args.min_count ?? args.minCount) || 1);
  const limit = Math.max(1, Math.min(Number(args.limit) || 200, 500));
  const candidates = [...grouped.values()]
    .filter(item => item.messages >= minCount)
    .sort((a, b) => b.messages - a.messages || a.email.localeCompare(b.email))
    .slice(0, limit);
  return {
    account: { id: account.id, name: account.name, type: account.type },
    folder: plainFolder(folder),
    scope,
    scannedMessages: messages.length,
    candidateCount: grouped.size,
    returned: candidates.length,
    candidates,
  };
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
      addressBookAvailable: Boolean(messenger.addressBooks && messenger.contacts),
      accounts: accounts.map((account) => ({ id: account.id, name: account.name, type: account.type })),
    };
  }

  if (op === "accounts") {
    const accounts = await messenger.accounts.list();
    return accounts.map((account) => ({ id: account.id, name: account.name, type: account.type }));
  }

  if (op === "address_books") {
    const books = await messenger.addressBooks.list(true);
    return { addressBooks: books.map(plainAddressBook) };
  }

  if (op === "contacts") {
    const selector = String(args.address_book || args.addressBook || "").trim();
    const books = selector
      ? [await resolveAddressBook(selector, false)]
      : await messenger.addressBooks.list(true);
    const contacts = [];
    for (const book of books) {
      const listed = Array.isArray(book.contacts) ? book.contacts : await messenger.contacts.list(book.id);
      for (const contact of listed) contacts.push({ ...contactNodeDetails(contact), addressBook: book.name });
    }
    return { count: contacts.length, contacts };
  }

  if (op === "contact_candidates") {
    return contactCandidates(args);
  }

  if (op === "create_address_book") {
    if (args.confirm !== true) throw new Error("create_address_book wymaga confirm:true po wyraźnej zgodzie użytkownika.");
    const name = String(args.name || "").trim();
    if (!name) throw new Error("create_address_book wymaga name.");
    const books = await messenger.addressBooks.list(true);
    const existing = books.find(book => String(book.name || "").trim().toLowerCase() === name.toLowerCase());
    if (existing) return { created: false, addressBook: plainAddressBook(existing) };
    const id = await messenger.addressBooks.create({ name });
    const created = await messenger.addressBooks.get(id, true);
    return { created: true, addressBook: plainAddressBook(created) };
  }

  if (op === "add_contacts") {
    if (args.confirm !== true) throw new Error("add_contacts wymaga confirm:true po wyraźnej zgodzie użytkownika.");
    const requested = Array.isArray(args.contacts) ? args.contacts : [];
    if (!requested.length) throw new Error("add_contacts wymaga niepustej listy contacts.");
    if (requested.length > 200) throw new Error("Jedna operacja może dodać najwyżej 200 kontaktów.");
    const book = await resolveAddressBook(args.address_book || args.addressBook, true);
    const existingEmails = new Set();
    const listed = Array.isArray(book.contacts) ? book.contacts : await messenger.contacts.list(book.id);
    for (const contact of listed) {
      const details = contactNodeDetails(contact);
      if (details.email) existingEmails.add(details.email);
    }
    const seen = new Set();
    const created = [];
    const skipped = [];
    for (const input of requested) {
      const parsed = parseMailbox(input?.email);
      if (!parsed) {
        skipped.push({ email: String(input?.email || ""), reason: "invalid_email" });
        continue;
      }
      if (existingEmails.has(parsed.email) || seen.has(parsed.email)) {
        skipped.push({ email: parsed.email, reason: "already_exists" });
        continue;
      }
      seen.add(parsed.email);
      const name = String(input?.name || "").trim() || parsed.name;
      const id = await messenger.contacts.create(book.id, { vCard: contactVCard(name, parsed.email) });
      existingEmails.add(parsed.email);
      created.push({ id, name, email: parsed.email });
    }
    return {
      addressBook: plainAddressBook(book),
      requested: requested.length,
      createdCount: created.length,
      skippedCount: skipped.length,
      created,
      skipped,
    };
  }

  if (op === "update_contact") {
    if (args.confirm !== true) throw new Error("update_contact wymaga confirm:true po wyraźnej zgodzie użytkownika.");
    const contactId = String(args.contact_id || args.contactId || "").trim();
    if (!contactId) throw new Error("update_contact wymaga contact_id.");
    const books = await messenger.addressBooks.list(true);
    let current = null;
    let parentBook = null;
    for (const book of books) {
      const listed = Array.isArray(book.contacts) ? book.contacts : await messenger.contacts.list(book.id);
      const found = listed.find(contact => String(contact.id) === contactId);
      if (found) {
        current = contactNodeDetails(found);
        parentBook = book;
        break;
      }
    }
    if (!current || !parentBook) throw new Error(`Nie znaleziono kontaktu: ${contactId}`);
    if (parentBook.readOnly) throw new Error(`Książka adresowa jest tylko do odczytu: ${parentBook.name}`);
    const parsed = parseMailbox(args.email || current.email);
    if (!parsed) throw new Error("update_contact wymaga prawidłowego obecnego lub nowego adresu email.");
    const name = String(args.name || "").trim() || current.name || parsed.name;
    await messenger.contacts.update(contactId, { vCard: contactVCard(name, parsed.email) });
    return {
      updated: true,
      contact: { id: contactId, addressBook: parentBook.name, name, email: parsed.email },
    };
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
    if (args.confirm !== true) {
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
    if (args.confirm !== true) throw new Error("create_folder wymaga confirm:true po wyraźnej zgodzie użytkownika.");
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
    if (args.confirm !== true) throw new Error("rename_folder wymaga confirm:true po wyraźnej zgodzie użytkownika.");
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
    if (args.confirm !== true) throw new Error("delete_folder wymaga confirm:true po wyraźnej zgodzie użytkownika.");
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
    const { account, folder, scope, messages } = await searchMessages(args, Infinity, { newestFirst: false });
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

  if (op === "largest") {
    const { account, folder, scope, messages } = await searchMessages(args, Infinity, { newestFirst: false });
    const limit = Math.max(1, Math.min(Number(args.limit) || 40, 100));
    const totalBytes = messages.reduce((sum, message) => sum + (Number(message.size) || 0), 0);
    const largest = messages
      .slice()
      .sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0) || Number(b.id) - Number(a.id))
      .slice(0, limit)
      .map(plainMessage);
    return {
      account: { id: account.id, name: account.name, type: account.type },
      folder: plainFolder(folder),
      scope,
      totalMessages: messages.length,
      totalBytes,
      largest,
    };
  }

  if (op === "count" || op === "search") {
    const max = op === "search" ? Math.max(1, Math.min(Number(args.limit) || 20, 100)) : Infinity;
    const { account, folder, scope, messages } = await searchMessages(args, max, { newestFirst: op === "search" });
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
    // Listing attachments costs one MIME parse per message (100 results took
    // 20-27 s live), so search returns headers only unless asked explicitly.
    const includeAttachments = args.include_attachments === true || args.includeAttachments === true;
    const enriched = includeAttachments
      ? await mapWithConcurrency(messages, 6, message => plainMessageWithAttachments(message))
      : messages.map(plainMessage);
    return {
      account: { id: account.id, name: account.name, type: account.type },
      count: enriched.length,
      attachmentsIncluded: includeAttachments,
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
    if (args.confirm !== true) {
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

    if (isGmailAllMailFolder(account, source)) {
      throw new Error(
        "Operacja move z Gmail All Mail/Wszystkie jest zablokowana: stary mechanizm IMAP może potraktować przeniesienie jak trwałe usunięcie. " +
        "Użyj zwykłego folderu/etykiety albo bezpiecznej kopii lokalnej; wiadomości źródłowe pozostawiono bez zmian."
      );
    }

    if (args.allow_other_labels !== true) {
      await assertGmailLabelSourceSafe("move", account, source, messages);
    }

    const state = takeBulkState("move", args, account, source, destination);
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

  if (op === "copy") {
    if (!String(args.destination || "").trim()) {
      throw new Error("Kopiowanie wymaga folderu docelowego w polu destination.");
    }
    const { account, source, messages, batchSize, more } = await mutationMessages(args, "inbox");
    const destinationAccount = await resolveAccount({ account: args.destination_account || args.destinationAccount || account.id });
    const destination = await resolveFolder(destinationAccount, args.destination);
    if (!destination) throw new Error(`Nie znaleziono folderu docelowego: ${args.destination}`);
    if (source.id === destination.id) throw new Error("Folder źródłowy i docelowy są takie same.");
    if (isGmailAllMailFolder(account, source) && destinationAccount.id === account.id) {
      throw new Error(
        "Kopiowanie z Gmail All Mail/Wszystkie do tego samego konta jest zablokowane: stary IMAP może tworzyć duplikaty i długo czekać na synchronizację. " +
        "Kopiuj z All Mail wyłącznie do Local Folders albo użyj zwykłej etykiety w Gmailu."
      );
    }
    const ids = messages.map(message => message.id);
    const expected = messages.map(message => ({
      headerMessageId: String(message.headerMessageId || "").trim().replace(/^<|>$/g, "").toLowerCase(),
      size: Number(message.size) || 0,
    }));
    if (expected.some(item => !item.headerMessageId)) {
      throw new Error("Kopiowanie z weryfikacją wymaga nagłówka Message-ID w każdej wiadomości.");
    }
    const beforeFirst = await messenger.messages.query({ accountId: destination.accountId, folderId: destination.id });
    const beforeMessages = await allMessagePages(beforeFirst, Infinity);
    const beforeCounts = new Map();
    for (const message of beforeMessages) {
      const key = String(message.headerMessageId || "").trim().replace(/^<|>$/g, "").toLowerCase();
      if (key) beforeCounts.set(key, (beforeCounts.get(key) || 0) + 1);
    }
    const missingIndexes = expected
      .map((item, index) => beforeCounts.has(item.headerMessageId) ? -1 : index)
      .filter(index => index >= 0);
    const missingIds = missingIndexes.map(index => ids[index]);
    const missingExpected = missingIndexes.map(index => expected[index]);
    await inChunks(missingIds, 100, async chunk => {
      await messenger.messages.copy(chunk, destination.id, { isUserAction: true });
    });
    let verified = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const afterFirst = await messenger.messages.query({ accountId: destination.accountId, folderId: destination.id });
      const afterMessages = await allMessagePages(afterFirst, Infinity);
      const afterCounts = new Map();
      for (const message of afterMessages) {
        const key = String(message.headerMessageId || "").trim().replace(/^<|>$/g, "").toLowerCase();
        if (key) afterCounts.set(key, (afterCounts.get(key) || 0) + 1);
      }
      verified = expected.every(item =>
        beforeCounts.has(item.headerMessageId) ||
        (afterCounts.get(item.headerMessageId) || 0) > (beforeCounts.get(item.headerMessageId) || 0)
      );
      if (verified) break;
      await sleep(250);
    }
    return {
      account: { id: account.id, name: account.name, type: account.type },
      source: plainFolder(source),
      destinationAccount: { id: destinationAccount.id, name: destinationAccount.name, type: destinationAccount.type },
      destination: plainFolder(destination),
      batchSize,
      copied: missingIds.length,
      skipped: ids.length - missingIds.length,
      copiedBytes: missingExpected.reduce((sum, item) => sum + item.size, 0),
      more,
      verified,
      messageIds: expected.map(item => item.headerMessageId),
      permanent: false,
    };
  }

  if (op === "trash") {
    const { account, source, messages, batchSize, more } = await mutationMessages(args, "inbox");
    const trash = await resolveSpecialFolder(account, "trash", ["trash", "kosz"]);
    if (!trash) throw new Error("Nie znaleziono Kosza na koncie Thunderbird.");
    if (source.id === trash.id) throw new Error("Folder źródłowy jest już Koszem.");
    const requestedHeaderMessageIds = normalizedRequestedHeaderMessageIds(args);
    const requestedMessageIds = normalizedRequestedMessageIds(args);
    const hasOnlyExactMessageIds = (requestedHeaderMessageIds.length > 0 || requestedMessageIds.length > 0) && !(
      String(args.from || args.author || "").trim() ||
      String(args.to || args.recipient || "").trim() ||
      String(args.address || "").trim() ||
      String(args.subject || "").trim() ||
      String(args.fullText || args.text || "").trim() ||
      String(args.since || "").trim() ||
      String(args.until || "").trim()
    );
    const verifiedLocalBackupOverride = args.local_backup_verified === true && hasOnlyExactMessageIds;
    if (isGmailAllMailFolder(account, source) && !verifiedLocalBackupOverride) {
      throw new Error(
        "Operacja trash z Gmail All Mail/Wszystkie jest zablokowana: Gmail może po synchronizacji trwale usunąć wiadomość razem z kopią Kosza. " +
        "Użyj zwykłego folderu/etykiety albo osobnego, jawnie zatwierdzonego procesu: kopia lokalna, weryfikacja i trwałe usunięcie."
      );
    }
    if (isGmailAllMailFolder(account, source)) {
      const actualHeaderMessageIds = new Set(messages.map(normalizedHeaderMessageId));
      const missing = requestedHeaderMessageIds.filter(id => !actualHeaderMessageIds.has(id));
      const expectedCount = requestedMessageIds.length || requestedHeaderMessageIds.length;
      if (missing.length > 0 || messages.length !== expectedCount) {
        throw new Error("Jawnie zatwierdzone usuwanie z Gmail All Mail wymaga dokładnie jednej znalezionej wiadomości dla każdego Message-ID. Przerwano bez zmian.");
      }
    }
    await assertGmailLabelSourceSafe("trash", account, source, messages);
    const state = takeBulkState("trash", args, account, source, trash);
    const ids = messages.map((message) => message.id);
    const expectedCounts = new Map();
    for (const message of messages) {
      const key = normalizedHeaderMessageId(message);
      if (!key) {
        throw new Error("Bezpieczne przeniesienie do Kosza wymaga nagłówka Message-ID w każdej wiadomości.");
      }
      expectedCounts.set(key, (expectedCounts.get(key) || 0) + 1);
    }
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
    const beforeTrashCounts = await folderMessageIdCounts(trash);
    const gmailAllMailSafetyCopy = isGmailAllMailFolder(account, source);
    const requiredTrashCounts = new Map();
    let deletionMethod = "messages.delete(deletePermanently:false)";
    if (gmailAllMailSafetyCopy) {
      // Gmail's All Mail is a virtual system label, not a normal IMAP folder.
      // Moving/deleting directly from it can be expunged permanently after the
      // first optimistic local update. Stage an independent server copy in
      // Trash first, verify it, then remove only the original message ids.
      const alreadyStaged = [...expectedCounts].every(([key, count]) =>
        (beforeTrashCounts.get(key) || 0) >= count
      );
      if (alreadyStaged) {
        for (const [key, count] of expectedCounts) {
          requiredTrashCounts.set(key, Math.max(count, beforeTrashCounts.get(key) || 0));
        }
        deletionMethod = "gmail-resume-existing-trash-copy-then-delete-original";
      } else {
        await inChunks(ids, 100, async chunk => {
          await messenger.messages.copy(chunk, trash.id, { isUserAction: true });
        });
        for (const [key, count] of expectedCounts) {
          requiredTrashCounts.set(key, (beforeTrashCounts.get(key) || 0) + count);
        }
        deletionMethod = "gmail-trash-copy-then-delete-original";
      }
      let staged = alreadyStaged;
      for (let attempt = 0; attempt < 30; attempt++) {
        const stagedCounts = await folderMessageIdCounts(trash);
        staged = trashCountsMeetRequired(stagedCounts, requiredTrashCounts);
        if (staged) break;
        await sleep(500);
      }
      if (!staged) {
        throw new Error("Gmail nie potwierdził kopii bezpieczeństwa w Koszu; wiadomości źródłowe pozostawiono bez zmian.");
      }
      if (!(await sourceMessagesGone(ids, source.id))) {
        await inChunks(ids, 100, async chunk => {
          await messenger.messages.delete(chunk, { deletePermanently: true, isUserAction: true });
        });
      }
    } else {
      for (const [key, count] of expectedCounts) {
        requiredTrashCounts.set(key, (beforeTrashCounts.get(key) || 0) + count);
      }
      await inChunks(ids, 100, async chunk => {
        await messenger.messages.delete(chunk, { deletePermanently: false, isUserAction: true });
      });
    }
    let trashVerified = ids.length === 0;
    let sourceVerified = ids.length === 0;
    for (let attempt = 0; attempt < 30 && !(trashVerified && sourceVerified); attempt++) {
      const afterTrashCounts = await folderMessageIdCounts(trash);
      trashVerified = trashCountsMeetRequired(afterTrashCounts, requiredTrashCounts);
      sourceVerified = await sourceMessagesGone(ids, source.id);
      if (!(trashVerified && sourceVerified)) await sleep(500);
    }
    if (!(trashVerified && sourceVerified)) {
      throw new Error(
        `Przeniesienie do Kosza nie przeszło weryfikacji (trashVerified=${trashVerified}, sourceVerified=${sourceVerified}). ` +
        "Nie ponawiaj operacji w ciemno; najpierw sprawdź folder źródłowy i Kosz."
      );
    }
    // IMAP/Gmail may first expose an optimistic local move and only later
    // apply server EXPUNGE semantics. Require the result to survive a settle
    // window before reporting a recoverable Trash operation as successful.
    await sleep(5000);
    const settledTrashCounts = await folderMessageIdCounts(trash);
    trashVerified = trashCountsMeetRequired(settledTrashCounts, requiredTrashCounts);
    sourceVerified = await sourceMessagesGone(ids, source.id);
    if (!(trashVerified && sourceVerified)) {
      throw new Error(
        `Kosz nie zachował wiadomości po synchronizacji (trashVerified=${trashVerified}, sourceVerified=${sourceVerified}). ` +
        "Operacja nie jest potwierdzona jako odwracalna. Nie kontynuuj kolejnej partii."
      );
    }
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
      trashVerified,
      sourceVerified,
      serverVerified: String(account.type || "").toLowerCase() === "imap",
      localVerified: String(account.type || "").toLowerCase() !== "imap",
      deletionMethod,
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

    const state = takeBulkState("restore", args, account, source, destination);
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
    if (args.confirm !== true) {
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
      serverVerified: remaining.length === 0,
      remainingLocalAfterRefresh: remaining.length,
      status: remaining.length === 0 ? "server_empty_trash_completed" : "verification_failed",
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
    let expungeSkipped = false;
    if (isIMAP) {
      try {
        const measurement = await messenger.mailbridge.compactAndRefresh(source.accountId, source.path);
        expungeSkipped = measurement?.skipped === true;
      } catch (error) {
        refreshError = String(error?.message || error || "compact/refresh failed");
      }
    }
    const { messages: remainingMessages } = await searchMessages(scoped);
    const locallyGone = remainingMessages.length === 0;
    const verified = locallyGone && (!isIMAP || (!refreshError && !expungeSkipped));
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
      pendingExpunge: isIMAP && (expungeSkipped || Boolean(refreshError)),
      serverVerified: isIMAP ? verified : false,
      localVerified: !isIMAP ? locallyGone : false,
      deleteApiError: deleteApiError || undefined,
      refreshError: refreshError || undefined,
      status: verified
        ? (deleteApiError ? "verified_deleted_after_api_error" : (isIMAP ? "verified_deleted" : "verified_local_deleted"))
        : (locallyGone ? (expungeSkipped ? "server_expunge_not_confirmed" : "locally_gone_but_server_refresh_failed") : "verification_failed"),
    };
  }

  throw new Error(`Nieznana operacja Thunderbird Bridge: ${op}`);
}

// Process-local only: no mailbox results are written to disk. IDs remain
// retained until acknowledged; acknowledged results expire after five minutes.
// Reserve a protocol-sized result before execution rather than evicting an
// unacknowledged operation to admit a new one.
const RESULT_TTL_MS = 5 * 60 * 1000;
const RESULT_RECORD_LIMIT = 128;
const RESULT_BYTE_LIMIT = 8 * 1024 * 1024;
const RESULT_MAX_BYTES = 4 * 1024 * 1024;
const requestRecords = new Map();
let resultBytes = 0;
let reservedBytes = 0;
let capacityWarningShown = false;

// Requests refused at capacity were never executed. Their small rejection is
// remembered so a same-ID re-arrival gets the same answer instead of running
// after the host already reported failure.
const REJECTION_RECORD_LIMIT = 256;
const REJECTION_TTL_MS = 10 * 60 * 1000;
const rejectedRequests = new Map();
const rejectionQueue = [];
let rejectionWorkerRunning = false;

// Per-operation execution limits. A timeout cannot cancel Thunderbird's own
// work, so mutations report "outcome unknown"; reads change nothing.
const READ_OPERATION_TIMEOUT_MS = 120 * 1000;
const MUTATION_OPERATION_TIMEOUT_MS = 10 * 60 * 1000;
const LONG_MUTATION_TIMEOUT_MS = 20 * 60 * 1000;
const MUTATING_OPERATIONS = new Set([
  "create_folder", "rename_folder", "delete_folder", "compact_folder", "create_address_book", "add_contacts",
  "update_contact", "import_msg", "move", "copy", "trash", "restore", "empty_trash", "purge", "delete_permanently",
]);

function operationTimeoutMs(op) {
  if (op === "compact_folder" || op === "empty_trash") return LONG_MUTATION_TIMEOUT_MS;
  return MUTATING_OPERATIONS.has(op) ? MUTATION_OPERATION_TIMEOUT_MS : READ_OPERATION_TIMEOUT_MS;
}

async function executeWithTimeout(request) {
  const op = String(request?.op || "").toLowerCase();
  const ms = operationTimeoutMs(op);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const seconds = Math.round(ms / 1000);
      console.warn(`Thunderbird Bridge operation ${op || "(none)"} (${request.id}) exceeded ${seconds} s.`);
      reject(new Error(MUTATING_OPERATIONS.has(op)
        ? `Operacja ${op} przekroczyła limit ${seconds} s w Thunderbirdzie; outcome unknown: mogła się wykonać lub nadal trwa. ` +
          "Nie powtarzaj automatycznie; najpierw sprawdź stan skrzynki."
        : `Operacja ${op} przekroczyła limit ${seconds} s w Thunderbirdzie (odczyt, bez zmian w skrzynce). Zawęź zapytanie (folder, daty, limit) i spróbuj ponownie.`));
    }, ms);
  });
  try {
    return await Promise.race([executeRequest(request), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function hasRequestCapacity() {
  return requestRecords.size < RESULT_RECORD_LIMIT && resultBytes + reservedBytes + RESULT_MAX_BYTES <= RESULT_BYTE_LIMIT;
}

function pruneRequestRecords() {
  const now = Date.now();
  for (const [id, record] of requestRecords) {
    if (!record.queued && record.acknowledged && record.completedAt !== null && now - record.acknowledgedAt >= RESULT_TTL_MS) {
      resultBytes -= record.bytes;
      requestRecords.delete(id);
    }
  }
  for (const [id, rejection] of rejectedRequests) {
    if (!rejection.queued && now - rejection.at >= REJECTION_TTL_MS) rejectedRequests.delete(id);
  }
}

function queueRejection(rejection) {
  if (rejection.queued) return;
  rejection.queued = true;
  rejectionQueue.push(rejection);
  if (!rejectionWorkerRunning) void rejectionWorker();
}

function rejectForCapacity(request) {
  if (rejectedRequests.size >= REJECTION_RECORD_LIMIT) return;
  const rejection = {
    at: Date.now(),
    queued: false,
    body: JSON.stringify({
      id: request.id,
      ok: false,
      notExecuted: true,
      error: "Thunderbird Bridge is at capacity (too many unacknowledged results); this request was NOT executed. " +
        "Retry later with a new request id.",
    }),
  };
  rejectedRequests.set(request.id, rejection);
  queueRejection(rejection);
}

async function rejectionWorker() {
  if (rejectionWorkerRunning) return;
  rejectionWorkerRunning = true;
  try {
    while (rejectionQueue.length) {
      const rejection = rejectionQueue.shift();
      await deliverResult(rejection.body);
      rejection.queued = false;
    }
  } finally {
    rejectionWorkerRunning = false;
    if (rejectionQueue.length) void rejectionWorker();
  }
}

async function postResult(body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${BRIDGE_URL}/result?token=${encodeURIComponent(BRIDGE_TOKEN)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error(`Bridge result HTTP ${response.status}`);
      error.permanent = response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status);
      throw error;
    }
  } finally {
    clearTimeout(timer);
  }
}

async function deliverResult(body) {
  // Retry the exact serialized result, never executeRequest. In particular a
  // delivery error must not be replaced with a false operation-failed result.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await postResult(body);
      return true;
    } catch (error) {
      if (error.permanent || attempt === 2) {
        console.warn("Thunderbird Bridge result delivery unacknowledged; operation must not be automatically repeated.");
        return false;
      }
      await sleep(attempt === 0 ? 250 : 1000);
    }
  }
}

const requestQueue = [];
let requestWorkerRunning = false;

function enqueueRequest(request) {
  if (typeof request?.id !== "string" || !request.id || request.id.length > 256) return;
  pruneRequestRecords();
  let record = requestRecords.get(request.id);
  if (record?.queued) return;
  if (!record) {
    const rejected = rejectedRequests.get(request.id);
    if (rejected) {
      queueRejection(rejected);
      return false;
    }
    // Unadmitted requests are never executed. The host gets an explicit
    // not-executed error whose ID is retained (bounded), so a same-ID
    // re-arrival cannot execute after the host accepted that failure.
    if (!hasRequestCapacity()) {
      if (!capacityWarningShown) console.warn("Thunderbird Bridge recovery capacity exhausted; new requests are rejected without execution.");
      capacityWarningShown = true;
      rejectForCapacity(request);
      return false;
    }
    capacityWarningShown = false;
    record = { body: null, bytes: 0, completedAt: null, queued: false, acknowledged: false, acknowledgedAt: null };
    reservedBytes += RESULT_MAX_BYTES;
    requestRecords.set(request.id, record);
  }
  record.queued = true;
  requestQueue.push({ request, record });
  if (!requestWorkerRunning) void requestWorker();
}

async function requestWorker() {
  if (requestWorkerRunning) return;
  requestWorkerRunning = true;
  try {
    while (requestQueue.length) {
      const { request, record } = requestQueue.shift();
      let body = record.body;
      if (record.completedAt === null) {
        let payload;
        try {
          payload = { id: request.id, ok: true, data: await executeWithTimeout(request) };
        } catch (error) {
          payload = { id: request.id, ok: false, error: String(error?.message || error) };
        }
        try {
          body = JSON.stringify(payload);
        } catch (_) {
          body = JSON.stringify({ id: request.id, ok: false, error: "Operation finished but its result could not be serialized; outcome unknown. Do not automatically repeat mutations." });
        }
        let bytes = new TextEncoder().encode(body).length;
        if (bytes > RESULT_MAX_BYTES) {
          body = JSON.stringify({ id: request.id, ok: false, error: "Operation finished but its result exceeded the bridge transport limit; outcome unknown. Do not automatically repeat mutations." });
          bytes = new TextEncoder().encode(body).length;
        }
        record.completedAt = Date.now();
        record.body = body;
        record.bytes = bytes;
        reservedBytes -= RESULT_MAX_BYTES;
        resultBytes += bytes;
      }
      if (await deliverResult(body)) {
        if (!record.acknowledged) record.acknowledgedAt = Date.now();
        record.acknowledged = true;
      }
      record.queued = false;
    }
  } finally {
    requestWorkerRunning = false;
    if (requestQueue.length) void requestWorker();
  }
}

async function bridgeLoop() {
  for (;;) {
    pruneRequestRecords();
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
