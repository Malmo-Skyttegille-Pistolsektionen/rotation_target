import { renderTimeline } from './timeline.js';
import { SSETypes } from "../../common/sse-types.js";
import { deleteProgram, getPrograms, getProgram, uploadProgram } from '../../apis/rest-client.js';
import { openProgramEditor, saveProgramFromEditor, initializeProgramEditorModal } from './program_editor.js';

// Cache DOM elements
const programFileInput = document.getElementById("program-file");
const addProgramBtn = document.getElementById("add-program-btn");
const programContainer = document.getElementById("programs-container");
const timelineWrapperSection = document.getElementById("upload-programs-timeline-wrapper");
const timeline = document.getElementById("upload-programs-timeline");

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
        programContainer.innerHTML = "";
        const programs = await getPrograms();

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
                    deleteBtn.classList.add("delete-btn", "icon-only");
                    deleteBtn.title = "Delete program";
                    const deleteIcon = document.createElement("img");
                    deleteIcon.src = "public/icons/delete_24_regular.svg";
                    deleteIcon.alt = "Delete";
                    deleteIcon.width = 20;
                    deleteIcon.height = 20;
                    deleteBtn.appendChild(deleteIcon);
                    tdDelete.appendChild(deleteBtn);
                }
                tr.appendChild(tdDelete);

                // Edit button cell
                const tdEdit = document.createElement("td");
                if (!program.readonly) {
                    const editBtn = document.createElement("button");
                    editBtn.classList.add("primary", "edit-btn", "icon-only");
                    editBtn.title = "Edit program";
                    const editIcon = document.createElement("img");
                    editIcon.src = "public/icons/edit_24_regular.svg";
                    editIcon.alt = "Edit";
                    editIcon.width = 20;
                    editIcon.height = 20;
                    editBtn.appendChild(editIcon);
                    tdEdit.appendChild(editBtn);
                }
                tr.appendChild(tdEdit);

                // Update button cell
                const tdUpdate = document.createElement("td");
                if (!program.readonly) {
                    const updateBtn = document.createElement("button");
                    updateBtn.classList.add("primary", "update-btn", "icon-only");
                    updateBtn.title = "Upload/Update program from file";
                    const uploadIcon = document.createElement("img");
                    uploadIcon.src = "public/icons/arrow_upload_24_regular.svg";
                    uploadIcon.alt = "Upload";
                    uploadIcon.width = 20;
                    uploadIcon.height = 20;
                    updateBtn.appendChild(uploadIcon);
                    tdUpdate.appendChild(updateBtn);
                }
                tr.appendChild(tdUpdate);

                // JSON button cell
                const tdJson = document.createElement("td");
                const showJsonBtn = document.createElement("button");
                showJsonBtn.textContent = "JSON";
                showJsonBtn.classList.add("primary", "json-btn");
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
    // Open the WYSIWYG editor for creating a new program
    openProgramEditor();
}

// Event delegation for dynamic program rows
function onProgramContainerClick(e) {
    let target = e.target;
    // If clicked on an img inside a button, get the button instead
    if (target.tagName === 'IMG') {
        target = target.closest('button');
    }
    
    const tr = target.closest("tr");
    if (!tr) return;
    const id = tr.querySelector(".id-cell")?.textContent;
    const programTitle = tr.querySelector(".title-cell")?.textContent;

    if (target && target.classList.contains("delete-btn")) {
        if (confirm(`Are you sure you want to delete "${programTitle}"?`)) {
            deleteProgram(id)
                .then(() => {
                    alert(`Program "${programTitle}" deleted successfully.`);
                    // Do NOT call refreshProgramsList() here; SSE will handle it
                })
                .catch(err => {
                    console.error("Failed to delete program:", err);
                    alert("Failed to delete program.");
                });
        }
    }
    if (target && target.classList.contains("edit-btn")) {
        getProgram(id)
            .then(fullProgram => {
                openProgramEditor(fullProgram);
            })
            .catch(err => {
                alert("Failed to load program for editing.");
                console.error("Failed to load program:", err);
            });
    }
    if (target && target.classList.contains("update-btn")) {
        handleProgramFileInput(id, programTitle);
    }
    if (target && target.classList.contains("json-btn")) {
        getProgram(id)
            .then(fullProgram => {
                const raw = JSON.stringify(fullProgram, null, 2);
                const blob = new Blob([raw], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                window.open(url, '_blank');
            })
            .catch(err => {
                alert("Failed to fetch full program JSON.");
            });
    }
}

export async function initializeProgramsTab() {
    // Initialize the program editor modal with save callback
    initializeProgramEditorModal(async () => {
        const result = saveProgramFromEditor();
        if (result) {
            try {
                await uploadProgram(result.program, result.originalId);
                alert(result.originalId ? 'Program updated successfully!' : 'Program created successfully!');
                await refreshProgramsList();
                document.getElementById('program-editor-modal').classList.add('hidden');
            } catch (err) {
                alert(`Failed to save program: ${err.message}`);
                console.error('Save error:', err);
            }
        }
    });
    
    if (!programsTabListenersAdded) {
        if (addProgramBtn) addProgramBtn.addEventListener("click", onAddProgramClick);

        // Use event delegation for all row actions
        programContainer.addEventListener("click", onProgramContainerClick);

        programsTabListenersAdded = true;
    }

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
const onProgramAddedProgramsTabEL = function ({ detail: { id } }) {
    refreshProgramsList();
    console.log('Program added:', id);
};
const onProgramDeletedProgramsTabEL = function ({ detail: { id } }) {
    console.log('Program deleted:', id);
};
const onProgramUpdatedProgramsTabEL = function ({ detail }) {
    refreshProgramsList();
    console.log('Program updated:', detail?.program_id);
};

if (!window._programsTabGlobalListenersAdded) {
    document.addEventListener(SSETypes.ProgramAdded, onProgramAddedProgramsTabEL);
    document.addEventListener(SSETypes.ProgramDeleted, onProgramDeletedProgramsTabEL);
    document.addEventListener(SSETypes.ProgramUpdated, onProgramUpdatedProgramsTabEL);
    window._programsTabGlobalListenersAdded = true;
}
