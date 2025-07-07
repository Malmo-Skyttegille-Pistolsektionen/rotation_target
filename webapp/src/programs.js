import { renderTimeline } from './timeline.js';
import { EventType } from './sse-client.js';
import { deleteProgram, getPrograms, uploadProgram } from './rest-client.js';

export async function refreshProgramsList() {
    try {
        const programContainer = document.getElementById("programs-container");
        const programs = await getPrograms();

        programContainer.innerHTML = "";

        if (programs.length > 0) {
            const programsList = document.createElement("ul");
            programs
                .slice()
                .sort((a, b) => a.id - b.id)
                .forEach(program => {
                    const li = document.createElement("li");
                    li.textContent = `${program.id}: ${program.title}`;

                    if (!program.readonly) {
                        const deleteBtn = document.createElement("button");
                        deleteBtn.textContent = "Delete";
                        deleteBtn.classList.add("delete-btn");
                        deleteBtn.addEventListener("click", async () => {
                            if (confirm(`Are you sure you want to delete "${program.title}"?`)) {
                                try {
                                    await deleteProgram(program.id);
                                    alert(`Program "${program.title}" deleted successfully.`);
                                    await refreshProgramsList();
                                } catch (err) {
                                    console.error("Failed to delete program:", err);
                                    alert("Failed to delete program.");
                                }
                            }
                        });
                        li.appendChild(deleteBtn);
                    }

                    // Add Show JSON button for every program
                    const showJsonBtn = document.createElement("button");
                    showJsonBtn.textContent = "JSON";
                    showJsonBtn.classList.add("show-json-btn");
                    showJsonBtn.addEventListener("click", () => {
                        const raw = JSON.stringify(program, null, 2);
                        const blob = new Blob([raw], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        window.open(url, '_blank');
                    });
                    li.appendChild(showJsonBtn);

                    programsList.appendChild(li);
                });
            programContainer.appendChild(programsList);
        }
    } catch (err) {
        console.error("Error loading programs:", err);
    }
}

export async function initializeProgramsTab() {
    const programFileInput = document.getElementById("program-file");
    const programUploadForm = document.getElementById("program-upload-form");
    const timelineWrapperSection = document.getElementById("upload-programs-timeline-wrapper");
    const timeline = document.getElementById("upload-programs-timeline");

    // Event listener for file selection
    programFileInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const program = JSON.parse(event.target.result);
            renderTimeline(timeline, program);
            timelineWrapperSection.classList.remove("hidden");
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
            } catch (err) {
                alert("Failed to upload program: " + err.message);
            }
        };
        reader.readAsText(file);
    });

    await refreshProgramsList();
}

document.addEventListener(EventType.ProgramAdded, async ({ detail: { id } }) => {
    await refreshProgramsList();
    console.log('Program added:', id);
});

document.addEventListener(EventType.ProgramDeleted, async ({ detail: { id } }) => {
    await refreshProgramsList();
    console.log('Program deleted:', id);
});