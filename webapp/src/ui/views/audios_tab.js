import { uploadAudio, deleteAudio } from '../../apis/rest-client.js';
import { SSETypes } from "../../common/sse-types.js";
import { audios, loadAudios } from '../../models/audios.js';

// --- Ensure UI event listeners are only added once ---
let audiosTabListenersAdded = false;

export async function refreshAudioList() {
    try {
        const audioContainer = document.getElementById("audio-container");

        audioContainer.innerHTML = "";

        audios
            .slice()
            .sort((a, b) => a.id - b.id)
            .forEach(audio => {
                const tr = document.createElement("tr");

                // ID cell
                const tdId = document.createElement("td");
                tdId.textContent = audio.id;
                tdId.className = "id-cell";
                tr.appendChild(tdId);

                // Title cell
                const tdTitle = document.createElement("td");
                tdTitle.textContent = audio.title;
                tdTitle.className = "title-cell";
                tr.appendChild(tdTitle);

                // Delete button cell
                const tdDelete = document.createElement("td");
                if (!audio.readonly) {
                    const deleteBtn = document.createElement("button");
                    deleteBtn.textContent = "Delete";
                    deleteBtn.classList.add("delete-btn");
                    deleteBtn.addEventListener("click", async () => {
                        if (confirm(`Are you sure you want to delete "${audio.title}"?`)) {
                            try {
                                await deleteAudio(audio.id);
                                alert(`Audio "${audio.title}" deleted successfully.`);
                            } catch (err) {
                                console.error("Failed to delete audio:", err);
                                alert("Failed to delete audio.");
                            }
                        }
                    });
                    tdDelete.appendChild(deleteBtn);
                }
                tr.appendChild(tdDelete);

                // JSON button cell
                const tdJson = document.createElement("td");
                const showJsonBtn = document.createElement("button");
                showJsonBtn.textContent = "JSON";
                showJsonBtn.classList.add("primary");
                showJsonBtn.addEventListener("click", () => {
                    const raw = JSON.stringify(audio, null, 2);
                    const blob = new Blob([raw], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    window.open(url, '_blank');
                });
                tdJson.appendChild(showJsonBtn);
                tr.appendChild(tdJson);

                audioContainer.appendChild(tr); // append to tbody
            });
    } catch (err) {
        console.error("Error loading audios:", err);
    }
}

export async function initializeAudiosTab() {
    const audioFileInput = document.getElementById("audio-file");
    const audioTitleInput = document.getElementById("audio-title");
    const audioForm = document.getElementById("audio-form");

    if (!audiosTabListenersAdded) {
        audioFileInput.addEventListener("change", onAudioFileInputChange);
        audioForm.addEventListener("submit", onAudioFormSubmit);
        audiosTabListenersAdded = true;
    }

    await refreshAudioList();
}

// Named handler functions for UI events
function onAudioFileInputChange() {
    const audioFileInput = document.getElementById("audio-file");
    const audioTitleInput = document.getElementById("audio-title");
    const file = audioFileInput.files[0];
    if (file) {
        const lastDotIndex = file.name.lastIndexOf(".");
        const nameWithoutExt = lastDotIndex > 0 ? file.name.substring(0, lastDotIndex) : file.name;
        audioTitleInput.value = nameWithoutExt;
    }
}

async function onAudioFormSubmit(e) {
    e.preventDefault();

    const file = document.getElementById("audio-file").files[0];
    const title = document.getElementById("audio-title").value;
    const codec = document.getElementById("audio-codec").value;

    if (!file || !title || !codec) {
        return;
    }

    try {
        await uploadAudio(file, codec, title);
        e.target.reset();
    } catch (err) {
        console.error("Upload failed:", err);
        alert("Upload failed");
    }
}

// --- Ensure global listeners are only added once ---
if (!window._audiosTabGlobalListenersAdded) {
    async function onAudioAdded({ detail: { id } }) {
        await loadAudios();
        await refreshAudioList();
        console.log('Audio added:', id);
    }
    async function onAudioDeleted({ detail: { id } }) {
        await loadAudios();
        await refreshAudioList();
        console.log('Audio deleted:', id);
    }
    document.addEventListener(SSETypes.AudioAdded, onAudioAdded);
    document.addEventListener(SSETypes.AudioDeleted, onAudioDeleted);
    window._audiosTabGlobalListenersAdded = true;
}

