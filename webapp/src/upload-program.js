import { renderTimeline } from './timeline.js';

export function initializeUploadProgramTab() {
  const programUploadForm = document.getElementById("program-upload-form");
  const uploadedProgramTimelineSection = document.getElementById("uploaded-program-timeline");
  const uploadedTimeline = document.getElementById("uploaded-timeline");

  programUploadForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const file = document.getElementById("program-file").files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const programData = JSON.parse(event.target.result);
        renderTimeline(programData, uploadedTimeline);
        uploadedProgramTimelineSection.classList.remove("hidden");
      } catch (err) {
        console.error("Failed to parse program file:", err);
        alert("Invalid program file.");
      }
    };
    reader.readAsText(file);
  });
}