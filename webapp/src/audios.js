import { fetchAudios, uploadAudio, deleteAudio } from './rest-client.js';
import { EventType } from './sse-client.js';

export async function refreshAudioList() {
    try {
        const audioContainer = document.getElementById("audio-container");

        const { builtin = [], uploaded = [] } = await fetchAudios();

        audioContainer.innerHTML = "";

        // Add Built-in audios
        if (builtin.length > 0) {
            const builtinHeader = document.createElement("h3");
            builtinHeader.textContent = "Built-in:";
            audioContainer.appendChild(builtinHeader);

            const builtinList = document.createElement("ul");
            builtin.forEach(audio => {
                const li = document.createElement("li");
                li.textContent = `${audio.id}: ${audio.title}`;
                builtinList.appendChild(li);
            });
            audioContainer.appendChild(builtinList);
        }

        // Add Uploaded audios
        if (uploaded.length > 0) {
            const uploadedHeader = document.createElement("h3");
            uploadedHeader.textContent = "Uploaded:";
            audioContainer.appendChild(uploadedHeader);

            const uploadedList = document.createElement("ul");
            uploaded.forEach(audio => {
                const li = document.createElement("li");
                li.textContent = `${audio.id}: ${audio.title}`;

                // Add delete button
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
                uploadedList.appendChild(li);
            });
            audioContainer.appendChild(uploadedList);
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

document.addEventListener(EventType.AudioUploaded, ({ detail: { id } }) => {
    refreshAudioList();
    console.log('Audio uploaded:', id);
});

document.addEventListener(EventType.AudioDeleted, ({ detail: { id } }) => {
    refreshAudioList();
    console.log('Audio deleted:', id);
});