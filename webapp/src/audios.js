import { fetchAudios, uploadAudio, deleteAudio } from './rest-client.js';
import { SSETypes } from "./common/sse-types.js";

let audios = [];

export async function loadAudios() {
    const data = await fetchAudios();

    audios = data.audios || [];

    return audios;
}

export function getAudioTitleById(id) {
    const audio = audios.find(a => a.id === id);
    return audio.title;
}

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

    audioFileInput.addEventListener("change", () => {
        const file = audioFileInput.files[0];
        if (file) {
            const lastDotIndex = file.name.lastIndexOf(".");
            const nameWithoutExt = lastDotIndex > 0 ? file.name.substring(0, lastDotIndex) : file.name;
            audioTitleInput.value = nameWithoutExt;
        }
    });

    const audioForm = document.getElementById("audio-form");

    audioForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const file = document.getElementById("audio-file").files[0];
        const title = document.getElementById("audio-title").value;
        const codec = document.getElementById("audio-codec").value;

        if (!file || !title || !codec) {
            return;
        }

        try {
            await uploadAudio(file, codec, title);
            audioForm.reset();
        } catch (err) {
            console.error("Upload failed:", err);
            alert("Upload failed");
        }
    });

    await refreshAudioList();
}

document.addEventListener(SSETypes.AudioAdded, async ({ detail: { id } }) => {
    await loadAudios();
    await refreshAudioList();
    console.log('Audio added:', id);
});

document.addEventListener(SSETypes.AudioDeleted, async ({ detail: { id } }) => {
    await loadAudios();
    await refreshAudioList();
    console.log('Audio deleted:', id);
});

