import { renderTimeline, setCurrent, toggleRaw } from './visualization.js';
import { getProgram, fetchPrograms, loadProgram, startProgram, stopProgram, turnTargets } from './rest-client.js';

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("toggle-audio").addEventListener("click", () => {
    document.getElementById("audio-section").classList.toggle("hidden");
  });

  document.getElementById("toggle-raw").addEventListener("click", () => {
    if (window.currentProgram) {
      toggleRaw(window.currentProgram);
    }
  });

  const selector = document.getElementById("programs");

  // Add default prompt option
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
});