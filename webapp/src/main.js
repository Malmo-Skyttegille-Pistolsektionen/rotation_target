import {
  provideFluentDesignSystem,
  fluentButton,
  fluentSelect,
  fluentOption
} from "@fluentui/web-components";

provideFluentDesignSystem().register(fluentButton(), fluentSelect(), fluentOption());

const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const appName = "Malmö Skyttegille Rotation Target";
const appTitle = `${appName} v${appVersion}`;

document.addEventListener("DOMContentLoaded", () => {
  const select = document.getElementById("programs");
  const startBtn = document.getElementById("start-btn");
  const stopBtn = document.getElementById("stop-btn");
  const turnBtn = document.getElementById("turn-btn");
  const footer = document.getElementById("footer");

  document.title = appTitle;
  footer.textContent = appTitle;
  

  startBtn.classList.add("start");
  stopBtn.classList.add("stop");

  let selectedId = null;

  const updateButtons = () => {
    const disabled = !selectedId;
    startBtn.disabled = disabled;
    stopBtn.disabled = disabled;
  };

  // ✅ Add placeholder (not selected)
  const placeholder = document.createElement("fluent-option");
  placeholder.disabled = true;
  placeholder.value = "";
  placeholder.textContent = "Choose program...";
  select.appendChild(placeholder);

  // ✅ Load options
  fetch("/api/programs")
    .then(res => res.json())
    .then(data => {
      for (const [id, label] of Object.entries(data.programs)) {
        const option = document.createElement("fluent-option");
        option.value = id;
        option.textContent = label;
        select.appendChild(option);
      }

      // ✅ Set default to placeholder safely
      select.selectedIndex = 0;
    });

  // ✅ Handle user selection
  select.addEventListener("change", (e) => {
    selectedId = e.target.value || null;
    updateButtons();

    if (placeholder.parentNode) {
      placeholder.parentNode.removeChild(placeholder);
    }    
  });

  // ✅ Button handlers
  startBtn.addEventListener("click", () => {
    if (selectedId) {
      fetch(`/api/programs/start?id=${selectedId}`, { method: "POST" })
        .then(res => res.json())
        .then(data => console.log("Start response:", data))
        .catch(err => console.error("Start error:", err));    }
  });

  stopBtn.addEventListener("click", () => {
    if (selectedId) {
      fetch(`/api/programs/stop?id=${selectedId}`, { method: "POST" })
        .then(res => res.json())
        .then(data => console.log("Stop response:", data))
        .catch(err => console.error("Stop error:", err));    }
  });

  turnBtn.addEventListener("click", () => {
    fetch("/api/target/turn", { method: "POST" })
    .then(res => res.json())
    .then(data => console.log("Turn response:", data))
    .catch(err => console.error("Turn error:", err));

  });


});
