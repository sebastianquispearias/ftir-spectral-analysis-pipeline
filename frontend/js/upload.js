function initUploadZone(dropZoneEl, fileInputEl, folderInputEl, onFilesSelected) {
  dropZoneEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZoneEl.classList.add("drag-over");
  });

  dropZoneEl.addEventListener("dragleave", () => {
    dropZoneEl.classList.remove("drag-over");
  });

  dropZoneEl.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropZoneEl.classList.remove("drag-over");
    const items = e.dataTransfer.items;
    if (!items || items.length === 0) return;

    const entries = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
      if (entry) entries.push(entry);
    }

    if (entries.length > 0) {
      const { dptFiles, ignored, source } = await _collectDptFromEntries(entries);
      _dispatchFiles(dptFiles, ignored, source, onFilesSelected);
    } else {
      const files = Array.from(e.dataTransfer.files).filter((f) => f.name.endsWith(".dpt"));
      _dispatchFiles(files, 0, null, onFilesSelected);
    }
  });

  dropZoneEl.addEventListener("click", (e) => {
    if (e.target.closest("#upload-mode-toggle")) return;
    fileInputEl.click();
  });

  fileInputEl.addEventListener("change", () => {
    const files = Array.from(fileInputEl.files).filter((f) => f.name.endsWith(".dpt"));
    _dispatchFiles(files, 0, null, onFilesSelected);
    fileInputEl.value = "";
  });

  folderInputEl.addEventListener("change", () => {
    const allFiles = Array.from(folderInputEl.files);
    const dptFiles = allFiles.filter((f) => f.name.endsWith(".dpt"));
    const ignored = allFiles.length - dptFiles.length;
    const folderName = allFiles.length > 0 && allFiles[0].webkitRelativePath
      ? allFiles[0].webkitRelativePath.split("/")[0]
      : "folder";
    _dispatchFiles(dptFiles, ignored, folderName, onFilesSelected);
    folderInputEl.value = "";
  });
}

function _dispatchFiles(dptFiles, ignored, source, onFilesSelected) {
  if (dptFiles.length === 0) {
    const statusEl = document.querySelector("#upload-status");
    if (statusEl) {
      statusEl.textContent = source
        ? `No .dpt files found in "${source}".`
        : "No .dpt files selected.";
      statusEl.className = "mt-3 text-sm text-amber-600";
    }
    return;
  }
  onFilesSelected(dptFiles, { ignored, source });
}

async function _collectDptFromEntries(entries) {
  const dptFiles = [];
  let ignored = 0;
  let source = null;

  if (entries.length === 1 && entries[0].isDirectory) {
    source = entries[0].name;
  }

  async function traverse(entry) {
    if (entry.isFile) {
      const file = await new Promise((res) => entry.file(res));
      if (file.name.endsWith(".dpt")) {
        dptFiles.push(file);
      } else {
        ignored++;
      }
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res) => reader.readEntries(res));
        for (const child of batch) {
          await traverse(child);
        }
      } while (batch.length > 0);
    }
  }

  for (const entry of entries) {
    await traverse(entry);
  }

  return { dptFiles, ignored, source };
}
