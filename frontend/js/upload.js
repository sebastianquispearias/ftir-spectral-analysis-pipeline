function initUploadZone(dropZoneEl, fileInputEl, onFilesSelected) {
  dropZoneEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZoneEl.classList.add("drag-over");
  });

  dropZoneEl.addEventListener("dragleave", () => {
    dropZoneEl.classList.remove("drag-over");
  });

  dropZoneEl.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZoneEl.classList.remove("drag-over");
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.name.endsWith(".dpt")
    );
    if (files.length > 0) onFilesSelected(files);
  });

  dropZoneEl.addEventListener("click", () => fileInputEl.click());

  fileInputEl.addEventListener("change", () => {
    const files = Array.from(fileInputEl.files).filter((f) =>
      f.name.endsWith(".dpt")
    );
    if (files.length > 0) onFilesSelected(files);
    fileInputEl.value = "";
  });
}
