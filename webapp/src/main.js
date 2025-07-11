import { initializeRunTab } from './run.js';
import { initializeAudiosTab, loadAudios } from './audios.js';
import { initializeProgramsTab } from './programs.js';
import { initializeSettingsTab } from './config.js';
import { connectToEventStream } from './sse-client.js';
import { SSETypes } from "./common/sse-types.js";

import { getStatus } from './rest-client.js';
import { setCurrent, clearCurrent } from './timeline.js';

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

  await loadAudios();

  // Initialize tabs
  await initializeRunTab();

  const runTabButton = document.getElementById("run-tab-button");
  const audioTabButton = document.getElementById("audio-tab-button");
  const programsTabButton = document.getElementById("programs-tab-button"); // <-- updated
  const settingsTabButton = document.getElementById("settings-tab-button");
  const runSection = document.getElementById("run-section");
  const audioSection = document.getElementById("audio-section");
  const programsSection = document.getElementById("programs-section"); // <-- updated
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

    initializeProgramsTab(); // <-- updated
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
  connectToEventStream((type, payload) => {
    console.log('SSE Event:', type, payload);
    const event = new CustomEvent(type, { detail: payload });
    document.dispatchEvent(event);
  });

});