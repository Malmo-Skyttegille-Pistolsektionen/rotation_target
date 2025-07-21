import { renderTimeline } from './timeline.js';
import { SSETypes } from "../../common/sse-types.js";
import { deleteProgram, getPrograms, getProgram, uploadProgram } from '../../apis/rest-client.js';

// Make programFileInput accessible everywhere
const programFileInput = document.getElementById("program-file");
const addProgramBtn = document.getElementById("add-program-btn");

// Unified file handler for add/update
function handleProgramFileInput(programId = null, programTitle = null) {
    programFileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const program = JSON.parse(event.target.result);
                await uploadProgram(program, programId);
                alert(
                    programId
                        ? `Program "${programTitle}" updated successfully.`
                        : "Program added successfully!"
                );
                await refreshProgramsList();
            } catch (err) {
                alert(
                    programId
                        ? `Failed to update program: ${err.message}`
                        : `Failed to add program: ${err.message}`
                );
            }
        };
        reader.readAsText(file);
    };
    programFileInput.value = ""; // reset selection
    programFileInput.click();
}

export async function refreshProgramsList() {
    try {
        const programContainer = document.getElementById("programs-container");
        const programs = await getPrograms();

        programContainer.innerHTML = "";

        programs
            .slice()
            .sort((a, b) => a.id - b.id)
            .forEach(program => {
                const tr = document.createElement("tr");

                // ID cell
                const tdId = document.createElement("td");
                tdId.textContent = program.id;
                tdId.className = "id-cell";
                tr.appendChild(tdId);

                // Title cell
                const tdTitle = document.createElement("td");
                tdTitle.textContent = program.title;
                tdTitle.className = "title-cell";
                tr.appendChild(tdTitle);

                // Delete button cell
                const tdDelete = document.createElement("td");
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
                    tdDelete.appendChild(deleteBtn);
                }
                tr.appendChild(tdDelete);

                // Update button cell
                const tdUpdate = document.createElement("td");
                if (!program.readonly) {
                    const updateBtn = document.createElement("button");
                    updateBtn.textContent = "Update";
                    updateBtn.classList.add("primary");
                    updateBtn.addEventListener("click", async () => {
                        handleProgramFileInput(program.id, program.title);
                    });
                    tdUpdate.appendChild(updateBtn);
                }
                tr.appendChild(tdUpdate);

                // JSON button cell
                const tdJson = document.createElement("td");
                const showJsonBtn = document.createElement("button");
                showJsonBtn.textContent = "JSON";
                showJsonBtn.classList.add("primary");
                showJsonBtn.addEventListener("click", async () => {
                    // Fetch the full raw JSON for this program
                    try {
                        const fullProgram = await getProgram(program.id);
                        const raw = JSON.stringify(fullProgram, null, 2);
                        const blob = new Blob([raw], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        window.open(url, '_blank');
                    } catch (err) {
                        alert("Failed to fetch full program JSON.");
                    }
                });
                tdJson.appendChild(showJsonBtn);
                tr.appendChild(tdJson);

                programContainer.appendChild(tr);
            });
    } catch (err) {
        console.error("Error loading programs:", err);
    }
}

// --- Ensure UI event listeners are only added once ---
let programsTabListenersAdded = false;

// Named handler functions for UI events
function onAddProgramClick() {
    handleProgramFileInput();
}

export async function initializeProgramsTab() {
    const addBtn = document.getElementById("add-program-btn");

    if (!programsTabListenersAdded) {
        if (addBtn) addBtn.addEventListener("click", onAddProgramClick);
        programsTabListenersAdded = true;
    }

    const timelineWrapperSection = document.getElementById("upload-programs-timeline-wrapper");
    const timeline = document.getElementById("upload-programs-timeline");

    // Event listener for file selection (for timeline preview)
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

    await refreshProgramsList();
}

// --- Ensure global listeners are only added once ---
if (!window._programsTabGlobalListenersAdded) {
    function onProgramAdded({ detail: { id } }) {
        refreshProgramsList();
        console.log('Program added:', id);
    }
    function onProgramDeleted({ detail: { id } }) {
        refreshProgramsList();
        console.log('Program deleted:', id);
    }
    function onProgramUpdated({ detail }) {
        refreshProgramsList();
        console.log('Program updated:', detail?.program_id);
    }
    document.addEventListener(SSETypes.ProgramAdded, onProgramAdded);
    document.addEventListener(SSETypes.ProgramDeleted, onProgramDeleted);
    document.addEventListener('program_updated', onProgramUpdated);
    window._programsTabGlobalListenersAdded = true;
}
