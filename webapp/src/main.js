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

  // Populate dropdown
  const selector = document.getElementById("programs");
  const programs = await fetchPrograms();
  programs.forEach(({ id, title }) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = `${id}: ${title}`;
    selector.appendChild(opt);
  });

  selector.addEventListener("change", async () => {
    const id = parseInt(selector.value, 10);
    if (!isNaN(id)) {
      await loadProgram(id);
      const program = await getProgram(id);
      window.currentProgram = program;
      renderTimeline(program);
      setCurrent(0, 0);
    }
  });

  // Attach start/stop buttons
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
