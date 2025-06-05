import { renderTimeline } from './timeline.js';

export function initializeUploadProgramTab() {
    const programFileInput = document.getElementById("program-file");
    const timelineWrapperSection = document.getElementById("upload-programs-timeline-wrapper");
    const timeline = document.getElementById("upload-programs-timeline");

    // Event listener for file selection
    programFileInput.addEventListener("change", (e) => {
        const file = e.target.files[0]; // Access the selected file
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const program = JSON.parse(event.target.result);
            renderTimeline(timeline, program); // Render timeline
            timelineWrapperSection.classList.remove("hidden"); // Show timeline section
        };
        reader.readAsText(file);
    });
}