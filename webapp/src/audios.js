import { fetchAudios, uploadAudio, deleteAudio } from './rest-client.js';
import { EventType } from './sse-client.js';

export async function refreshAudioList() {
    try {
        const audioContainer = document.getElementById("audio-container");
        const { audios = [] } = await fetchAudios();

        audioContainer.innerHTML = "";

        if (audios.length > 0) {
            const audioList = document.createElement("ul");
            audios.forEach(audio => {
                const li = document.createElement("li");
                li.textContent = `${audio.id}: ${audio.title}`;

                if (!audio.readonly) {
                    const deleteBtn = document.createElement("button");
                    deleteBtn.textContent = "Delete";
                    deleteBtn.classList.add("delete-btn");
                    deleteBtn.addEventListener("click", async () => {
                        if (confirm(`Are you sure you want to delete "${audio.title}"?`)) {
                            try {
                                await deleteAudio(audio.id);
                                alert(`Audio "${audio.title}" deleted successfully.`);
                                await refreshAudioList();
                            } catch (err) {
                                console.error("Failed to delete audio:", err);
                                alert("Failed to delete audio.");
                            }
                        }
                    });
                    li.appendChild(deleteBtn);
                }

                audioList.appendChild(li);
            });
            audioContainer.appendChild(audioList);
        }
    } catch (err) {
        console.error("Error loading audios:", err);
    }
}

export async function initializeAudiosTab() {
    const audioForm = document.getElementById("audio-form");
    const audioContainer = document.getElementById("audio-container");

    audioForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const file = document.getElementById("audio-file").files[0];
        const title = document.getElementById("audio-title").value;
        const codec = document.getElementById("audio-codec").value;

        console.debug("Form submit:", { file, title, codec });

        if (!file || !title || !codec) {
            console.debug("Missing required fields", { file, title, codec });
            return;
        }

        try {
            await uploadAudio(file, codec, title);
            console.debug("Upload successful");
            audioForm.reset();
            await refreshAudioList();
        } catch (err) {
            console.error("Upload failed:", err);
            alert("Upload failed");
        }
    });

    await refreshAudioList();
}

document.addEventListener(EventType.AudioAdded, async ({ detail: { id } }) => {
    refreshAudioList();
    console.log('Audio added:', id);
});

document.addEventListener(EventType.AudioDeleted, async ({ detail: { id } }) => {
    refreshAudioList();
    console.log('Audio deleted:', id);
});