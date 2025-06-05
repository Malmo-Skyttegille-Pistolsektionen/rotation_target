import { renderTimeline, setCurrent, clearCurrent } from './timeline.js';
import {
  fetchPrograms, getProgram, uploadProgram, loadProgram, startProgram,
  stopProgram, skipToSeries, getStatus, fetchAudios, uploadAudio, deleteAudio, toggleTarget
} from './rest-client.js';
import { connectToEventStream, EventType } from './sse-client.js';

document.addEventListener("DOMContentLoaded", async () => {

  // Program state to track the current program and series
  const programState = {
    program_id: null,
    series_running: false, // Updated: Only true when a series is actively running
    current_series_index: null,
    current_event_index: null,
    target_status_shown: false // Changed from string to boolean
  };

  const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
  const appName = "Malmö Skyttegille Rotation Target";
  const appTitle = `${appName} v${appVersion}`;
  document.title = appTitle;
  document.querySelector("#footer span").textContent = appTitle;


  const programSelect = document.getElementById("choose-program");
  const seriesSelect = document.getElementById("choose-serie");
  const showJsonBtn = document.getElementById("show-json");
  const timelineWrapperSection = document.getElementById("timeline-wrapper");

  const startBtn = document.getElementById("start-btn");
  const stopBtn = document.getElementById("stop-btn");
  const turnBtn = document.getElementById("turn-btn");
  const audioForm = document.getElementById("audio-form");


  // Tab switching
  document.getElementById("program-tab-button").addEventListener("click", () => {
    document.getElementById("program-tab-button").classList.add("active");
    document.getElementById("audio-tab-button").classList.remove("active");
    document.getElementById("program-section").classList.remove("hidden");
    document.getElementById("audio-section").classList.add("hidden");
  });

  document.getElementById("audio-tab-button").addEventListener("click", async () => {
    document.getElementById("audio-tab-button").classList.add("active");
    document.getElementById("program-tab-button").classList.remove("active");
    document.getElementById("audio-section").classList.remove("hidden");
    document.getElementById("program-section").classList.add("hidden");
    await refreshAudioList();
  });




  await loadPrograms(programState);

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

      } catch (err) {
        console.error("Failed to fetch program by ID:", err);
      }
    }
  });

  seriesSelect.addEventListener("change", async () => {
    const index = parseInt(seriesSelect.value, 10);
    if (!isNaN(index)) {
      skipToSeries(index)
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
    const result = await toggleTarget();
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
      uploadAudio(file, codec, title)
      document.getElementById("audio-form").reset();
      refreshAudioList();
    } catch (err) {
      console.error("Upload failed:", err);
      alert("Upload failed");
    }
  });

  async function refreshAudioList() {
    try {
      const { builtin = [], uploaded = [] } = await fetchAudios();

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
      [EventType.ProgramUploaded]: ({ program_id }) => {
        programState.program_id = program_id;
        programState.series_running = false; // Reset running state
        programState.current_series_index = 0;
        programState.current_event_index = 0;
        console.log('Program uploaded:', programState);
        showProgramStatus(); // Update status
      },
      [EventType.ProgramStarted]: ({ program_id }) => {
        programState.program_id = program_id;
        programState.series_running = false; // Program started, but no series is running yet
        console.log('Program started:', programState);
        showProgramStatus(); // Update status
      },
      [EventType.SeriesStarted]: ({ program_id, series_index }) => {
        programState.program_id = program_id;
        programState.series_running = true; // Series is actively running
        programState.current_series_index = series_index;
        programState.current_event_index = 0;
        setCurrent(series_index, 0);
        console.log('Series started:', programState);
        showProgramStatus(); // Update status
      },
      [EventType.EventStarted]: ({ program_id, series_index, event_index }) => {
        programState.program_id = program_id;
        programState.current_series_index = series_index;
        programState.current_event_index = event_index;
        setCurrent(series_index, event_index);
        console.log('Event started:', programState);
        showProgramStatus(); // Update status
      },
      [EventType.SeriesCompleted]: ({ program_id, series_index }) => {
        programState.program_id = program_id;
        programState.series_running = false; // Series has completed
        console.log('Series completed:', programState);
        showProgramStatus(); // Update status
      },
      [EventType.SeriesNext]: ({ program_id, series_index }) => {
        programState.program_id = program_id;
        programState.current_series_index = series_index;
        programState.current_event_index = 0;
        setCurrent(series_index, 0);
        console.log('Series next:', programState);
        showProgramStatus(); // Update status
      },
      [EventType.ProgramCompleted]: ({ program_id }) => {
        programState.program_id = program_id;
        programState.series_running = false; // Program is no longer running
        clearCurrent();
        console.log('Program completed:', programState);
        showProgramStatus(); // Update status
      },
      [EventType.TargetStatus]: ({ status }) => {
        programState.target_status_shown = status === 'shown'; // Convert string to boolean
        console.log('Target status updated:', programState);
        showProgramStatus(); // Update status
      },
      [EventType.AudioUploaded]: ({ id }) => {
        refreshAudioList();
        console.log('Audio uploaded:', id);
        showProgramStatus(); // Update status
      },
      [EventType.AudioDeleted]: ({ id }) => {
        refreshAudioList();
        console.log('Audio deleted:', id);
        showProgramStatus(); // Update status
      }
    };

    if (handlers[type]) {
      handlers[type](payload);
    } else {
      console.warn('Unhandled event type:', type, payload);
    }
  });

  async function showProgramStatus() {
    try {
      const status = await getStatus();
      const statusEl = document.getElementById('status');

      // Updated text based on the current structure of the status object
      const text = status.program_id != null
        ? `Program ID: ${status.program_id}, Running: ${status.running_series ? 'Yes' : 'No'}, Current Series: ${status.current_series_index != null ? `S${status.current_series_index}` : 'N/A'}, Current Event: ${status.current_event_index != null ? `E${status.current_event_index}` : 'N/A'}, Target Status: ${status.target_status_shown ? 'Shown' : 'Hidden'}`
        : "No program loaded";

      statusEl.textContent = text;
    } catch (err) {
      console.error("Failed to get status:", err);
      const statusEl = document.getElementById('status');
      statusEl.textContent = "Failed to load status";
    }
  }

  async function loadPrograms(programState) {
    programSelect.innerHTML = ""; // Clear existing options

    // Add default option only if no program_id is selected
    if (!programState || programState.program_id === null) {
      const defaultOpt = document.createElement("option");
      defaultOpt.disabled = true;
      defaultOpt.selected = true;
      defaultOpt.textContent = "Choose a program";
      programSelect.appendChild(defaultOpt);
    }

    try {
      const programs = await fetchPrograms();
      console.log("programs:", programs);
      programs.forEach(({ id, title }) => {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = `${id}: ${title}`;
        programSelect.appendChild(opt);

        // Pre-select the program if programState.program_id matches
        if (programState && programState.program_id === id) {
          opt.selected = true;
        }
      });
    } catch (err) {
      console.error("Error fetching programs:", err);
    }
  }

});

