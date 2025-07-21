import { uploadAudio, deleteAudio } from '../../apis/rest-client.js';
import { SSETypes } from "../../common/sse-types.js";
import { audios, loadAudios } from '../../models/audios.js';

// Cache DOM elements at the top
const audioFileInput = document.getElementById("audio-file");
const audioTitleInput = document.getElementById("audio-title");
const audioForm = document.getElementById("audio-form");
const audioContainer = document.getElementById("audio-container");

// --- Ensure UI event listeners are only added once ---
let audiosTabListenersAdded = false;

// Event delegation for dynamic audio rows (Delete, JSON)
function onAudioContainerClick(e) {
    const target = e.target;
    const tr = target.closest("tr");
    if (!tr) return;
    const id = tr.querySelector(".id-cell")?.textContent;
    const audioTitle = tr.querySelector(".title-cell")?.textContent;

    if (target.classList.contains("delete-btn")) {
        if (confirm(`Are you sure you want to delete "${audioTitle}"?`)) {
            deleteAudio(id)
                .then(() => {
                    alert(`Audio "${audioTitle}" deleted successfully.`);
                    // Do NOT call loadAudios() or refreshAudioList() here
                })
                .catch(err => {
                    console.error("Failed to delete audio:", err);
                    alert("Failed to delete audio.");
                });
        }
    }
    if (target.classList.contains("primary") && target.textContent === "JSON") {
        const audio = audios.find(a => a.id == id);
        if (audio) {
            const raw = JSON.stringify(audio, null, 2);
            const blob = new Blob([raw], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
        }
    }
}

export async function refreshAudioList() {
    try {
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
                    tdDelete.appendChild(deleteBtn);
                }
                tr.appendChild(tdDelete);

                // JSON button cell
                const tdJson = document.createElement("td");
                const showJsonBtn = document.createElement("button");
                showJsonBtn.textContent = "JSON";
                showJsonBtn.classList.add("primary");
                tdJson.appendChild(showJsonBtn);
                tr.appendChild(tdJson);

                audioContainer.appendChild(tr); // append to tbody
            });
    } catch (err) {
        console.error("Error loading audios:", err);
    }
}

export async function initializeAudiosTab() {
    if (!audiosTabListenersAdded) {
        audioFileInput.addEventListener("change", onAudioFileInputChange);
        audioForm.addEventListener("submit", onAudioFormSubmit);

        // Use event delegation for all row actions
        audioContainer.addEventListener("click", onAudioContainerClick);

        audiosTabListenersAdded = true;
    }

    await refreshAudioList();
}

// Named handler functions for UI events
function onAudioFileInputChange() {
    const file = audioFileInput.files[0];
    if (file) {
        const lastDotIndex = file.name.lastIndexOf(".");
        const nameWithoutExt = lastDotIndex > 0 ? file.name.substring(0, lastDotIndex) : file.name;
        audioTitleInput.value = nameWithoutExt;
    }
}

async function onAudioFormSubmit(e) {
    e.preventDefault();

    const file = audioFileInput.files[0];
    const title = audioTitleInput.value;
    const codec = document.getElementById("audio-codec").value;

    if (!file || !title || !codec) {
        return;
    }

    try {
        await uploadAudio(file, codec, title);
        e.target.reset();
        await loadAudios();
        await refreshAudioList();
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

