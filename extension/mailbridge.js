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

function folderShownInMailTab(folder) {
  try {
    for (const win of Services.wm.getEnumerator("mail:3pane")) {
      const tabmail = win.document.getElementById("tabmail");
      for (const tab of tabmail?.tabInfo || []) {
        let shown = null;
        try { shown = tab.folder || tab.chromeBrowser?.contentWindow?.gFolder || null; } catch (_) {}
        if (shown && shown.URI === folder.URI) return true;
      }
    }
  } catch (_) {}
  return false;
}

function repairResult(fields) {
  return {
    error: "",
    busy: false,
    started: false,
    completed: false,
    beforeTotal: -1,
    afterTotal: -1,
    offlineStoreRemoved: false,
    ...fields,
  };
}

function folderTotal(folder) {
  try { return Number(folder.getTotalMessages(false)); } catch (_) { return -1; }
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

        // Ask the server for the folder's current state (IMAP SELECT/FETCH)
        // so post-move verification sees the synchronized view rather than
        // Thunderbird's optimistic local move.
        async refreshFolder(accountId, path) {
          const folder = context.extension.folderManager.get(accountId, path);
          if (!folder) {
            throw new Error(`Nie znaleziono natywnego folderu Thunderbird: ${accountId} ${path}`);
          }
          if (typeof folder.updateFolderWithListener === "function") {
            await runFolderUrl(
              listener => folder.updateFolderWithListener(null, listener),
              "odświeżania folderu",
              20000
            );
          } else {
            folder.updateFolder(null);
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
          return true;
        },

        // The same steps as Folder Properties > Repair Folder
        // (about3Pane.js rebuildSummary): drop the local index (.msf) and,
        // for IMAP, the local offline cache, then let Thunderbird rebuild
        // them from the server (IMAP) or by reparsing the mbox (local).
        // Server messages and local mbox contents are never deleted. Every
        // precondition refuses before anything is touched.
        async repairFolder(accountId, path) {
          const name = path;
          try {
            const folder = context.extension.folderManager.get(accountId, path);
            if (!folder) {
              return repairResult({ error: `Nie znaleziono natywnego folderu Thunderbird: ${accountId} ${path}` });
            }
            const label = folder.localizedName || folder.name || name;
            if (folder.isServer || !folder.parent) {
              return repairResult({ error: "Folderu głównego konta nie można naprawić przez bridge." });
            }
            if (folder.getFlag(Components.interfaces.nsMsgFolderFlags.Virtual)) {
              return repairResult({ error: `Folder „${label}” to wyszukiwanie zapisane; nie ma czego naprawiać.` });
            }
            if (Services.io.offline) {
              return repairResult({ busy: true, error: "Thunderbird pracuje w trybie offline; naprawa folderu wymaga połączenia z serwerem. Nic nie zmieniono — przełącz Thunderbirda w tryb online i spróbuj ponownie." });
            }
            if (folder.locked) {
              return repairResult({
                busy: true,
                error: `Folder „${label}” jest zajęty: inny proces ma do niego dostęp (Thunderbird właśnie pobiera, przenosi, kompaktuje lub indeksuje wiadomości). ` +
                  "Naprawa nie została uruchomiona i nic nie zmieniono — spróbuj ponownie za kilka minut.",
              });
            }
            let pendingOfflineOps = 0;
            try {
              const db = folder.msgDatabase;
              if (db && typeof db.listAllOfflineOpIds === "function") pendingOfflineOps = db.listAllOfflineOpIds().length;
            } catch (_) {}
            if (pendingOfflineOps > 0) {
              return repairResult({
                busy: true,
                error: `Folder „${label}” ma ${pendingOfflineOps} niewysłanych operacji offline; naprawa mogłaby je utracić. ` +
                  "Nic nie zmieniono — poczekaj, aż Thunderbird zsynchronizuje folder, i spróbuj ponownie później.",
              });
            }
            if (folderShownInMailTab(folder)) {
              return repairResult({
                busy: true,
                error: `Folder „${label}” jest otwarty w karcie Thunderbirda. Nic nie zmieniono — przełącz widok na inny folder i spróbuj ponownie.`,
              });
            }
            let store = null;
            try { store = folder.supportsOffline ? folder.filePath : null; } catch (_) { store = null; }
            if (store && store.exists() && store.isDirectory()) {
              return repairResult({
                error: `Folder „${label}” używa magazynu maildir; bridge naprawia tylko magazyn mbox. Nic nie zmieniono — użyj Właściwości folderu > Napraw folder w Thunderbirdzie.`,
              });
            }

            const beforeTotal = folderTotal(folder);
            let offlineStoreRemoved = false;
            if (store && store.exists()) {
              // Local copy of server messages only; the server keeps them.
              store.remove(false);
              offlineStoreRemoved = true;
            }
            MailServices.mfn.notifyFolderReindexTriggered(folder);
            const db = folder.msgDatabase;
            db.summaryValid = false;
            try {
              folder.closeAndBackupFolderDB("");
            } catch (_) {
              folder.ForceDBClosed();
            }

            let completed = true;
            let rebuildError = "";
            const imap = folder.server?.type === "imap";
            if (imap && typeof folder.updateFolderWithListener === "function") {
              try {
                await runFolderUrl(
                  listener => folder.updateFolderWithListener(null, listener),
                  "przebudowy indeksu folderu",
                  5 * 60 * 1000
                );
              } catch (error) {
                completed = false;
                rebuildError = String(error?.message || error);
              }
            } else {
              folder.updateFolder(null);
            }
            // A local mbox reparse runs asynchronously while the folder is locked.
            const deadline = Date.now() + 5 * 60 * 1000;
            for (;;) {
              let locked = false;
              try { locked = folder.locked; } catch (_) {}
              if (!locked) break;
              if (Date.now() >= deadline) {
                completed = false;
                break;
              }
              await new Promise(resolve => setTimeout(resolve, 500));
            }
            return repairResult({
              started: true,
              completed,
              beforeTotal,
              afterTotal: folderTotal(folder),
              offlineStoreRemoved,
              error: rebuildError,
            });
          } catch (error) {
            return repairResult({ error: describeExperimentError(error) });
          }
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
