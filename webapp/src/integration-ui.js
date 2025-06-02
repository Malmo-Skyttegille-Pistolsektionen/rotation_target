import {
  fetchPrograms, getProgram, uploadProgram, loadProgram, startProgram,
  stopProgram, skipToSeries, getStatus, fetchAudios, uploadAudio, deleteAudio
} from './rest-client.js';

function log(msg) {
  console.log('📝', msg);
}

export async function showProgramStatus() {
  try {
    const status = await getStatus();
    const statusEl = document.getElementById('status');
    const text = status.program_id != null
    ? `Program ID: ${status.program_id}, Running: ${status.running}, Next Event: ${status.next_event ? `S${status.next_event.series_index}E${status.next_event.event_index}` : 'N/A'}`
    : "No program loaded";
    statusEl.textContent = text;
  } catch (err) {
    log("Failed to get status");
  }
}

export async function handleAudioUpload(fileInput, codecInput, titleInput) {
  const file = fileInput.files[0];
  const codec = codecInput.value;
  const title = titleInput.value;

  if (!file || !codec || !title) {
    alert("All audio fields are required.");
    return;
  }

  try {
    const res = await uploadAudio({ file, codec, title });
    if (!res.ok) throw new Error("Upload failed");
    alert("Audio uploaded successfully.");
  } catch (err) {
    alert("Upload failed: " + err.message);
  }
}

export async function refreshAudioList(containerId) {
  try {
    const { builtin, uploaded } = await fetchAudios();
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    const list = [...(builtin || []), ...(uploaded || [])];
    list.forEach(audio => {
      const item = document.createElement("li");
      item.textContent = `#${audio.id} - ${audio.title}`;
      if (uploaded.some(a => a.id === audio.id)) {
        const btn = document.createElement("button");
        btn.textContent = "❌";
        btn.onclick = async () => {
          const confirmed = confirm("Delete this audio?");
          if (confirmed) {
            try {
              await deleteAudio(audio.id);
              alert("Deleted.");
              refreshAudioList(containerId);
            } catch (err) {
              alert("Cannot delete audio: " + err.message);
            }
          }
        };
        item.appendChild(btn);
      }
      container.appendChild(item);
    });
  } catch (err) {
    log("Failed to load audio list");
  }
}
