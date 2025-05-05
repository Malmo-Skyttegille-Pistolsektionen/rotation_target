import {
  provideFluentDesignSystem,
  fluentButton,
  fluentSelect,
  fluentOption
} from "@fluentui/web-components";

provideFluentDesignSystem().register(fluentButton(), fluentSelect(), fluentOption());

document.addEventListener("DOMContentLoaded", () => {
  const select = document.getElementById("programs");
  const startBtn = document.getElementById("start-btn");
  const stopBtn = document.getElementById("stop-btn");
  const turnBtn = document.getElementById("turn-btn");
  const footer = document.getElementById("footer");

  let selectedId = null;

  const updateButtons = () => {
    const disabled = !selectedId;
    startBtn.disabled = disabled;
    stopBtn.disabled = disabled;
  };

  fetch("/api/programs")
    .then((res) => res.json())
    .then((data) => {
      for (const [id, label] of Object.entries(data.programs)) {
        const option = document.createElement("fluent-option");
        option.value = id;
        option.textContent = label;
        select.appendChild(option);
      }
    });

  select.addEventListener("change", (e) => {
    selectedId = e.target.value;
    updateButtons();
  });

  startBtn.addEventListener("click", () => {
    if (selectedId) fetch(`/api/programs/${selectedId}/start`, { method: "POST" });
  });

  stopBtn.addEventListener("click", () => {
    if (selectedId) fetch(`/api/programs/${selectedId}/stop`, { method: "POST" });
  });

  turnBtn.addEventListener("click", () => {
    fetch("/api/target/turn", { method: "POST" });
  });

  footer.textContent = "Malmö Skyttegille Rotation Target v0.1.0";
});

