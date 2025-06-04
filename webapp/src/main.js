import { renderTimeline, setCurrent, clearCurrent } from './timeline.js';
import {
  fetchPrograms, getProgram, uploadProgram, loadProgram, startProgram,
  stopProgram, skipToSeries, getStatus, fetchAudios, uploadAudio, deleteAudio
} from './rest-client.js';
import { connectToEventStream } from './sse-client.js';

document.addEventListener("DOMContentLoaded", async () => {
  const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
  const appName = "Malmö Skyttegille Rotation Target";
  const appTitle = `${appName} v${appVersion}`;
  document.title = appTitle;

  document.querySelector("#footer span").textContent = appTitle;

  showProgramStatus();
  setInterval(showProgramStatus, 5000);

  // Tab switching
  document.getElementById("program-tab-button").addEventListener("click", () => {
    document.getElementById("program-tab-button").classList.add("active");
    document.getElementById("audio-tab-button").classList.remove("active");
    document.getElementById("program-section").classList.remove("hidden");
    document.getElementById("audio-section").classList.add("hidden");
  });

  document.getElementById("audio-tab-button").addEventListener("click", () => {
    document.getElementById("audio-tab-button").classList.add("active");
    document.getElementById("program-tab-button").classList.remove("active");
    document.getElementById("audio-section").classList.remove("hidden");
    document.getElementById("program-section").classList.add("hidden");
    refreshAudioList();
  });

  const programSelect = document.getElementById("choose-program");
  const seriesSelect = document.getElementById("choose-serie");
  const showJsonBtn = document.getElementById("show-json");
  const timelineWrapperSection = document.getElementById("timeline-wrapper");

  const startBtn = document.getElementById("start-btn");
  const stopBtn = document.getElementById("stop-btn");
  const turnBtn = document.getElementById("turn-btn");
  const audioForm = document.getElementById("audio-form");

  const defaultOpt = document.createElement("option");
  defaultOpt.disabled = true;
  defaultOpt.selected = true;
  defaultOpt.textContent = "Choose a program";
  programSelect.appendChild(defaultOpt);

  try {
    const programs = await fetchPrograms();
    programs.forEach(({ id, title }) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = `${id}: ${title}`;
      programSelect.appendChild(opt);
    });
  } catch (err) {
    console.error("Error fetching programs:", err);
  }

  programSelect.addEventListener("change", async () => {
    const id = parseInt(programSelect.value, 10);
    if (!isNaN(id)) {
      await loadProgram(id);
      try {
        const program = await getProgram(id);
        window.currentProgram = program;
        renderTimeline(program);
        setCurrent(0, 0);

        // Populate series dropdown
        seriesSelect.innerHTML = "";
        const defaultSeriesOpt = document.createElement("option");
        defaultSeriesOpt.disabled = true;
        defaultSeriesOpt.selected = true;
        defaultSeriesOpt.textContent = "Choose a series";
        seriesSelect.appendChild(defaultSeriesOpt);

        program.series.forEach((s, index) => {
          const opt = document.createElement("option");
          opt.value = index;
          opt.textContent = s.name + (s.optional ? ' (optional)' : '');
          seriesSelect.appendChild(opt);
        });

        // Make elements visible
        seriesSelect.classList.remove("hidden");
        showJsonBtn.classList.remove("hidden");
        timelineWrapperSection.classList.remove("hidden");

        // Enable start and stop buttons
        startBtn.disabled = false;
        stopBtn.disabled = false;

        // show debug info
        showProgramStatus();

      } catch (err) {
        console.error("Failed to fetch program by ID:", err);
      }
    }
  });

  seriesSelect.addEventListener("change", async () => {
    const index = parseInt(seriesSelect.value, 10);
    if (!isNaN(index)) {
      await fetch("/programs/skip_to", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ series_index: index })
      });
    }
  });

  showJsonBtn.addEventListener("click", () => {
    if (window.currentProgram) {
      const raw = JSON.stringify(window.currentProgram, null, 2);
      const blob = new Blob([raw], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    }
  });

  startBtn.addEventListener("click", async () => {
    await startProgram();
  });

  stopBtn.addEventListener("click", async () => {
    await stopProgram();
  });

  turnBtn.addEventListener("click", async () => {
    await turnTargets();
  });

  audioForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const file = document.getElementById("audio-file").files[0];
    const title = document.getElementById("audio-title").value;
    const codec = document.getElementById("audio-codec").value;

    if (!file || !title || !codec) return;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", title);
    formData.append("codec", codec);

    try {
      const res = await fetch("/audios/upload", {
        method: "POST",
        body: formData
      });

      if (!res.ok) throw new Error("Upload failed");
      document.getElementById("audio-form").reset();
      await refreshAudioList();
    } catch (err) {
      console.error("Upload failed:", err);
      alert("Upload failed");
    }
  });

  async function refreshAudioList() {
    try {
      const res = await fetchAudios();
      const { builtin = [], uploaded = [] } = await res.json();

      const container = document.getElementById("audio-container");
      container.innerHTML = "";

      // Add Built-in audios
      if (builtin.length > 0) {
        const builtinHeader = document.createElement("h3");
        builtinHeader.textContent = "Built-in:";
        container.appendChild(builtinHeader);

        const builtinList = document.createElement("ul");
        builtin.forEach(audio => {
          const li = document.createElement("li");
          li.textContent = `${audio.id}: ${audio.title}`;
          builtinList.appendChild(li);
        });
        container.appendChild(builtinList);
      }

      // Add Uploaded audios
      if (uploaded.length > 0) {
        const uploadedHeader = document.createElement("h3");
        uploadedHeader.textContent = "Uploaded:";
        container.appendChild(uploadedHeader);

        const uploadedList = document.createElement("ul");
        uploaded.forEach(audio => {
          const li = document.createElement("li");
          li.textContent = `${audio.id}: ${audio.title}`;

          // Add delete button
          const deleteBtn = document.createElement("button");
          deleteBtn.textContent = "Delete";
          deleteBtn.classList.add("delete-btn"); // Add a specific class for delete buttons
          deleteBtn.addEventListener("click", async () => {
            if (confirm(`Are you sure you want to delete "${audio.title}"?`)) {
              try {
                await deleteAudio(audio.id);
                alert(`Audio "${audio.title}" deleted successfully.`);
                await refreshAudioList(); // Refresh the list after deletion
              } catch (err) {
                console.error("Failed to delete audio:", err);
                alert("Failed to delete audio.");
              }
            }
          });

          li.appendChild(deleteBtn);
          uploadedList.appendChild(li);
        });
        container.appendChild(uploadedList);
      }
    } catch (err) {
      console.error("Error loading audios:", err);
    }
  }

  connectToEventStream((type, payload) => {
    const handlers = {
      program_loaded: () => setCurrent(0, 0),
      series_started: () => setCurrent(0, 0),
      event_started: ({ series_index, event_index }) => setCurrent(series_index, event_index),
      series_completed: ({ next_series_index }) => setCurrent(next_series_index, 0),
      series_skipped: ({ next_series_index }) => setCurrent(next_series_index, 0),
      program_completed: () => clearCurrent(),
      audio_uploaded: refreshAudioList,
      audio_deleted: refreshAudioList
    };
    if (handlers[type]) {
      handlers[type](payload);
    }
  });

  async function showProgramStatus() {
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

});
