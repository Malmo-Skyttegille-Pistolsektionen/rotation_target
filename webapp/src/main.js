import { connectToEventStream, EventType  } from './sse-client.js';
import { fetchPrograms, loadProgram, startProgram, stopProgram } from './rest-client.js';

const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const appName = "Malmö Skyttegille Rotation Target";
const appTitle = `${appName} v${appVersion}`;

document.addEventListener("DOMContentLoaded", () => {
  const select = document.getElementById("programs");
  const startBtn = document.getElementById("start-btn");
  const stopBtn = document.getElementById("stop-btn");
  const footer = document.getElementById("footer");

  document.title = appTitle;
  footer.textContent = appTitle;

  let selectedId = null;

  const updateButtons = () => {
    const disabled = !selectedId;
    startBtn.disabled = disabled;
    stopBtn.disabled = disabled;
  };

  const log = (msg) => console.log("💬", msg);

  fetchPrograms().then(programs => {
    select.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.value = "";
    placeholder.textContent = "Choose program...";
    select.appendChild(placeholder);

    for (const [id, title] of Object.entries(programs)) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = title;
      select.appendChild(option);
    }
  });

  connectToEventStream((type, data) => {
    switch (type) {
      case EventType.ProgramLoaded:
        log(`Program ${data.id} loaded.`);
        break;
      case EventType.SeriesStarted:
        log(`Series started: ${data.name}`);
        break;
      case EventType.SeriesCompleted:
        log(`Series completed: ${data.name}`);
        break;
      case EventType.ProgramCompleted:
        log(`Program finished.`);
        break;
    }
  });

  select.addEventListener("change", (e) => {
    selectedId = e.target.value || null;
    updateButtons();

    if (selectedId) {
      loadProgram(Number(selectedId));
    }
  });

  startBtn.addEventListener("click", () => {
    if (selectedId) {
      startProgram();
    }
  });

  stopBtn.addEventListener("click", () => {
    if (selectedId) {
      stopProgram();
    }
  });
});
