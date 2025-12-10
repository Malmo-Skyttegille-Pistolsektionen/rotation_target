import { initializeRunTab } from './ui/views/run_tab.js';
import { initializeAudiosTab } from './ui/views/audios_tab.js';
import { initializeProgramsTab } from './ui/views/programs_tab.js';
import { initializeSettingsTab } from './ui/views/settings_tab.js';
import { connectToEventStream } from './apis/sse-client.js';
import { loadAudios } from './models/audios.js';

import { SSETypes } from "./common/sse-types.js";


function handleSSEEvent(type, payload) {
  const event = new CustomEvent(type, { detail: payload });
  document.dispatchEvent(event);
}

document.addEventListener("DOMContentLoaded", async () => {


  const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
  const appName = "Malmö Skyttegille Rotation Target";
  const appTitle = `${appName} v${appVersion}`;
  document.title = appTitle;
  document.querySelector("#footer span").textContent = appTitle;

  try {
    await loadAudios();
  } catch (error) {
    console.error("Failed to load audios:", error);
  }

  // Initialize tabs
  await initializeRunTab();

  // Cache DOM elements at the top
  const runTabButton = document.getElementById("run-tab-button");
  const audioTabButton = document.getElementById("audio-tab-button");
  const programsTabButton = document.getElementById("programs-tab-button");
  const settingsTabButton = document.getElementById("settings-tab-button");
  const runSection = document.getElementById("run-section");
  const audioSection = document.getElementById("audio-section");
  const programsSection = document.getElementById("programs-section");
  const settingsSection = document.getElementById("settings-section");
  // Tab switching logic
  runTabButton.addEventListener("click", async () => {
    runTabButton.classList.add("active");
    audioTabButton.classList.remove("active");
    programsTabButton.classList.remove("active");
    settingsTabButton.classList.remove("active");

    runSection.classList.remove("hidden");
    audioSection.classList.add("hidden");
    programsSection.classList.add("hidden");
    settingsSection.classList.add("hidden");
    await initializeRunTab();
  });

  audioTabButton.addEventListener("click", async () => {
    audioTabButton.classList.add("active");
    runTabButton.classList.remove("active");
    programsTabButton.classList.remove("active");
    settingsTabButton.classList.remove("active");

    audioSection.classList.remove("hidden");
    runSection.classList.add("hidden");
    programsSection.classList.add("hidden");
    settingsSection.classList.add("hidden");

    await initializeAudiosTab();
  });

  programsTabButton.addEventListener("click", () => {
    programsTabButton.classList.add("active");
    runTabButton.classList.remove("active");
    audioTabButton.classList.remove("active");
    settingsTabButton.classList.remove("active");

    programsSection.classList.remove("hidden");
    runSection.classList.add("hidden");
    audioSection.classList.add("hidden");
    settingsSection.classList.add("hidden");

    initializeProgramsTab();
  });

  settingsTabButton.addEventListener("click", () => {
    settingsTabButton.classList.add("active");
    runTabButton.classList.remove("active");
    audioTabButton.classList.remove("active");
    programsTabButton.classList.remove("active");

    settingsSection.classList.remove("hidden");
    runSection.classList.add("hidden");
    audioSection.classList.add("hidden");
    programsSection.classList.add("hidden");

    initializeSettingsTab();
  });

  // Broadcast SSE events
  connectToEventStream(handleSSEEvent);

  let heartbeatCounter = 0;

  document.addEventListener("sse_status", (e) => {
    const status = e.detail.status;
    const statusEl = document.getElementById("sse-status");
    console.log(`SSE status event: ${status} (heartbeat: ${heartbeatCounter})`);
    if (statusEl) {
      statusEl.textContent = `SSE (${heartbeatCounter}): ${status}`;
      statusEl.className = `sse-status-${status}`;
    }
  });
  // Heartbeat event handler
  let heartbeatResetCounter = 0; // Counter for number of resets

  document.addEventListener(SSETypes.HeartBeat, (e) => {
    const heartbeatId = e?.detail?.id;
    if (heartbeatId === "reset") {
      heartbeatCounter = 0;
      heartbeatResetCounter++;
      console.log(`SSE heartbeat counter reset (total resets: ${heartbeatResetCounter})`);
    } else {
      heartbeatCounter++;
      console.log(`SSE heartbeat: ${heartbeatCounter}`);
    }
    const statusEl = document.getElementById("sse-status");
    if (statusEl) {
      const status = window.sseConnectionStatus || "unknown";
      statusEl.textContent = `SSE (${heartbeatCounter} : ${heartbeatId}, resets: ${heartbeatResetCounter}): ${status}`;
    }
  });
});

