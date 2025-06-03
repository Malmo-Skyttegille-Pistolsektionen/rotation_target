
import { renderTimeline, setCurrent, toggleRaw, clearCurrent } from './visualization.svg.js';
import { getProgram, fetchPrograms, loadProgram, startProgram, stopProgram, turnTargets } from './rest-client.js';
import { connectToEventStream } from './sse-client.js';

document.addEventListener("DOMContentLoaded", async () => {
  const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
  const appName = "Malmö Skyttegille Rotation Target";
  const appTitle = `${appName} v${appVersion}`;
  document.title = appTitle;
  document.getElementById("footer").textContent = appTitle;

  document.getElementById("toggle-audio").addEventListener("click", () => {
    document.getElementById("audio-section").classList.toggle("hidden");
  });

  document.getElementById("toggle-raw").addEventListener("click", () => {
    if (window.currentProgram) {
      toggleRaw(window.currentProgram);
    }
  });

  const selector = document.getElementById("programs");

  const defaultOpt = document.createElement("option");
  defaultOpt.disabled = true;
  defaultOpt.selected = true;
  defaultOpt.textContent = "Choose a program";
  selector.appendChild(defaultOpt);

  try {
    const programs = await fetchPrograms();
    console.log("Fetched programs:", programs);
    programs.forEach(({ id, title }) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = `${id}: ${title}`;
      selector.appendChild(opt);
    });
  } catch (err) {
    console.error("Error fetching programs:", err);
  }

  selector.addEventListener("change", async () => {
    const id = parseInt(selector.value, 10);
    if (!isNaN(id)) {
      console.log("Selected program ID:", id);
      await loadProgram(id);
      try {
        const program = await getProgram(id);
        console.log("Fetched program data:", program);
        window.currentProgram = program;
        renderTimeline(program);
        setCurrent(0, 0);
      } catch (err) {
        console.error("Failed to fetch program by ID:", err);
      }
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

  const handlers = {
    program_loaded: () => setCurrent(0, 0),
    series_started: () => setCurrent(0, 0),
    event_started: ({ series_index, event_index }) => {
      setCurrent(series_index, event_index);
    },
    series_completed: ({ next_series_index }) => {
      setCurrent(next_series_index, 0);
    },
    series_skipped: ({ next_series_index }) => {
      setCurrent(next_series_index, 0);
    },
    program_completed: () => {
      clearCurrent();
    }
  };

  connectToEventStream((type, payload) => {
    if (handlers[type]) {
      handlers[type](payload);
    }
  });

  // Set initial status
  try {
    const statusRes = await fetch("/status");
    const status = await statusRes.json();
    document.getElementById("status").textContent = status.program_id != null
      ? "Program ID: " + status.program_id + ", Running: " + status.running + ", Next Event: " +
      (status.next_event ? "S" + status.next_event.series_index + "E" + status.next_event.event_index : "N/A")
      : "No program loaded";

  } catch {
    document.getElementById("status").textContent = "Status unavailable";
  }
});
