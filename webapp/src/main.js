import { renderTimeline, setCurrent, clearCurrent } from './visualization.svg.js';
import { getProgram, fetchPrograms, loadProgram, startProgram, stopProgram, turnTargets } from './rest-client.js';
import { connectToEventStream } from './sse-client.js';

document.addEventListener("DOMContentLoaded", async () => {
  const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
  const appName = "Malmö Skyttegille Rotation Target";
  const appTitle = `${appName} v${appVersion}`;
  document.title = appTitle;

  const footer = document.getElementById("footer").textContent = appTitle;

  // // Tab switching
  // document.getElementById("program-tab-button").addEventListener("click", () => {
  //   document.getElementById("program-tab-button").classList.add("active");
  //   document.getElementById("audio-tab-button").classList.remove("active");
  //   document.getElementById("program-section").classList.remove("hidden");
  //   document.getElementById("audio-section").classList.add("hidden");
  // });

  // document.getElementById("audio-tab-button").addEventListener("click", () => {
  //   document.getElementById("audio-tab-button").classList.add("active");
  //   document.getElementById("program-tab-button").classList.remove("active");
  //   document.getElementById("audio-section").classList.remove("hidden");
  //   document.getElementById("program-section").classList.add("hidden");
  //   refreshAudioList();
  // });

  const programSelect = document.getElementById("choose-program");
  const seriesSelect = document.getElementById("choose-serie");
  const showJsonBtn = document.getElementById("show-json");
  const timelineWrapperSection = document.getElementById("timeline-wrapper");

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

        seriesSelect.classList.remove("hidden");
        showJsonBtn.classList.remove("hidden");
        timelineWrapperSection.classList.remove("hidden");

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

  document.getElementById("start-btn").addEventListener("click", async () => {
    await startProgram();
  });

  document.getElementById("stop-btn").addEventListener("click", async () => {
    await stopProgram();
  });

  document.getElementById("turn-btn").addEventListener("click", async () => {
    await turnTargets();
  });

  document.getElementById("audio-form").addEventListener("submit", async (e) => {
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
      const res = await fetch("/audios");
      const { builtin = [], uploaded = [] } = await res.json();

      const container = document.getElementById("audio-container");
      container.innerHTML = "";

      [...builtin, ...uploaded].forEach(audio => {
        const li = document.createElement("li");
        li.textContent = `${audio.id}: ${audio.title}`;
        container.appendChild(li);
      });
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
});