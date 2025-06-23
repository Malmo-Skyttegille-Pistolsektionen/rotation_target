import { renderTimeline } from './timeline.js';
import { EventType } from './sse-client.js';
import { uploadProgram } from './rest-client.js';

export function initializeUploadProgramTab() {
    const programFileInput = document.getElementById("program-file");
    const programUploadForm = document.getElementById("program-upload-form");
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

    // Handle form submission for uploading the program
    programUploadForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const file = programFileInput.files[0];
        if (!file) {
            alert("Please select a program file.");
            return;
        }
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const program = JSON.parse(event.target.result);
                await uploadProgram(program);
                alert("Program uploaded successfully!");
                // Optionally, refresh program list or UI here
            } catch (err) {
                alert("Failed to upload program: " + err.message);
            }
        };
        reader.readAsText(file);
    });
}