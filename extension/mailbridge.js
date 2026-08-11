var { setTimeout, clearTimeout } = ChromeUtils.importESModule(
  "resource://gre/modules/Timer.sys.mjs"
);
var { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs"
);

async function runFolderUrl(start, label, timeoutMs = 90000) {
  await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Timeout podczas ${label}.`));
    }, timeoutMs);

    const listener = {
      onStartRunningUrl() {},
      onStopRunningUrl(url, status) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (Components.isSuccessCode(status)) {
          resolve();
        } else {
          reject(new Error(`${label} nie powiódł się: 0x${Number(status >>> 0).toString(16)}`));
        }
      },
      QueryInterface: ChromeUtils.generateQI(["nsIUrlListener"]),
    };

    try {
      start(listener);
    } catch (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`${label}: ${String(error?.message || error)}`));
    }
  });
}

function startObservedFolderUrl(start, label) {
  let operationError = null;
  const listener = {
    onStartRunningUrl() {},
    onStopRunningUrl(url, status) {
      if (!Components.isSuccessCode(status)) {
        operationError = new Error(`${label} nie powiodło się: 0x${Number(status >>> 0).toString(16)}`);
      }
    },
    QueryInterface: ChromeUtils.generateQI(["nsIUrlListener"]),
  };
  start(listener);
  return () => operationError;
}

function describeExperimentError(error) {
  const details = [
    error?.name && `name=${error.name}`,
    error?.message && `message=${error.message}`,
    error?.result !== undefined && `result=0x${Number(error.result >>> 0).toString(16)}`,
    error?.stack && `stack=${error.stack}`,
  ].filter(Boolean);
  return details.length ? details.join("\n") : String(error);
}

async function waitForDirectChild(parent, name, shouldExist, label, getOperationError = null) {
  const deadline = Date.now() + 75000;
  for (;;) {
    try { parent.updateFolder(null); } catch (_) {}
    const found = Boolean(parent.subFolders.find(folder =>
      folder.name === name || folder.localizedName === name
    ));
    if (found === shouldExist) return true;
    const operationError = getOperationError?.();
    if (operationError) throw operationError;
    if (Date.now() >= deadline) {
      throw new Error(`Timeout podczas ${label}: Thunderbird nie odświeżył drzewa folderów.`);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

var mailbridge = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    return {
      mailbridge: {
        async renameFolderAndRefresh(accountId, path, newName) {
          try {
            const folder = context.extension.folderManager.get(accountId, path);
            if (!folder) {
              throw new Error(`Nie znaleziono natywnego folderu do zmiany nazwy: ${accountId} ${path}`);
            }
            if (folder.isServer || !folder.parent) {
              throw new Error("Folder główny konta nie może zostać przemianowany.");
            }
            const parent = folder.parent;
            const oldName = folder.name;
            const existing = parent.subFolders.find(item => item.name === newName || item.localizedName === newName);
            if (existing && existing.URI !== folder.URI) {
              throw new Error(`Folder ${newName} już istnieje.`);
            }
            if (folder.server?.type === "imap") {
              // A newly-created IMAP mailbox can be visible in the extension
              // API before the server is ready to accept RENAME for it.
              try { folder.updateFolder(null); } catch (_) {}
              await new Promise(resolve => setTimeout(resolve, 1500));
              // Call the atomic IMAP RENAME command directly with our own URL
              // listener. folder.rename() installs the folder itself as the
              // listener; on Gmail label-backed folders TB 153 either loses that
              // completion or reduces the failure to "An unexpected error".
              const getOperationError = startObservedFolderUrl(
                listener => MailServices.imap.renameLeaf(folder, newName, listener, null),
                "zmiany nazwy folderu IMAP"
              );
              await waitForDirectChild(parent, newName, true, "zmiany nazwy folderu IMAP", getOperationError);
            } else {
              folder.rename(newName, null);
              await waitForDirectChild(parent, newName, true, "zmiany nazwy folderu");
            }
            await waitForDirectChild(parent, oldName, false, "usuwania starej nazwy folderu IMAP");
            return "";
          } catch (error) {
            return describeExperimentError(error);
          }
        },

        async compactAndRefresh(accountId, path) {
          const folder = context.extension.folderManager.get(accountId, path);
          if (!folder) {
            throw new Error(`Nie znaleziono natywnego folderu Thunderbird: ${accountId} ${path}`);
          }

          let beforeBytes = 0;
          try { beforeBytes = Number(folder.filePath?.fileSize) || 0; } catch (_) {}
          let beforeExpungedBytes = 0;
          try { beforeExpungedBytes = Number(folder.expungedBytes) || 0; } catch (_) {}
          if (beforeExpungedBytes <= 0) {
            return {
              beforeBytes,
              afterBytes: beforeBytes,
              reclaimedBytes: 0,
              beforeExpungedBytes,
              afterExpungedBytes: beforeExpungedBytes,
              skipped: true,
            };
          }

          let terminalStatus = null;
          const listener = {
            onStartRunningUrl() {},
            onStopRunningUrl(url, status) { terminalStatus = Number(status); },
            QueryInterface: ChromeUtils.generateQI(["nsIUrlListener"]),
          };
          folder.compact(listener, null);

          // TB 153 can finish rewriting the mbox and reset expungedBytes but
          // omit the URL-listener callback. Observe the authoritative folder
          // state as a fallback instead of timing out after successful I/O.
          const deadline = Date.now() + 10 * 60 * 1000;
          let lastObservedBytes = beforeBytes;
          let stableShrunkSamples = 0;
          for (;;) {
            let afterExpungedBytes = beforeExpungedBytes;
            try { afterExpungedBytes = Number(folder.expungedBytes) || 0; } catch (_) {}
            let observedBytes = beforeBytes;
            try { observedBytes = Number(folder.filePath?.fileSize) || 0; } catch (_) {}
            if (observedBytes < beforeBytes && observedBytes === lastObservedBytes) {
              stableShrunkSamples++;
            } else {
              stableShrunkSamples = 0;
            }
            lastObservedBytes = observedBytes;
            if (terminalStatus !== null && !Components.isSuccessCode(terminalStatus)) {
              throw new Error(`IMAP EXPUNGE/compact failed: 0x${Number(terminalStatus >>> 0).toString(16)}`);
            }
            if (terminalStatus !== null || afterExpungedBytes <= 0 || stableShrunkSamples >= 4) break;
            if (Date.now() >= deadline) {
              throw new Error("IMAP EXPUNGE/compact timed out: Thunderbird did not finish compaction.");
            }
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          try { folder.updateFolder(null); } catch (_) {}
          await new Promise((resolve) => setTimeout(resolve, 1500));
          let afterBytes = 0;
          try { afterBytes = Number(folder.filePath?.fileSize) || 0; } catch (_) {}
          let afterExpungedBytes = 0;
          try { afterExpungedBytes = Number(folder.expungedBytes) || 0; } catch (_) {}
          return {
            beforeBytes,
            afterBytes,
            reclaimedBytes: Math.max(0, beforeBytes - afterBytes),
            beforeExpungedBytes,
            afterExpungedBytes,
            skipped: false,
          };
        },

        async emptyTrashAndRefresh(accountId, path) {
          const trashFolder = context.extension.folderManager.get(accountId, path);
          if (!trashFolder) {
            throw new Error(`Nie znaleziono natywnego folderu Thunderbird: ${accountId} ${path}`);
          }
          const rootFolder = trashFolder.rootFolder || trashFolder.server?.rootFolder;
          if (!rootFolder || typeof rootFolder.emptyTrash !== "function") {
            throw new Error("Natywne emptyTrash() nie jest dostępne dla tego konta.");
          }

          // This is Thunderbird's real IMAP empty-trash operation. For IMAP,
          // core calls DeleteAllMessages() on the server-side Trash folder.
          await runFolderUrl((listener) => rootFolder.emptyTrash(listener), "IMAP Empty Trash");
          try { trashFolder.updateFolder(null); } catch (_) {}
          await new Promise((resolve) => setTimeout(resolve, 2000));
          return true;
        },

        async deleteFolderAndRefresh(accountId, path) {
          try {
            const folder = context.extension.folderManager.get(accountId, path);
            if (!folder) {
              // Idempotent retry: the previous server operation may have
              // succeeded even if its completion notification was lost.
              return "";
            }
            if (folder.isServer || !folder.parent) {
              throw new Error("Folder główny konta nie może zostać usunięty.");
            }

            const parent = folder.parent;
            const oldName = folder.name;
            if (folder.server?.type === "imap") {
              // Mirror nsImapMailFolder::DeleteSelf's permanent-delete branch.
              // Calling the service alone leaves the local tree entry behind;
              // the core implementation follows it with RemoveLocalSelf().
              MailServices.imap.deleteFolder(folder, folder, null);
              // folderManager returns an nsIMsgFolder view. Some Thunderbird
              // builds forward IMAP-only methods through that view, while
              // others require an explicit QueryInterface first.
              const imapFolder = folder.QueryInterface(
                Components.interfaces.nsIMsgImapMailFolder
              );
              imapFolder.removeLocalSelf();
              await waitForDirectChild(parent, oldName, false, "usuwania folderu IMAP");
              await new Promise(resolve => setTimeout(resolve, 1500));
              try { parent.updateFolder(null); } catch (_) {}
              await waitForDirectChild(parent, oldName, false, "weryfikacji usunięcia folderu IMAP");
            } else {
              folder.deleteSelf(null);
              await waitForDirectChild(parent, oldName, false, "usuwania folderu");
            }
            return "";
          } catch (error) {
            return describeExperimentError(error);
          }
        },
      },
    };
  }
};
